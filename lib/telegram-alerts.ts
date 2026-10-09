// Telegram signal alerts according to disciplined backtested rules:
// 1. 4H Frame: BOS LONG & Double Top (SHORT) with early exit + TP 0.75R (50%) & 1.5R (50%).
//    Includes 10-minute heads-up preview before each 4h close.
// 2. 1H Frame: Double Top (SHORT) only (TP 0.5R - 0.75R fast scalping).
// Risk per trade: ~$1.5 (~3.5% of $40 capital) so max drawdown is safely controlled.

import { analyse } from "@/lib/patterns";
import { candles } from "@/lib/okx";

const COINS = [
  "BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK",
  "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"
];

const CAPITAL = Number(process.env.ALERT_CAPITAL ?? 40);
const RISK_PER_TRADE = Number(process.env.ALERT_RISK_USD ?? 5.0); // Fixed risk $5 per trade (1R ăn đúng $5)

declare global {
  var telegramSent: Set<string> | undefined;
  var telegramPreSent: Set<string> | undefined;
}
const sent = (globalThis.telegramSent ??= new Set<string>());
const preSent = (globalThis.telegramPreSent ??= new Set<string>());

async function dailyTrend(coin: string): Promise<1 | -1 | 0> {
  const d = (await candles(`${coin}-USDT-SWAP`, "1Dutc", 300)).filter((c) => c.closed);
  if (d.length < 60) return 0;
  let ema = d[0].c;
  for (const c of d) ema += (2 / 51) * (c.c - ema);
  return d.at(-1)!.c > ema ? 1 : -1;
}

const f = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: v > 1000 ? 1 : v > 1 ? 3 : 7 });

export async function send(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID chưa cấu hình");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}`);
}

