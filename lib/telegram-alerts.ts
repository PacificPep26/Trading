// Telegram signal alerts according to disciplined backtested rules:
// 4H only: BOS LONG; double top/bottom only with matching BTC + coin daily trends.
//    Includes 5-minute heads-up preview before each 4h close when coin is near level (<= 1.2%).
// Uses unified trading policy from @/lib/trading-policy.

import fs from "fs";
import path from "path";
import { analyse } from "@/lib/patterns";
import { candles, ticker } from "@/lib/okx";
import { evaluateSetup } from "@/lib/decision-engine";
import { openPaperPlan, paperSummary, reconcilePaperPositions } from "@/lib/paper-ledger";
import { isStarSetup, calculatePartialPnL } from "@/lib/trading-policy";

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
  } catch {
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
  const paper = paperSummary(CAPITAL);
  const itemsToSend: { key: string; msg: string }[] = [];
  const out: string[] = [];

  for (const coin of COINS) {
    try {
      await new Promise((r) => setTimeout(r, 60));
      const [bars4h, own] = await Promise.all([
        candles(`${coin}-USDT-SWAP`, "4H", 300),
        coin === "BTC" ? btc : dailyTrend(coin)
      ]);
      reconcilePaperPositions(coin, bars4h, CAPITAL);
      const a4 = analyse(bars4h);

      const tLive = await ticker(`${coin}-USDT-SWAP`).catch(() => null);

      // 1. Quét 4H
      for (const s of a4.setups) {
        if (s.state !== "triggered") continue;
        const decision = evaluateSetup(s, {
          coin,
          timeframe: "4H",
          btcDaily: btc,
          ownDaily: own,
          equity: paper.equity,
          peakEquity: paper.peakEquity,
          lastBarTime: a4.lastBarTime,
          livePrice: tLive?.last,
        });
        if (!decision.accepted || !decision.plan) continue;
        const plan = decision.plan;
        const risk = plan.riskPct;

        const key = `4H:${coin}:${s.style}:${s.side}:${a4.lastBarTime}`;
        if (sent.has(key)) continue;

        const sizing = plan.sizing;
        const pnl = calculatePartialPnL(sizing.actualRiskUsd);

        const isStar = isStarSetup(s.side, own, btc);
        const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
        const styleStr = s.style === "bos" ? "BOS 4H" : s.style === "pinbar_reversal" ? "Pinbar 4H" : (s.side > 0 ? "Hai đáy 4H" : "Hai đỉnh 4H");
        const header = isStar
          ? `🌟 [KÈO ĐẸP ★★★ - ĂN SÓNG LỚN] 4H ${coin} ${sideStr} (${styleStr})\n🔥 THUẬN XU HƯỚNG NGÀY`
          : `🚨 [4H SÓNG LỚN] ${coin} ${sideStr} (${styleStr})`;

        itemsToSend.push({
          key,
          msg:
            `${header}\n` +
            `• Vào ngay: ~${f(s.entry)} (nến 4h vừa đóng; bỏ nếu đã chạy > 0.25%)\n` +
            `• Dừng lỗ (SL): ${f(s.stop)} (-${(risk * 100).toFixed(2)}%)\n` +
            `• ⚠️ THOÁT SỚM: Đóng lệnh ngay nếu nến 4h sau đóng ${s.side > 0 ? "dưới" : "trên"} ${f(s.level)}\n` +
            `• TP 1 (1.0R): ${f(plan.tp1)} (+${pnl.winTp1.toFixed(2)}$ chốt 50%, dời hòa)\n` +
            `• TP 2 (2.0R): ${f(plan.tp2)} (Tổng +${pnl.totalWin.toFixed(2)}$)${isStar ? " · Có thể gồng theo trend" : ""}\n` +
            `• MEXC (${plan.strategyVersion}): Ký quỹ ~${sizing.margin}$ · Vị thế ${sizing.notional}$ · x${sizing.leverage} Isolated · Rủi ro SL: -${sizing.actualRiskUsd}$`
        });
        openPaperPlan(key, decision, bars4h, CAPITAL);
      }

      // 2. Quét 1H (Lướt sóng sớm)
      const bars1h = await candles(`${coin}-USDT-SWAP`, "1H", 120);
      const a1 = analyse(bars1h);
      for (const s of a1.setups) {
        if (s.state !== "triggered") continue;
        const decision1h = evaluateSetup(s, {
          coin,
          timeframe: "1H",
          btcDaily: btc,
          ownDaily: own,
          equity: paper.equity,
          peakEquity: paper.peakEquity,
          lastBarTime: a1.lastBarTime,
          livePrice: tLive?.last,
        });
        if (!decision1h.accepted || !decision1h.plan) continue;
        const plan1h = decision1h.plan;

        const key1h = `1H:${coin}:${s.style}:${s.side}:${a1.lastBarTime}`;
        if (sent.has(key1h)) continue;

        const sizing1h = plan1h.sizing;
        const pnl1h = calculatePartialPnL(sizing1h.actualRiskUsd);
        const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
        const styleStr = s.style === "bos" ? "BOS 1H" : s.style === "pinbar_reversal" ? "Pinbar 1H" : (s.side > 0 ? "Hai đáy 1H" : "Hai đỉnh 1H");

        itemsToSend.push({
          key: key1h,
          msg:
            `⚡ [LƯỚT SÓNG 1H] ${coin} ${sideStr} (${styleStr})\n` +
            `• Vào ngay: ~${f(s.entry)} (nến 1h vừa đóng)\n` +
            `• Dừng lỗ (SL): ${f(s.stop)} (-${(plan1h.riskPct * 100).toFixed(2)}%)\n` +
            `• TP 1 (1.0R): ${f(plan1h.tp1)} (+${pnl1h.winTp1.toFixed(2)}$ chốt 50%, dời hòa)\n` +
            `• TP 2 (2.0R): ${f(plan1h.tp2)} (Tổng +${pnl1h.totalWin.toFixed(2)}$)\n` +
            `• MEXC (${plan1h.strategyVersion}): Ký quỹ ~${sizing1h.margin}$ · Vị thế ${sizing1h.notional}$ · x${sizing1h.leverage} Isolated · Rủi ro SL: -${sizing1h.actualRiskUsd}$`
        });
        openPaperPlan(key1h, decision1h, bars4h, CAPITAL);
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
const vnTime = (t: number) => new Date(t).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });

/** Báo trước: ~5 phút trước khi nến đóng (chỉ báo khi coin áp sát mức kích hoạt <= 1%) */
export async function preAlert(now = Date.now(), force = false): Promise<string | null> {
  const close4h = Math.floor(now / H4) * H4 + H4;
  const left4h = close4h - now;
  // Báo trước ~5 phút (từ phút 53 đến 58)
  const is4hSlot = force || (left4h <= 7 * 60_000 && left4h >= 1 * 60_000);
  if (!is4hSlot) return null;

  const key = `4H:${close4h}`;
  if (!force && preSent.has(key)) return null;

  const btc = await dailyTrend("BTC");
  const lines4h: string[] = [];
  const paper = paperSummary(CAPITAL);

  for (const coin of COINS) {
    try {
      await new Promise((r) => setTimeout(r, 60));
      const own = coin === "BTC" ? btc : await dailyTrend(coin);

      // 1. Quét 4h nếu đang ở slot 4h (khoảng cách <= 1.5%)
      if (is4hSlot) {
        const a4 = analyse(await candles(`${coin}-USDT-SWAP`, "4H", 300));
        for (const s of a4.setups) {
          if (s.state !== "pending") continue;
          const decision = evaluateSetup(s, { coin, timeframe: "4H", btcDaily: btc, ownDaily: own, equity: paper.equity, peakEquity: paper.peakEquity, lastBarTime: a4.lastBarTime, now });
          if (decision.code !== "PENDING_CONFIRMATION" || Math.abs(s.distancePct) > 0.015) continue;
          const risk = Math.abs(s.entry - s.stop) / s.entry;
          const isStar = isStarSetup(s.side, own, btc);
          const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
          const styleStr = s.style === "bos" ? "BOS 4H" : (s.side > 0 ? "Hai đáy 4H" : "Hai đỉnh 4H");

          lines4h.push(
            `• ${coin} ${sideStr} (${styleStr})${isStar ? " ⭐ [KÈO ĐẸP ★★★]" : ""}: ` +
            `cần đóng ${s.side > 0 ? ">" : "<"} ${f(s.entry)} (cách ${(Math.abs(s.distancePct) * 100).toFixed(2)}%) · SL ${f(s.stop)} (-${(risk * 100).toFixed(1)}%)`
          );
        }
      }

    } catch (e) {
      console.error(`telegram pre ${coin}`, e);
    }
  }

  // Nếu KHÔNG có coin nào (cả 4h lẫn 1h) sắp kích hoạt: TUYỆT ĐỐI IM LẶNG, không gửi tin rác
  if (!lines4h.length) {
    return null;
  }

  const msg = `⏰ Nến 4h đóng lúc ${vnTime(close4h)} (còn ~${Math.round(left4h / 60_000)} phút)\n` +
    `📌 Setup PAPER sắp xác nhận:\n${lines4h.join("\n")}\n\n💡 Chỉ theo dõi; decision engine sẽ đánh giá lại sau khi nến đóng.`;

  const ok = await send(msg);
  if (ok) {
    preSent.add(key);
    saveDedup(sent, preSent);
    return msg;
  }
  return null;
}
