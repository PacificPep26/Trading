// Telegram signal alerts according to disciplined backtested rules:
// 4H only: BOS LONG; double top/bottom only with matching BTC + coin daily trends.
//    Includes 5-minute heads-up preview before each 4h close when coin is near level (<= 1.2%).
// Uses unified trading policy from @/lib/trading-policy.

import fs from "fs";
import path from "path";
import { analyse } from "@/lib/patterns";
import { candles } from "@/lib/okx";
import {
  isAllowedSetup,
  isWatchSetup,
  isStarSetup,
  calculateSizing,
  calculatePartialPnL,
} from "@/lib/trading-policy";

const COINS = [
  "BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK",
  "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"
];

const CAPITAL = Number(process.env.ALERT_CAPITAL ?? 40);

const DEDUP_FILE = path.join(process.cwd(), "service", "telegram-sent.json");

function loadDedup(): { sent: string[]; preSent: string[] } {
  try {
    if (fs.existsSync(DEDUP_FILE)) {
      const data = JSON.parse(fs.readFileSync(DEDUP_FILE, "utf-8"));
      return { sent: data.sent ?? [], preSent: data.preSent ?? [] };
    }
  } catch {}
  return { sent: [], preSent: [] };
}

function saveDedup(sentSet: Set<string>, preSentSet: Set<string>) {
  try {
    const data = {
      sent: Array.from(sentSet).slice(-300),
      preSent: Array.from(preSentSet).slice(-300),
    };
    fs.writeFileSync(DEDUP_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}

const initialDedup = loadDedup();

declare global {
  var telegramSent: Set<string> | undefined;
  var telegramPreSent: Set<string> | undefined;
}
const sent = (globalThis.telegramSent ??= new Set<string>(initialDedup.sent));
const preSent = (globalThis.telegramPreSent ??= new Set<string>(initialDedup.preSent));

const dailyTrendCache: Record<string, { trend: 1 | -1 | 0; ts: number }> = {};

async function dailyTrend(coin: string): Promise<1 | -1 | 0> {
  const cached = dailyTrendCache[coin];
  if (cached && Date.now() - cached.ts < 30 * 60_000) return cached.trend;
  try {
    const d = (await candles(`${coin}-USDT-SWAP`, "1Dutc", 300)).filter((c) => c.closed);
    if (d.length < 60) return 0;
    let ema = d[0].c;
    for (const c of d) ema += (2 / 51) * (c.c - ema);
    const tr = d.at(-1)!.c > ema ? 1 : -1;
    dailyTrendCache[coin] = { trend: tr, ts: Date.now() };
    return tr;
  } catch (e) {
    if (cached) return cached.trend;
    return 0;
  }
}

const f = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: v > 1000 ? 1 : v > 1 ? 3 : 7 });

export async function send(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.error("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID chưa cấu hình");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      console.error(`Telegram ${res.status}:`, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("Telegram send error", e);
    return false;
  }
}