/** Scan 4H and 1H for disciplined setups. */
export async function scanAndAlert(): Promise<string[]> {
  const btc = await dailyTrend("BTC");
  const out: string[] = [];

  for (const coin of COINS) {
    try {
      const [a4, own] = await Promise.all([
        analyse(await candles(`${coin}-USDT-SWAP`, "4H", 300)),
        coin === "BTC" ? btc : dailyTrend(coin)
      ]);

      // 1. Quét 4H (BOS LONG & Hai đỉnh SHORT)
      for (const s of a4.setups) {
        if (s.state !== "triggered") continue;
        const risk = Math.abs(s.entry - s.stop) / s.entry;
        if (risk < 0.004 || risk > 0.08) continue;

        // Luật chuẩn: BOS CHỈ LONG; Hai đỉnh CHỈ SHORT
        if (s.style === "bos" && s.side < 0) continue;
        if (s.style === "double_top_bottom" && s.side > 0) continue; // Bỏ hai đáy 1h/4h kém hơn

        const key = `4H:${coin}:${s.style}:${s.side}:${a4.lastBarTime}`;
        if (sent.has(key)) continue;
        sent.add(key);

        const R = Math.abs(s.entry - s.stop);
        // Định cỡ vị thế theo số tiền chấp nhận mất (RISK_PER_TRADE)
        const notional = RISK_PER_TRADE / risk;
        const lev = Math.max(1, Math.min(20, Math.floor(notional / 10)));
        const margin = notional / lev;

        const tp05 = s.entry + s.side * 0.5 * R;
        const tp10 = s.entry + s.side * 1.0 * R;

        out.push(
          `🚨 [4H] ${coin} ${s.side > 0 ? "🟢 LONG (BOS)" : "🔴 SHORT (Hai đỉnh)"}${own === s.side ? " · ★ Thuận xu hướng ngày" : ""}\n` +
          `• Vào: ~${f(s.entry)} (nến 4h vừa đóng; bỏ nếu đã chạy > ${f(s.entry + s.side * 0.3 * R)})\n` +
          `• Dừng lỗ (SL): ${f(s.stop)} (${(risk * 100).toFixed(2)}%)\n` +
          `• ⚠️ THOÁT SỚM: Đóng lệnh ngay nếu nến 4h sau đóng ${s.side > 0 ? "dưới" : "trên"} ${f(s.level)}\n` +
          `• Chốt lời (TP): TP1 (0,5R) ở ${f(tp05)} (+2,5$) → dời SL về Entry → TP2 (1R) ở ${f(tp10)} (đủ +5$)\n` +
          `• Vị thế: Ký quỹ ~${margin.toFixed(1)}$ · Đòn bẩy x${lev} (Notional ~${notional.toFixed(0)}$) · Mất ~${RISK_PER_TRADE}$ nếu dính SL`
        );
      }

      // 2. Quét 1H (CHỈ HAI ĐỈNH SHORT - Đánh nhanh lướt sóng trên MEXC)
      const a1 = analyse(await candles(`${coin}-USDT-SWAP`, "1H", 120));
      for (const s of a1.setups) {
        if (s.state !== "triggered") continue;
        if (s.style !== "double_top_bottom" || s.side > 0) continue; // Chỉ Hai đỉnh SHORT
        const risk = Math.abs(s.entry - s.stop) / s.entry;
        if (risk < 0.003 || risk > 0.04) continue;

        const key = `1H:${coin}:${s.style}:${s.side}:${a1.lastBarTime}`;
        if (sent.has(key)) continue;
        sent.add(key);

        const R = Math.abs(s.entry - s.stop);
        const notional = RISK_PER_TRADE / risk;
        const lev = Math.max(1, Math.min(20, Math.floor(notional / 8)));
        const margin = notional / lev;
        const tp05 = s.entry - 0.5 * R;
        const tp10 = s.entry - 1.0 * R;

        out.push(
          `⚡ [1H - LƯỚT NHANH] ${coin} 🔴 SHORT (Hai đỉnh 1h)\n` +
          `• Vào: ~${f(s.entry)} (nến 1h vừa đóng)\n` +
          `• Dừng lỗ (SL): ${f(s.stop)} (${(risk * 100).toFixed(2)}%)\n` +
          `• TP lướt nhanh: ${f(tp05)} (0,5R ăn +2,5$) hoặc ${f(tp10)} (1R ăn +5$)\n` +
          `• Vị thế: Ký quỹ ~${margin.toFixed(1)}$ · Đòn bẩy x${lev} · Mất ~${RISK_PER_TRADE}$ nếu dính SL`
        );
      }

    } catch (e) {
      console.error(`telegram scan ${coin}`, e);
    }
  }

  for (const m of out) await send(m);
  return out;
}

const H4 = 4 * 3_600_000;
const H1 = 1 * 3_600_000;
const vnTime = (t: number) => new Date(t).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });

