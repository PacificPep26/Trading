// 4h signal alerts to Telegram. Same rule as the scanner (lib/patterns.ts + daily-trend filter, PLAN.md).
// Runs inside the web server (instrumentation.ts) every few minutes; only NEW tradeable signals are sent.
import { analyse } from "@/lib/patterns";
import { candles } from "@/lib/okx";

const COINS = ["BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK", "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"];
const MARGIN = Number(process.env.ALERT_MARGIN ?? 10); // owner's margin per trade ($)
const LEV = 10;

declare global {
  var telegramSent: Set<string> | undefined;
}
const sent = (globalThis.telegramSent ??= new Set<string>());

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

/** Scan once; send new tradeable signals. Returns the messages sent. */
export async function scanAndAlert(): Promise<string[]> {
  const btc = await dailyTrend("BTC");
  const out: string[] = [];
  for (const coin of COINS) {
    try {
      const [a, own] = await Promise.all([analyse(await candles(`${coin}-USDT-SWAP`, "4H", 300)), coin === "BTC" ? btc : dailyTrend(coin)]);
      for (const s of a.setups) {
        if (s.state !== "triggered") continue;
        const risk = Math.abs(s.entry - s.stop) / s.entry;
        if (risk < 0.004 || risk > 0.08) continue;
        if (s.style === "bos" && s.side < 0) continue;
        if (s.style === "double_top_bottom" && !(btc === s.side && own === s.side)) continue;
        const key = `${coin}:${s.style}:${s.side}:${a.lastBarTime}`;
        if (sent.has(key)) continue;
        sent.add(key);
        const R = Math.abs(s.entry - s.stop), notional = MARGIN * LEV, riskUsd = notional * risk;
        out.push(
          `🚨 ${coin} ${s.side > 0 ? "🟢 LONG" : "🔴 SHORT"} · ${s.style === "bos" ? "BOS 4h" : s.side > 0 ? "Hai đáy 4h" : "Hai đỉnh 4h"}${own === s.side ? " · ★ coin cùng xu hướng ngày" : ""}\n` +
          `Vào ~${f(s.entry)} (nến 4h vừa đóng; bỏ nếu giá đã chạy quá ${f(s.entry + s.side * 0.5 * R)})\n` +
          `SL ${f(s.stop)} (${(risk * 100).toFixed(2)}%)\n` +
          `TP ${f(s.entry + s.side * (own === s.side ? 1 : 0.5) * R)} (${own === s.side ? "1R, lệnh ★" : "0,5R, lệnh thường"})\n` +
          `Ký quỹ ${MARGIN}$ × ${LEV} = ${notional}$ · mất ~${riskUsd.toFixed(1)}$ ở SL / lời ~${(riskUsd * (own === s.side ? 1 : 0.5)).toFixed(1)}$ ở TP${risk > 0.085 ? " · ⚠️ SL xa: x10 sẽ thanh lý trước SL, giảm đòn bẩy" : ""}`,
        );
      }
    } catch (e) {
      console.error(`telegram scan ${coin}`, e);
    }
  }
  for (const m of out) await send(m);
  return out;
}