/** Scan the verified 4H setups. */
export async function scanAndAlert(): Promise<string[]> {
  const btc = await dailyTrend("BTC");
  const itemsToSend: { key: string; msg: string }[] = [];
  const out: string[] = [];

  for (const coin of COINS) {
    try {
      await new Promise((r) => setTimeout(r, 60));
      const [a4, own] = await Promise.all([
        analyse(await candles(`${coin}-USDT-SWAP`, "4H", 300)),
        coin === "BTC" ? btc : dailyTrend(coin)
      ]);

      // 1. Quét 4H (BOS LONG & Hai đỉnh SHORT)
      for (const s of a4.setups) {
        if (s.state !== "triggered") continue;
        if (!isAllowedSetup(s.style, s.side, "4H", btc, own)) continue;

        const risk = Math.abs(s.entry - s.stop) / s.entry;
        if (risk < 0.004 || risk > 0.08) continue;

        const key = `4H:${coin}:${s.style}:${s.side}:${a4.lastBarTime}`;
        if (sent.has(key)) continue;

        const R = Math.abs(s.entry - s.stop);
        const sizing = calculateSizing(CAPITAL, risk);
        const pnl = calculatePartialPnL(sizing.actualRiskUsd);
        const tp05 = s.entry + s.side * 0.5 * R;
        const tp10 = s.entry + s.side * R;

        const isStar = isStarSetup(s.side, own, btc);
        const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
        const styleStr = s.style === "bos" ? "BOS 4H" : s.style === "pinbar_reversal" ? "Pinbar quét râu 4H" : (s.side > 0 ? "Hai đáy 4H" : "Hai đỉnh 4H");
        const header = isStar
          ? `🌟 [KÈO ĐẸP ★★★ - ĂN SÓNG LỚN] 4H ${coin} ${sideStr} (${styleStr})\n🔥 THUẬN XU HƯỚNG NGÀY`
          : `🚨 [4H SÓNG LỚN] ${coin} ${sideStr} (${styleStr})`;

        itemsToSend.push({
          key,
          msg:
            `${header}\n` +
            `• Vào ngay: ~${f(s.entry)} (nến 4h vừa đóng; bỏ nếu đã chạy > ${f(s.entry + s.side * 0.3 * R)})\n` +
            `• Dừng lỗ (SL): ${f(s.stop)} (-${(risk * 100).toFixed(2)}%)\n` +
            `• ⚠️ THOÁT SỚM: Đóng lệnh ngay nếu nến 4h sau đóng ${s.side > 0 ? "dưới" : "trên"} ${f(s.level)}\n` +
            `• TP 1 (0.5R): ${f(tp05)} (+${pnl.winTp1.toFixed(2)}$ chốt 50%, dời hòa)\n` +
            `• TP 2 (1.0R): ${f(tp10)} (Tổng +${pnl.totalWin.toFixed(2)}$)${isStar ? " · Có thể gồng thêm theo trend" : ""}\n` +
            `• MEXC: Ký quỹ ~${sizing.margin}$ · Đòn bẩy x${sizing.leverage} Isolated · Rủi ro SL: -${sizing.actualRiskUsd}$`
        });
      }

      // 1H actionable scalping alert
      const a1 = analyse(await candles(`${coin}-USDT-SWAP`, "1H", 120));
      for (const s of a1.setups) {
        if (s.state !== "triggered" || !isWatchSetup(s.style, s.side, "1H")) continue;
        const risk = Math.abs(s.entry - s.stop) / s.entry;
        if (risk < 0.003 || risk > 0.04) continue;
        const key = `WATCH:1H:${coin}:${s.style}:${s.side}:${a1.lastBarTime}`;
        if (sent.has(key)) continue;

        const R = Math.abs(s.entry - s.stop);
        const sizing = calculateSizing(CAPITAL, risk);
        const pnl = calculatePartialPnL(sizing.actualRiskUsd);
        const tp05 = s.entry + s.side * 0.5 * R;
        const tp10 = s.entry + s.side * R;
        const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
        const styleStr = s.style === "bos" ? "BOS 1H" : s.style === "pinbar_reversal" ? "Pinbar quét râu 1H" : (s.side > 0 ? "Hai đáy 1H" : "Hai đỉnh 1H");

        itemsToSend.push({
          key,
          msg:
            `⚡ [LƯỚT SÓNG 1H] ${coin} ${sideStr} (${styleStr})\n` +
            `• Vào ngay: ~${f(s.entry)} (nến 1h vừa đóng)\n` +
            `• Dừng lỗ (SL): ${f(s.stop)} (-${(risk * 100).toFixed(2)}%)\n` +
            `• TP 1 (0.5R): ${f(tp05)} (+${pnl.winTp1.toFixed(2)}$ chốt 50%, dời hòa)\n` +
            `• TP 2 (1.0R): ${f(tp10)} (Tổng +${pnl.totalWin.toFixed(2)}$)\n` +
            `• MEXC: Đòn bẩy x${sizing.leverage} Isolated · Ký quỹ ~${sizing.margin}$ · Rủi ro SL: -${sizing.actualRiskUsd}$`
        });
      }

    } catch (e) {
      console.error(`telegram scan ${coin}`, e);
    }
  }

  // Gửi tin nhắn và CHỈ đánh dấu sent khi thành công (tránh mất tín hiệu khi mạng lỗi)
  for (const item of itemsToSend) {
    const ok = await send(item.msg);
    if (ok) {
      sent.add(item.key);
      saveDedup(sent, preSent);
      out.push(item.msg);
    }
  }
  return out;
}

const H4 = 4 * 3_600_000;
const H1 = 3_600_000;
const vnTime = (t: number) => new Date(t).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });

