// Bot báo tin 3 kèo đã kiểm chứng (docs/bot-spec.md, docs/CONTEXT.md). CHỈ BÁO TIN — chủ tài khoản vào lệnh tay.
//  🎯 ICT quét đỉnh hôm qua → SHORT 1H (ictSweepShort)   📌 Limit dưới đáy 1H, LONG (restingLimit)
//  📊 Hai đỉnh/đáy 4H, không TP, bot nhắc dời SL trailing 3 ATR (isSwingSetupOk + swing-4h)
// Kèm: nhắc tin Mỹ (us-events), theo dõi giá chủ tài khoản đặt (price-watch). Mỗi kèo có sổ paper để đối chiếu backtest.
import fs from "fs";
import path from "path";
import { f } from "./format";
import { getMexcOpenPositions } from "./mexc";
import { analyseBtcSentinel } from "./btc-sentinel";
import { analyse, restingLimit, ictSweepShort } from "./patterns";
import { candles, ticker, funding, type Candle } from "./okx";
import { isSwingSetupOk } from "./trading-policy";
import { openSwing, stepSwing } from "./swing-4h";
import { addLimit, stepLimits } from "./resting-limit";
import { loadWatches, saveWatches, evaluateWatches } from "./price-watch";
import { US_EVENTS, newsMessages } from "./us-events";
import { soSetups, SO_LABEL, highTestSetup, stFlipSetup, inducementSetup, type SoKind } from "./so-setups";

export { f };

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

