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
import { addLimit, stepLimits } from "@/lib/resting-limit";
import { loadWatches, saveWatches, evaluateWatches } from "@/lib/price-watch";
import { US_EVENTS, newsMessages } from "@/lib/us-events";
import { soSetups, SO_LABEL, highTestSetup, stFlipSetup, inducementSetup, type SoKind } from "@/lib/so-setups";

export const COINS = [
  "BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK",
  "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF",
];
const H = 3_600_000;
// data/ là Railway volume → chống trùng và sổ paper sống qua redeploy
const DEDUP_FILE = path.join(process.cwd(), "data", "telegram-sent.json");
export const ICT_PAPER = path.join(process.cwd(), "data", "paper-ict.json");
// 4 kèo SO Trading: chủ dự án chọn báo cả 4 kèm số backtest (chỉ "hồi đỉnh cũ" đạt chuẩn) — mỗi kèo 1 sổ paper
export const soPaper = (k: SoKind) => path.join(process.cwd(), "data", `paper-so-${k}.json`);
export const HIGHTEST_PAPER = path.join(process.cwd(), "data", "paper-hightest.json");
export const HIGHTEST_15M_PAPER = path.join(process.cwd(), "data", "paper-hightest-15m.json");
export const ST_PAPER = path.join(process.cwd(), "data", "paper-st.json");
export const IDM_PAPER = path.join(process.cwd(), "data", "paper-idm.json");

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