/** Báo trước: ~5 phút trước khi nến đóng (chỉ báo khi coin áp sát mức kích hoạt <= 1%) */
export async function preAlert(now = Date.now(), force = false): Promise<string | null> {
  const close4h = Math.floor(now / H4) * H4 + H4;
  const left4h = close4h - now;
  const close1h = Math.floor(now / H1) * H1 + H1;
  const left1h = close1h - now;
  // Báo trước ~5 phút (từ phút 53 đến 58)
  const is4hSlot = force || (left4h <= 7 * 60_000 && left4h >= 1 * 60_000);
  const is1hSlot = !is4hSlot && left1h <= 7 * 60_000 && left1h >= 1 * 60_000;
  if (!is4hSlot && !is1hSlot) return null;

  const key = is4hSlot ? `4H:${close4h}` : `WATCH:1H:${close1h}`;
  if (!force && preSent.has(key)) return null;

  const btc = await dailyTrend("BTC");
  const lines4h: string[] = [];
  const lines1h: string[] = [];

  for (const coin of COINS) {
    try {
      await new Promise((r) => setTimeout(r, 60));
      const own = coin === "BTC" ? btc : await dailyTrend(coin);

      // 1. Quét 4h nếu đang ở slot 4h (khoảng cách <= 1.5%)
      if (is4hSlot) {
        const a4 = analyse(await candles(`${coin}-USDT-SWAP`, "4H", 300));
        for (const s of a4.setups) {
          if (s.state !== "pending") continue;
          if (!isAllowedSetup(s.style, s.side, "4H", btc, own)) continue;

          const risk = Math.abs(s.entry - s.stop) / s.entry;
          if (risk < 0.004 || risk > 0.08 || Math.abs(s.distancePct) > 0.015) continue;

          const sizing = calculateSizing(CAPITAL, risk);
          const isStar = isStarSetup(s.side, own, btc);
          const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
          const styleStr = s.style === "bos" ? "BOS 4H" : s.style === "pinbar_reversal" ? "Pinbar 4H" : (s.side > 0 ? "Hai đáy 4H" : "Hai đỉnh 4H");

          lines4h.push(
            `• ${coin} ${sideStr} (${styleStr})${isStar ? " ⭐ [KÈO ĐẸP ★★★]" : ""}: ` +
            `cần đóng ${s.side > 0 ? ">" : "<"} ${f(s.entry)} (cách ${(Math.abs(s.distancePct) * 100).toFixed(2)}%) · SL ${f(s.stop)} (-${(risk * 100).toFixed(1)}%) · x${sizing.leverage}`
          );
        }
      }

      const a1 = analyse(await candles(`${coin}-USDT-SWAP`, "1H", 120));
      for (const s of a1.setups) {
        if (s.state !== "pending" || !isWatchSetup(s.style, s.side, "1H")) continue;
        const risk = Math.abs(s.entry - s.stop) / s.entry;
        if (risk < 0.003 || risk > 0.04 || Math.abs(s.distancePct) > 0.012) continue;
        const sizing = calculateSizing(CAPITAL, risk);
        const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
        const styleStr = s.style === "bos" ? "BOS 1H" : s.style === "pinbar_reversal" ? "Pinbar 1H" : (s.side > 0 ? "Hai đáy 1H" : "Hai đỉnh 1H");
        lines1h.push(
          `• ${coin} ${sideStr} (${styleStr}): cần đóng ${s.side > 0 ? ">" : "<"} ${f(s.entry)} (cách ${(Math.abs(s.distancePct) * 100).toFixed(2)}%) · SL ${f(s.stop)} (-${(risk * 100).toFixed(1)}%) · x${sizing.leverage}`
        );
      }

    } catch (e) {
      console.error(`telegram pre ${coin}`, e);
    }
  }

  // Nếu KHÔNG có coin nào (cả 4h lẫn 1h) sắp kích hoạt: TUYỆT ĐỐI IM LẶNG, không gửi tin rác
  if (!lines4h.length && !lines1h.length) {
    return null;
  }

  const msg = is4hSlot
    ? `⏰ Nến 4h đóng lúc ${vnTime(close4h)} (còn ~${Math.round(left4h / 60_000)} phút)\n` +
      `${lines4h.length ? `📌 Sóng lớn 4H sắp kích hoạt:\n${lines4h.join("\n")}\n` : ""}` +
      `${lines1h.length ? `\n⚡ Lướt sóng 1H sắp kích hoạt:\n${lines1h.join("\n")}\n` : ""}` +
      `\n💡 Chuẩn bị mở app MEXC, vào lệnh ngay khi nến đóng!`
    : `⚡ [LƯỚT SÓNG 1H] Còn ~${Math.round(left1h / 60_000)} phút đóng nến:\n` +
      `${lines1h.join("\n")}\n\n💡 Mở chart canh điểm đóng nến, đặt SL chặt theo kế hoạch!`;

  const ok = await send(msg);
  if (ok) {
    preSent.add(key);
    saveDedup(sent, preSent);
    return msg;
  }
  return null;
}
