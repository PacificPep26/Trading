// Bot báo tin 3 kèo đã kiểm chứng (docs/bot-spec.md, docs/CONTEXT.md). CHỈ BÁO TIN — chủ tài khoản vào lệnh tay.
//  🎯 ICT quét đỉnh hôm qua → SHORT 1H (ictSweepShort)   📌 Limit dưới đáy 1H, LONG (restingLimit)
//  📊 Hai đỉnh/đáy 4H, không TP, bot nhắc dời SL trailing 3 ATR (isSwingSetupOk + swing-4h)
// Kèm: nhắc tin Mỹ (us-events), theo dõi giá chủ tài khoản đặt (price-watch). Mỗi kèo có sổ paper để đối chiếu backtest.
import fs from "fs";
import path from "path";
import { analyse, restingLimit, ictSweepShort } from "@/lib/patterns";
import { candles, ticker, funding, type Candle } from "@/lib/okx";
import { isSwingSetupOk } from "@/lib/trading-policy";
import { openSwing, stepSwing } from "@/lib/swing-4h";
import { addLimit, stepLimits, loadLimits } from "@/lib/resting-limit";
import { loadWatches, saveWatches, evaluateWatches } from "@/lib/price-watch";
import { US_EVENTS, newsMessages } from "@/lib/us-events";

export const COINS = [
  "BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK",
  "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF",
];
const H = 3_600_000;
// data/ là Railway volume → chống trùng và sổ paper sống qua redeploy
const DEDUP_FILE = path.join(process.cwd(), "data", "telegram-sent.json");
export const ICT_PAPER = path.join(process.cwd(), "data", "paper-ict.json");

function loadSent(): string[] {
  try {
    if (fs.existsSync(DEDUP_FILE)) return JSON.parse(fs.readFileSync(DEDUP_FILE, "utf-8")).sent ?? [];
  } catch {}
  return [];
}

declare global {
  var telegramSent: Set<string> | undefined;
}
const sent = (globalThis.telegramSent ??= new Set<string>(loadSent()));

function saveSent() {
  try {
    fs.mkdirSync(path.dirname(DEDUP_FILE), { recursive: true });
    fs.writeFileSync(DEDUP_FILE, JSON.stringify({ sent: Array.from(sent).slice(-300) }, null, 2), "utf-8");
  } catch (e) {
    console.error("[DEDUP] Không ghi được:", e);
  }
}

// Mỗi coin + chiều tối đa 1 tin kèo / 6 giờ (trừ tin thay Limit)
const hourNow = () => Math.floor(Date.now() / H);
const recentlyAlerted = (coin: string, side: number) => [0, 1, 2, 3, 4, 5].some((h) => sent.has(`ANY:${coin}:${side}:${hourNow() - h}`));
const markAlerted = (coin: string, side: number) => sent.add(`ANY:${coin}:${side}:${hourNow()}`);

// Xu hướng ngày = giá đóng ngày UTC so với EMA50 (giống backtest)
const dailyCache: Record<string, { trend: 1 | -1 | 0; ts: number }> = {};
export async function dailyTrend(coin: string): Promise<1 | -1 | 0> {
  const c = dailyCache[coin];
  if (c && Date.now() - c.ts < 30 * 60_000) return c.trend;
  try {
    const cs = (await candles(`${coin}-USDT-SWAP`, "1Dutc", 300)).filter((x) => x.closed);
    let ema = cs[0].c;
    for (const x of cs) ema += (2 / 51) * (x.c - ema);
    const trend: 1 | -1 | 0 = cs.length < 60 ? 0 : cs.at(-1)!.c > ema ? 1 : -1;
    dailyCache[coin] = { trend, ts: Date.now() };
    return trend;
  } catch {
    return c?.trend ?? 0;
  }
}

// coin giá rất nhỏ (PEPE) cần chữ số có nghĩa, không phải số lẻ cố định
export const f = (v: number) => v.toLocaleString("vi-VN", v > 0 && v < 0.01 ? { maximumSignificantDigits: 5 } : { maximumFractionDigits: v > 1000 ? 1 : v > 1 ? 3 : 7 });
const vnTime = (t: number) => new Date(t).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });

export async function send(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.log("[TELEGRAM chưa cấu hình]\n" + text);
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    if (!res.ok) console.error(`Telegram ${res.status}:`, await res.text());
    return res.ok;
  } catch (e) {
    console.error("Telegram send error", e);
    return false;
  }
}

/** Tin kèo mẫu chung 2 dòng. tp = undefined: kèo không TP (4H trailing). */
export function planText(side: number, coin: string, how: string, entry: number, stop: number, tp?: number, note = "") {
  const r = Math.abs(entry - stop), risk = r / entry;
  const lev = Math.min(10, Math.max(1, Math.floor(0.8 / risk))); // tối đa x10; chạm SL mất ≤ 80% ký quỹ
  const exit = tp === undefined
    ? "không TP, bot nhắc dời SL"
    : `TP1 ${f(entry + Math.sign(tp - entry) * r)} · TP2 ${f(tp)}`; // TP1 = 1R: chốt 50% rồi dời SL về giá vào
  return `${side > 0 ? "🟢 LONG" : "🔴 SHORT"} *${coin}* · ${how} ${f(entry)}${note ? ` · ${note}` : ""}\n` +
    `   SL ${f(stop)} (−${(risk * 100).toFixed(1)}%) · ${exit} · x${lev}`;
}

