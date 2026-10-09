// 4h signal alerts to Telegram. Same rule as the scanner (lib/patterns.ts + daily-trend filter, PLAN.md).
// Runs inside the web server (instrumentation.ts) every few minutes; only NEW tradeable signals are sent.
import { analyse } from "@/lib/patterns";
import { candles } from "@/lib/okx";

const COINS = ["BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK", "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"];
const MARGIN = Number(process.env.ALERT_MARGIN ?? 10); // owner's margin per trade ($)
const CAPITAL = Number(process.env.ALERT_CAPITAL ?? 57);
const BOLD = (process.env.ALERT_MODE ?? "bold") === "bold"; // owner's LINK style: all 4h signals, whole margin x10, TP 0.75R

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

// History (21 coins 2023–2026, 4h, TP 0.75R, 48h): share that hit TP first / SL first / neither
const ODDS: Record<string, [number, number, number]> = {
  "bos:1": [42, 25, 33], "bos:-1": [39, 25, 36], "double_top_bottom:1": [41, 24, 35], "double_top_bottom:-1": [44, 26, 30],
};
const odds = (style: string, side: number) => { const o = ODDS[`${style}:${side}`]; return o ? `Lịch sử (TP 0,75R): chạm TP trước ${o[0]}% · chạm SL trước ${o[1]}% · 48h chưa chạm ${o[2]}%` : ""; };

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
        if (!BOLD) {
          if (s.style === "bos" && s.side < 0) continue;
          if (s.style === "double_top_bottom" && !(btc === s.side && own === s.side)) continue;
          if (own !== s.side) continue; // only ★ trades (coin with its daily trend)
        }
        const key = `${coin}:${s.style}:${s.side}:${a.lastBarTime}`;
        if (sent.has(key)) continue;
        sent.add(key);
        const R = Math.abs(s.entry - s.stop), lev = BOLD ? Math.min(10, Math.floor(0.85 / risk)) : Math.min(20, (CAPITAL * 0.1) / (MARGIN * risk)), notional = MARGIN * lev, riskUsd = notional * risk;
        out.push(
          `🚨 ${coin} ${s.side > 0 ? "🟢 LONG" : "🔴 SHORT"} · ${s.style === "bos" ? "BOS 4h" : s.side > 0 ? "Hai đáy 4h" : "Hai đỉnh 4h"}${own === s.side ? " · ★ coin cùng xu hướng ngày" : ""}\n` +
          `Vào ~${f(s.entry)} (nến 4h vừa đóng; bỏ nếu giá đã chạy quá ${f(s.entry + s.side * 0.5 * R)})\n` +
          `SL ${f(s.stop)} (${(risk * 100).toFixed(2)}%) · THOÁT SỚM nếu nến 4h đóng ${s.side > 0 ? "dưới" : "trên"} ${f(s.level)}\n` +
          (BOLD ? `TP ${f(s.entry + s.side * 0.75 * R)} (0,75R)\n` : `TP: nửa ở ${f(s.entry + s.side * 0.5 * R)} (0,5R) → dời SL về giá vào · nửa ở ${f(s.entry + s.side * R)} (1R)\n`) +
          `Đòn bẩy x${lev.toFixed(lev < 10 ? 1 : 0)} · ký quỹ ${MARGIN}$ (vị thế ${notional.toFixed(0)}$) · mất ~${riskUsd.toFixed(1)}$ ở SL / lời ~${(riskUsd * 0.75).toFixed(1)}$ ở TP\n` +
          odds(s.style, s.side),
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
const vnTime = (t: number) => new Date(t).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
declare global {
  var telegramPreSent: Set<string> | undefined;
}
const preSent = (globalThis.telegramPreSent ??= new Set<string>());

/** Heads-up ~10m before each 4h close: list setups that could trigger at that close. */
export async function preAlert(now = Date.now(), force = false): Promise<string | null> {
  const close = Math.floor(now / H4) * H4 + H4;
  const left = close - now;
  let slot = "";
  if (force) {
    slot = "force";
  } else if (left <= 15 * 60_000 && left >= 3 * 60_000) {
    slot = "10m";
  } else {
    return null;
  }

  const key = `${close}:${slot}`;
  if (!force && preSent.has(key)) return null;
  preSent.add(key);

  const btc = await dailyTrend("BTC");
  const lines: string[] = [];
  for (const coin of COINS) {
    try {
      const [a, own] = await Promise.all([analyse(await candles(`${coin}-USDT-SWAP`, "4H", 300)), coin === "BTC" ? btc : dailyTrend(coin)]);
      for (const s of a.setups) {
        if (s.state !== "pending") continue;
        const risk = Math.abs(s.entry - s.stop) / s.entry;
        if (risk < 0.004 || risk > 0.08 || Math.abs(s.distancePct) > 0.03) continue;
        if (!BOLD && ((s.style === "bos" && s.side < 0) || own !== s.side || (s.style === "double_top_bottom" && btc !== s.side))) continue;
        const R = Math.abs(s.entry - s.stop);
        const lev = BOLD ? Math.min(10, Math.floor(0.85 / risk)) : Math.min(20, (CAPITAL * 0.1) / (MARGIN * risk));
        lines.push(
          `• ${coin} ${s.side > 0 ? "🟢 LONG" : "🔴 SHORT"} (${s.style === "bos" ? "BOS" : s.side > 0 ? "hai đáy" : "hai đỉnh"}${own === s.side ? ", ★" : ""}): ` +
          `nến 4h đóng ${s.side > 0 ? ">" : "<"} ${f(s.entry)} (còn cách ${(Math.abs(s.distancePct) * 100).toFixed(2)}%) · SL ${f(s.stop)} (${(risk * 100).toFixed(1)}%) · ` +
          `TP ${f(s.entry + s.side * (BOLD ? 0.75 : 0.5) * R)} · x${lev.toFixed(lev < 10 ? 1 : 0)}`,
        );
      }
    } catch (e) {
      console.error(`telegram pre ${coin}`, e);
    }
  }
  const msg = `⏰ Nến 4h đóng lúc ${vnTime(close)} (còn ~${Math.round(left / 60_000)} phút)\n` +
    (lines.length ? `Có thể kích hoạt (canh sẵn):\n${lines.join("\n")}\nChỉ vào sau khi nến ĐÓNG đúng điều kiện; bot sẽ báo lại nếu kích hoạt.` : "Không có coin nào sắp kích hoạt. Không cần canh.");
  await send(msg);
  return msg;
}