/** Báo trước: nến 4h (~10 phút trước đóng) và nến 1h (~5-10 phút trước đóng khi có coin ngấp nghé) */
export async function preAlert(now = Date.now(), force = false): Promise<string | null> {
  const close4h = Math.floor(now / H4) * H4 + H4;
  const left4h = close4h - now;
  const close1h = Math.floor(now / H1) * H1 + H1;
  const left1h = close1h - now;

  const is4hSlot = force || (left4h <= 15 * 60_000 && left4h >= 3 * 60_000);
  const is1hSlot = !is4hSlot && (left1h <= 12 * 60_000 && left1h >= 2 * 60_000);

  if (!is4hSlot && !is1hSlot) return null;

  const key = is4hSlot ? `4H:${close4h}` : `1H:${close1h}`;
  if (!force && preSent.has(key)) return null;
  preSent.add(key);

  const btc = await dailyTrend("BTC");
  const lines4h: string[] = [];
  const lines1h: string[] = [];

  for (const coin of COINS) {
    try {
      // 1. Quét 4h nếu đang ở slot 4h
      if (is4hSlot) {
        const [a4, own] = await Promise.all([
          analyse(await candles(`${coin}-USDT-SWAP`, "4H", 300)),
          coin === "BTC" ? btc : dailyTrend(coin)
        ]);
        for (const s of a4.setups) {
          if (s.state !== "pending") continue;
          const risk = Math.abs(s.entry - s.stop) / s.entry;
          if (risk < 0.004 || risk > 0.08 || Math.abs(s.distancePct) > 0.03) continue;

          // Chỉ lọc BOS LONG hoặc Hai đỉnh SHORT
          if (s.style === "bos" && s.side < 0) continue;
          if (s.style === "double_top_bottom" && s.side > 0) continue;

          const notional = RISK_PER_TRADE / risk;
          const lev = Math.max(1, Math.min(20, Math.floor(notional / 10)));

          lines4h.push(
            `• ${coin} ${s.side > 0 ? "🟢 LONG (BOS 4h)" : "🔴 SHORT (Hai đỉnh 4h)"}${own === s.side ? " ★" : ""}: ` +
            `nến 4h đóng ${s.side > 0 ? ">" : "<"} ${f(s.entry)} (cách ${(Math.abs(s.distancePct) * 100).toFixed(2)}%) · SL ${f(s.stop)} (${(risk * 100).toFixed(1)}%) · x${lev}`
          );
        }
      }

      // 2. Quét 1h (Hai đỉnh SHORT) cho cả slot 4h lẫn slot 1h
      const a1 = analyse(await candles(`${coin}-USDT-SWAP`, "1H", 120));
      for (const s of a1.setups) {
        if (s.state !== "pending") continue;
        if (s.style !== "double_top_bottom" || s.side > 0) continue; // Chỉ Hai đỉnh SHORT
        const risk = Math.abs(s.entry - s.stop) / s.entry;
        if (risk < 0.003 || risk > 0.04 || Math.abs(s.distancePct) > 0.02) continue;

        const notional = RISK_PER_TRADE / risk;
        const lev = Math.max(1, Math.min(20, Math.floor(notional / 8)));

        lines1h.push(
          `• ${coin} 🔴 SHORT (Hai đỉnh 1h): nến 1h đóng < ${f(s.entry)} (cách ${(Math.abs(s.distancePct) * 100).toFixed(2)}%) · SL ${f(s.stop)} (${(risk * 100).toFixed(1)}%) · x${lev}`
        );
      }
    } catch (e) {
      console.error(`telegram pre ${coin}`, e);
    }
  }

  // Với slot 1H riêng lẻ: chỉ gửi tin nếu có coin đang chờ để tránh spam mỗi giờ
  if (!is4hSlot && !lines1h.length) {
    return null;
  }

  let msg = "";
  if (is4hSlot) {
    msg = `⏰ Nến 4h đóng lúc ${vnTime(close4h)} (còn ~${Math.round(left4h / 60_000)} phút)\n`;
    if (lines4h.length) {
      msg += `📌 Setup 4H có thể kích hoạt:\n${lines4h.join("\n")}\n`;
    } else {
      msg += `📌 Không có coin nào sắp kích hoạt 4h.\n`;
    }
    if (lines1h.length) {
      msg += `\n⚡ Lướt 1H sắp đóng nến:\n${lines1h.join("\n")}\n`;
    }
    msg += `\nChỉ vào sau khi nến ĐÓNG đúng điều kiện; bot sẽ báo lại khi kích hoạt.`;
  } else {
    msg = `⚡ [1H] Sắp đóng nến lúc ${vnTime(close1h)} (còn ~${Math.round(left1h / 60_000)} phút)\n` +
      `🔴 Có thể kích hoạt Hai đỉnh SHORT 1h:\n${lines1h.join("\n")}\n` +
      `\nChỉ vào lệnh sau khi nến 1h ĐÓNG NẾN; bot sẽ báo lại khi kích hoạt.`;
  }

  await send(msg);
  return msg;
}