export async function scanAndAlert(): Promise<string[]> {
  const out: string[] = [];
  const say = async (m: string) => { out.push(m); await send(m); };
  const now = Date.now();

  // Tin Mỹ: nhắc trước 1 giờ + báo nến 5m đầu của BTC sau tin (chỉ thông tin; vào theo nến đầu backtest lỗ)
  try {
    const btc5m = US_EVENTS.some((e) => now >= e.t + 5 * 60_000 && now < e.t + 30 * 60_000) ? await candles("BTC-USDT-SWAP", "5m", 12) : [];
    for (const m of newsMessages(US_EVENTS, now, sent, btc5m)) await say(m);
  } catch (e) {
    console.error("[NEWS]", e);
  }

  // Theo dõi giá chủ tài khoản đặt qua Telegram ("theo dõi SUI 1.041 1.029 1.085 btc 82750")
  const watches = loadWatches();
  if (watches.length) {
    const price: Record<string, number> = {};
    for (const c of new Set([...watches.map((w) => w.coin), "BTC"])) {
      price[c] = (await ticker(`${c}-USDT-SWAP`).catch(() => null))?.last ?? NaN;
    }
    const { msgs, keep } = evaluateWatches(watches, price);
    for (const m of msgs) await say(m);
    if (msgs.length) saveWatches(keep);
  }

  const minute = new Date(now).getUTCMinutes();
  const after1h = minute < 15; // nến 1H vừa đóng
  const after4h = after1h && new Date(now).getUTCHours() % 4 === 0; // nến 4H vừa đóng
  if (!after1h) {
    saveSent();
    return out;
  }

  const digest: { rank: number; text: string }[] = [];
  const btc = await dailyTrend("BTC");
  const btc1h: Candle[] = after4h ? await candles("BTC-USDT-SWAP", "1H", 10).catch(() => []) : [];

  for (const coin of COINS) {
    try {
      const own = await dailyTrend(coin);

      // 📊 4H hai đỉnh/đáy: nhắc dời SL lệnh đang theo dõi, rồi tìm kèo mới
      if (after4h) {
        const bars4h = await candles(`${coin}-USDT-SWAP`, "4H", 300);
        for (const m of stepSwing(coin, bars4h)) await say(m);
        const a4 = analyse(bars4h);
        const live = (await ticker(`${coin}-USDT-SWAP`).catch(() => null))?.last;
        const fundingRate = (await funding(`${coin}-USDT-SWAP`).catch(() => null))?.rate;
        for (const s of a4.setups) {
          const key = `4H:${coin}:${s.side}:${a4.lastBarTime}`;
          if (sent.has(key) || !isSwingSetupOk(s, { ownDaily: own, btcDaily: btc, lastBarTime: a4.lastBarTime, now, btc1h, fundingRate, livePrice: live })) continue;
          sent.add(key);
          const entry = live ?? s.entry;
          openSwing(coin, { side: s.side, entry, stop: s.stop, entryTime: a4.lastBarTime + 4 * H });
          digest.push({ rank: 0, text: planText(s.side, coin, `📊 4H ${s.side > 0 ? "hai đáy" : "hai đỉnh"}`, entry, s.stop) });
          markAlerted(coin, s.side);
        }
      }

      // 1H: sổ paper 📌 và 🎯 (100 nến: ICT cần trọn ngày hôm qua, có khi cả hôm kia)
      const bars1h = await candles(`${coin}-USDT-SWAP`, "1H", 100);
      for (const m of stepLimits(coin, bars1h)) await say(m);
      for (const m of stepLimits(coin, bars1h, ICT_PAPER)) await say(m);

      // 🎯 ICT quét đỉnh hôm qua → ChoCh → Sell Limit giữa FVG, TP đáy hôm qua
      const ict = ictSweepShort(bars1h);
      const ictKey = ict && `ICT:${coin}:${ict.barTime}`;
      if (ict && ictKey && !sent.has(ictKey)) {
        sent.add(ictKey);
        addLimit(coin, ict, ICT_PAPER);
        digest.push({ rank: 1, text: planText(-1, coin, "🎯 ICT Limit", ict.limit, ict.stop, ict.tp, "quét đỉnh hôm qua") });
        markAlerted(coin, -1);
      }

      // 📌 Limit mua dưới đáy 1H vừa xác nhận (coin tăng ngày); đáy mới thay Limit cũ chưa khớp
      const rl = own > 0 ? restingLimit(bars1h, 1) : null;
      const rlKey = rl && `RL:${coin}:${rl.barTime}`;
      const oldRl = rl && loadLimits().find((x) => x.coin === coin && x.status === "pending");
      if (rl && rlKey && !sent.has(rlKey) && addLimit(coin, rl, undefined, true)) {
        sent.add(rlKey);
        // tin thay Limit luôn gửi để chủ tài khoản huỷ lệnh cũ trên sàn
        if (oldRl || !recentlyAlerted(coin, 1)) {
          digest.push({ rank: 2, text: planText(1, coin, "📌 Limit", rl.limit, rl.stop, rl.tp, oldRl ? `huỷ Limit cũ ${f(oldRl.limit)}` : "") });
        }
        markAlerted(coin, 1);
      }
    } catch (e) {
      console.error(`[SCAN] ${coin}:`, e);
    }
  }

  if (digest.length) {
    digest.sort((a, b) => a.rank - b.rank);
    await say(`📋 *KÈO MỚI ${vnTime(now)}*\n` + digest.map((d) => d.text).join("\n"));
  }
  saveSent();
  return out;
}