// coin giá rất nhỏ (PEPE) cần chữ số có nghĩa, không phải số lẻ cố định (đã dùng f từ format.ts)
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
    `   ${exit} · SL ${f(stop)} (−${(risk * 100).toFixed(1)}%) · x${lev}`;
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

  // Vị thế thật đang mở trên MEXC: không quét báo tín hiệu mới cho các coin này để tránh spam trùng lệnh
  const mexcPositions = await getMexcOpenPositions().catch(() => []);
  const heldCoins = new Set(mexcPositions.map((p) => p.coin));

  const digest: { rank: number; text: string }[] = [];
  const btcDaily = await dailyTrend("BTC");
  const btc1h: Candle[] = await candles("BTC-USDT-SWAP", "1H", 60).catch(() => []);
  const btcSentinel = analyseBtcSentinel(btc1h, btcDaily);

  // ⚡ LA BÀN BTC: Bắt ngay cú quét thanh khoản đáy/đỉnh của BTC (ưu tiên cao nhất thị trường)
  if (btcSentinel.sweep) {
    const sw = btcSentinel.sweep;
    const sweepKey = `BTC_SWEEP:${sw.side}:${sw.barTime}`;
    if (!sent.has(sweepKey)) {
      sent.add(sweepKey);
      const how = sw.side > 0 ? "⚡ BTC QUÉT ĐÁY RÚT CHÂN" : "⚡ BTC QUÉT ĐỈNH RÚT RÂU";
      digest.push({
        rank: -1, // Ưu tiên số 1 trên cùng
        text: planText(sw.side, "BTC", how, sw.entry, sw.stop, sw.tp, sw.note),
      });
    }
  }

  for (const coin of COINS) {
    try {
      const isHeld = heldCoins.has(coin);

      if (after15m) {
        const bars15m = await candles(`${coin}-USDT-SWAP`, "15m", 120);
        stepLimits(coin, bars15m, HIGHTEST_15M_PAPER); // paper chạy ngầm, không spam tin huỷ/khớp lên chat
        if (!isHeld && coin !== "BTC") {
          const ownDaily = await dailyTrend(coin);
          for (const g of highTestSetup(bars15m, "swing")) {
            // Lọc la bàn BTC: Nếu BTC cấm short/long thì bỏ qua ngay để lọc nhiễu altcoin
            if (g.side > 0 && !btcSentinel.allowLong) continue;
            if (g.side < 0 && !btcSentinel.allowShort) continue;
            if (ownDaily !== 0 && g.side !== ownDaily) continue;

            const key = `HT15:${coin}:${g.side}:${g.barTime}`;
            if (sent.has(key)) continue;
            sent.add(key);
            addLimit(coin, { side: g.side, level: g.trigger, limit: g.trigger, stop: g.stop, tp: g.tp, atr: 0, barTime: g.barTime, stopEntry: true, barMs: 15 * 60_000 }, HIGHTEST_15M_PAPER);
            digest.push({ rank: 0, text: planText(g.side, coin, `🔨 15m high test, chờ ${g.side > 0 ? "mua" : "bán"} phá`, g.trigger, g.stop, g.tp, "huỷ sau 45m · BT +1.501$/+295$ ✅") });
          }
        }
      }

      if (after4h) {
        const bars4h = await candles(`${coin}-USDT-SWAP`, "4H", 300);
        stepSwing(coin, bars4h); // 📊 chỉ paper im lặng
        stepLimits(coin, bars4h, HIGHTEST_PAPER); // paper im lặng
        stepSwing(coin, bars4h, ST_PAPER); // paper im lặng

        if (!isHeld && coin !== "BTC") {
          const own = await dailyTrend(coin);
          // 🔨 nến high test (Jason Graystone) → lệnh chờ phá râu, 3 nến 4H, TP 2R
          for (const g of highTestSetup(bars4h)) {
            if (g.side > 0 && !btcSentinel.allowLong) continue;
            if (g.side < 0 && !btcSentinel.allowShort) continue;
            const key = `HT:${coin}:${g.side}:${g.barTime}`;
            if (sent.has(key)) continue;
            sent.add(key);
            addLimit(coin, { side: g.side, level: g.trigger, limit: g.trigger, stop: g.stop, tp: g.tp, atr: 0, barTime: g.barTime, stopEntry: true, barMs: 4 * H }, HIGHTEST_PAPER);
            digest.push({ rank: 0, text: planText(g.side, coin, `🔨 4H high test, chờ ${g.side > 0 ? "mua" : "bán"} phá`, g.trigger, g.stop, g.tp, "huỷ sau 12h · BT +303$/+132$ ✅") });
          }
          // 📈 Supertrend 4H đổi màu (Wysetrade) → vào ngay, không TP, SL dời theo dải
          const st = stFlipSetup(bars4h);
          if (st && !sent.has(`ST:${coin}:${st.barTime}`)) {
            if ((st.side > 0 && btcSentinel.allowLong) || (st.side < 0 && btcSentinel.allowShort)) {
              sent.add(`ST:${coin}:${st.barTime}`);
              if (openSwing(coin, { side: st.side, entry: st.entry, stop: st.stop, entryTime: st.barTime + 4 * H, trail: "st" }, ST_PAPER))
                digest.push({ rank: 0, text: planText(st.side, coin, "📈 Supertrend 4H đổi màu", st.entry, st.stop, undefined, "BT +139$/+85$ ✅") });
            }
          }
          const a4 = analyse(bars4h);
          const live = (await ticker(`${coin}-USDT-SWAP`).catch(() => null))?.last;
          const fundingRate = (await funding(`${coin}-USDT-SWAP`).catch(() => null))?.rate;
          for (const s of a4.setups) {
            const key = `4H:${coin}:${s.side}:${a4.lastBarTime}`;
            if (sent.has(key) || !isSwingSetupOk(s, { ownDaily: own, btcDaily, lastBarTime: a4.lastBarTime, now, btc1h, fundingRate, livePrice: live })) continue;
            sent.add(key);
            const entry = live ?? s.entry;
            openSwing(coin, { side: s.side, entry, stop: s.stop, entryTime: a4.lastBarTime + 4 * H });
          }
        }
      }

      if (after1h) {
        // 1H: 300 nến cho kèo SO Trading; 📌 và 🎯 dùng 100 nến cuối như backtest (ICT cần trọn ngày hôm qua, có khi cả hôm kia)
        const bars300 = await candles(`${coin}-USDT-SWAP`, "1H", 300);
        const bars1h = bars300.slice(-100);
        stepLimits(coin, bars1h); // 📌 chỉ paper im lặng
        stepLimits(coin, bars1h, ICT_PAPER); // paper im lặng
        stepLimits(coin, bars1h, soPaper("pullback")); // paper im lặng
        stepLimits(coin, bars1h, IDM_PAPER); // paper im lặng

        if (!isHeld && coin !== "BTC") {
          const own = await dailyTrend(coin);
          // 🧲 TradingLab: đỉnh/đáy B là mồi nhử (FVG chưa lấp phía sau) → Limit ở vùng A; vùng mới thay lệnh chờ cũ
          for (const g of inducementSetup(bars300)) {
            if (g.side > 0 && !btcSentinel.allowLong) continue;
            if (g.side < 0 && !btcSentinel.allowShort) continue;
            const key = `IDM:${coin}:${g.side}:${g.barTime}`;
            if (sent.has(key)) continue;
            sent.add(key);
            addLimit(coin, { side: g.side, level: g.limit, limit: g.limit, stop: g.stop, tp: g.tp, atr: 0, barTime: g.barTime }, IDM_PAPER, true);
            digest.push({ rank: 3, text: planText(g.side, coin, "🧲 Mồi nhử + FVG, Limit vùng A", g.limit, g.stop, g.tp, "huỷ sau 24h · BT +60$/+169$ mỏng") });
          }
          // Kèo SO Trading: chỉ giữ 🔁 Hồi đỉnh cũ (đạt chuẩn)
          for (const so of soSetups(bars300).filter((s) => s.kind === "pullback")) {
            if (so.side > 0 && !btcSentinel.allowLong) continue;
            if (so.side < 0 && !btcSentinel.allowShort) continue;
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
            if (btcSentinel.allowShort) {
              sent.add(ictKey);
              addLimit(coin, ict, ICT_PAPER);
              digest.push({ rank: 1, text: planText(-1, coin, "🎯 ICT Limit", ict.limit, ict.stop, ict.tp, "quét đỉnh hôm qua") });
              markAlerted(coin, -1);
            }
          }

          // 📌 Limit dưới đáy 1H: CHỈ PAPER
          const rl = own > 0 ? restingLimit(bars1h, 1) : null;
          if (rl && !sent.has(`RL:${coin}:${rl.barTime}`)) {
            sent.add(`RL:${coin}:${rl.barTime}`);
            addLimit(coin, rl, undefined, true);
          }
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