// Đánh dấu coin + chiều đã báo trong giờ (giữ cho thống kê chống trùng)
const hourNow = () => Math.floor(Date.now() / H);
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
export function planText(side: number, coin: string, how: string, entry: number, stop: number, tp?: number, note = "", tp1?: number) {
  const r = Math.abs(entry - stop), risk = r / entry;
  const lev = Math.min(10, Math.max(1, Math.floor(0.8 / risk))); // tối đa x10; chạm SL mất ≤ 80% ký quỹ
  const exit = tp === undefined
    ? "không TP, bot nhắc dời SL"
    : `TP1 ${f(tp1 ?? entry + Math.sign(tp - entry) * r)} · TP2 ${f(tp)}`; // TP1 mặc định 1R: chốt 50% rồi dời SL về giá vào
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
  const after15m = minute % 15 < 3; // nến 15m vừa đóng (trong 3 phút đầu)
  const after1h = minute < 15; // nến 1H vừa đóng
  const after4h = after1h && new Date(now).getUTCHours() % 4 === 0; // nến 4H vừa đóng
  if (!after15m && !after1h) {
    saveSent();
    return out;
  }

  const digest: { rank: number; text: string }[] = [];
  const btc = after4h ? await dailyTrend("BTC") : 0;
  const btc1h: Candle[] = after4h ? await candles("BTC-USDT-SWAP", "1H", 10).catch(() => []) : [];

  for (const coin of COINS) {
    try {
      const own = after1h || after4h ? await dailyTrend(coin) : 0;

      if (after15m) {
        const bars15m = await candles(`${coin}-USDT-SWAP`, "15m", 120);
        for (const m of stepLimits(coin, bars15m, HIGHTEST_15M_PAPER)) await say(m);
        for (const g of highTestSetup(bars15m, "swing")) {
          const key = `HT15:${coin}:${g.side}:${g.barTime}`;
          if (sent.has(key)) continue;
          sent.add(key);
          addLimit(coin, { side: g.side, level: g.trigger, limit: g.trigger, stop: g.stop, tp: g.tp, atr: 0, barTime: g.barTime, stopEntry: true, barMs: 15 * 60_000 }, HIGHTEST_15M_PAPER);
          digest.push({ rank: 0, text: planText(g.side, coin, `🔨 15m high test, chờ ${g.side > 0 ? "mua" : "bán"} phá`, g.trigger, g.stop, g.tp, "huỷ sau 45m · BT +1.501$/+295$ ✅") });
        }
      }

      if (after4h) {
        const bars4h = await candles(`${coin}-USDT-SWAP`, "4H", 300);
        stepSwing(coin, bars4h); // 📊 chỉ paper im lặng (tắt tin 15/10: 14 ngày gần nhất −2.4$)
        for (const m of stepLimits(coin, bars4h, HIGHTEST_PAPER)) await say(m);
        // 🔨 nến high test (Jason Graystone) → lệnh chờ phá râu, 3 nến 4H, TP 2R
        for (const g of highTestSetup(bars4h)) {
          const key = `HT:${coin}:${g.side}:${g.barTime}`;
          if (sent.has(key)) continue;
          sent.add(key);
          addLimit(coin, { side: g.side, level: g.trigger, limit: g.trigger, stop: g.stop, tp: g.tp, atr: 0, barTime: g.barTime, stopEntry: true, barMs: 4 * H }, HIGHTEST_PAPER);
          digest.push({ rank: 0, text: planText(g.side, coin, `🔨 4H high test, chờ ${g.side > 0 ? "mua" : "bán"} phá`, g.trigger, g.stop, g.tp, "huỷ sau 12h · BT +303$/+132$ ✅") });
        }
        // 📈 Supertrend 4H đổi màu (Wysetrade) → vào ngay, không TP, SL dời theo dải
        for (const m of stepSwing(coin, bars4h, ST_PAPER)) await say(`📈 Supertrend ${m}`);
        const st = stFlipSetup(bars4h);
        if (st && !sent.has(`ST:${coin}:${st.barTime}`)) {
          sent.add(`ST:${coin}:${st.barTime}`);
          if (openSwing(coin, { side: st.side, entry: st.entry, stop: st.stop, entryTime: st.barTime + 4 * H, trail: "st" }, ST_PAPER))
            digest.push({ rank: 0, text: planText(st.side, coin, "📈 Supertrend 4H đổi màu", st.entry, st.stop, undefined, "BT +139$/+85$ ✅") });
        }
        const a4 = analyse(bars4h);
        const live = (await ticker(`${coin}-USDT-SWAP`).catch(() => null))?.last;
        const fundingRate = (await funding(`${coin}-USDT-SWAP`).catch(() => null))?.rate;
        for (const s of a4.setups) {
          const key = `4H:${coin}:${s.side}:${a4.lastBarTime}`;
          if (sent.has(key) || !isSwingSetupOk(s, { ownDaily: own, btcDaily: btc, lastBarTime: a4.lastBarTime, now, btc1h, fundingRate, livePrice: live })) continue;
          sent.add(key);
          const entry = live ?? s.entry;
          openSwing(coin, { side: s.side, entry, stop: s.stop, entryTime: a4.lastBarTime + 4 * H });
        }
      }

      if (after1h) {
        // 1H: 300 nến cho kèo SO Trading; 📌 và 🎯 dùng 100 nến cuối như backtest (ICT cần trọn ngày hôm qua, có khi cả hôm kia)
        const bars300 = await candles(`${coin}-USDT-SWAP`, "1H", 300);
        const bars1h = bars300.slice(-100);
        stepLimits(coin, bars1h); // 📌 chỉ paper im lặng
        for (const m of stepLimits(coin, bars1h, ICT_PAPER)) await say(m);
        for (const k of Object.keys(SO_LABEL) as SoKind[]) for (const m of stepLimits(coin, bars1h, soPaper(k))) await say(m);

        // Kèo SO Trading (lời thoại video): tin ghi kèm số backtest 2025/2026
        // 🧲 TradingLab: đỉnh/đáy B là mồi nhử (FVG chưa lấp phía sau) → Limit ở vùng A; vùng mới thay lệnh chờ cũ
        for (const m of stepLimits(coin, bars1h, IDM_PAPER)) await say(m);
        for (const g of inducementSetup(bars300)) {
          const key = `IDM:${coin}:${g.side}:${g.barTime}`;
          if (sent.has(key)) continue;
          sent.add(key);
          addLimit(coin, { side: g.side, level: g.limit, limit: g.limit, stop: g.stop, tp: g.tp, atr: 0, barTime: g.barTime }, IDM_PAPER, true);
          digest.push({ rank: 3, text: planText(g.side, coin, "🧲 Mồi nhử + FVG, Limit vùng A", g.limit, g.stop, g.tp, "huỷ sau 24h · BT +60$/+169$ mỏng") });
        }
        for (const so of soSetups(bars300)) {
          const key = `SO:${so.kind}:${coin}:${so.side}:${so.barTime}`;
          if (sent.has(key)) continue;
          sent.add(key);
          addLimit(coin, { side: so.side, level: so.entry, limit: so.entry, stop: so.stop, tp: so.tp, atr: 0, barTime: so.barTime, market: !so.limit }, soPaper(so.kind));
          const lab = SO_LABEL[so.kind];
          digest.push({ rank: 3, text: planText(so.side, coin, `${lab.name} ${so.limit ? "Limit" : "vào"}`, so.entry, so.stop, so.tp, lab.stats, so.tp1) });
        }

        // 🎯 ICT quét đỉnh hôm qua → ChoCh → Sell Limit giữa FVG, TP đáy hôm qua
        const ict = ictSweepShort(bars1h);
        const ictKey = ict && `ICT:${coin}:${ict.barTime}`;
        if (ict && ictKey && !sent.has(ictKey)) {
          sent.add(ictKey);
          addLimit(coin, ict, ICT_PAPER);
          digest.push({ rank: 1, text: planText(-1, coin, "🎯 ICT Limit", ict.limit, ict.stop, ict.tp, "quét đỉnh hôm qua") });
          markAlerted(coin, -1);
        }

        // 📌 Limit dưới đáy 1H: CHỈ PAPER, không gửi tin (chủ dự án 15/10 bỏ kèo cũ; sổ thật 14–15/10: 14 lệnh, thắng 1, −30$;
        // chạy lại 14 ngày: 102 lệnh −105$ — chỉ LONG nên dính SL loạt khi thị trường giảm)
        const rl = own > 0 ? restingLimit(bars1h, 1) : null;
        if (rl && !sent.has(`RL:${coin}:${rl.barTime}`)) {
          sent.add(`RL:${coin}:${rl.barTime}`);
          addLimit(coin, rl, undefined, true);
        }
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
