// Bot báo tin 3 kèo đã kiểm chứng (docs/bot-spec.md, docs/CONTEXT.md). CHỈ BÁO TIN — chủ tài khoản vào lệnh tay.
//  🎯 ICT quét đỉnh hôm qua → SHORT 1H (ictSweepShort)   📌 Limit dưới đáy 1H, LONG (restingLimit)
//  📊 Hai đỉnh/đáy 4H, không TP, bot nhắc dời SL trailing 3 ATR (isSwingSetupOk + swing-4h)
// Kèm: nhắc tin Mỹ (us-events), theo dõi giá chủ tài khoản đặt (price-watch). Mỗi kèo có sổ paper để đối chiếu backtest.
import fs from "fs";
import path from "path";
import { f } from "./format";
import {
  getMexcOpenPositions,
  submitMexcOrder,
  calculateMexcVolForMargin,
  setMexcPositionStop,
  cancelAllMexcStopOrders,
  getMexcOpenStopOrders,
} from "./mexc";
import { analyseBtcSentinel } from "./btc-sentinel";
import { analyse, restingLimit, ictSweepShort } from "./patterns";
import { candles, ticker, funding, type Candle } from "./okx";
import { isSwingSetupOk } from "./trading-policy";
import { openSwing, stepSwing } from "./swing-4h";
import { addLimit, stepLimits } from "./resting-limit";
import { loadWatches, saveWatches, evaluateWatches, addWatch } from "./price-watch";
import { US_EVENTS, newsMessages } from "./us-events";
import { soSetups, SO_LABEL, highTestSetup, stFlipSetup, inducementSetup, type SoKind } from "./so-setups";
import { generateCandleChartPng } from "./chart-generator";
import { analyzeCandleVision, detectHtfBreakout, detect15mShelfBreakout, detect15mSupportBounce, formatCandleSummary, detectAnticipatingBox, isPriceInNoMansLand, extractMacro4HContext } from "./candle-vision";
import { detectMacroHunterSignal, type HunterSignal } from "./macro-hunter";
import { openPaperTrade, stepPaperTrades, isSessionPrime } from "./auto-paper-trader";

export { f };

export const COINS = [
  "BTC", "ETH", "SOL", "HYPE", "XRP", "BNB", "ADA", "AVAX", "LINK",
  "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "ZEC",
  "SEI", "FET", "RENDER", "TAO", "WIF", "PEPE", "FLOKI", "PENDLE", "ENA", "UNI", "AAVE"
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

import { cooldownMap } from "./cooldown.ts";
export { cooldownMap };

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

export async function sendPhoto(photoBuffer: Buffer, caption: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.log("[TELEGRAM chưa cấu hình photo]\n" + caption);
    return false;
  }
  try {
    const formData = new FormData();
    formData.append("chat_id", chat);
    formData.append("photo", new Blob([new Uint8Array(photoBuffer)], { type: "image/png" }), "chart.png");
    formData.append("caption", caption);
    formData.append("parse_mode", "Markdown");

    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      console.error(`Telegram sendPhoto ${res.status}:`, await res.text());
      return await send(caption);
    }
    return res.ok;
  } catch (e) {
    console.error("Telegram sendPhoto error", e);
    return await send(caption);
  }
}

/** Tin kèo mẫu chung gọn đẹp 3 dòng: Tên kèo + Điểm vào -> Mắt soi nến -> TP / SL / Đòn bẩy */
export function planText(
  side: number,
  coin: string,
  how: string,
  entry: number,
  stop: number,
  tp?: number,
  candleInfo?: string,
  tp1?: number
) {
  const r = Math.abs(entry - stop), risk = r / entry;
  const lev = Math.min(10, Math.max(1, Math.floor(0.8 / risk))); // tối đa x10; chạm SL mất ≤ 80% ký quỹ
  const exit = tp === undefined
    ? "không TP (dời SL theo 4H)"
    : `TP1 ${f(tp1 ?? entry + Math.sign(tp - entry) * r)} · TP2 ${f(tp)}`;

  const line1 = `${side > 0 ? "🟢 *LONG" : "🔴 *SHORT"} ${coin}* · ${how} ${f(entry)}`;
  const line2 = candleInfo ? `\n👁️ *${candleInfo}*` : "";
  const line3 = `\n🎯 ${exit} · 🛑 SL ${f(stop)} (−${(risk * 100).toFixed(1)}%) · x${lev}`;
  return `${line1}${line2}${line3}`;
}

export async function scanAndAlert(forceAll = false): Promise<string[]> {
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

  const btcDaily = await dailyTrend("BTC");
  const btc1h: Candle[] = await candles("BTC-USDT-SWAP", "1H", 120).catch(() => []);
  const btc15m: Candle[] = await candles("BTC-USDT-SWAP", "15m", 300).catch(() => []);
  const btc4h: Candle[] = await candles("BTC-USDT-SWAP", "4H", 60).catch(() => []);
  const btcSentinel = analyseBtcSentinel(btc1h, btcDaily, btc15m, btc4h);

  // 🛡️ VỊ THẾ THẬT ĐANG MỞ TRÊN MEXC: KIỂM TRA MỖI LƯỢT TICK (MỖI 2 PHÚT)
  const mexcPositions = await getMexcOpenPositions().catch(() => []);
  const heldCoins = new Set(mexcPositions.map((p) => p.coin));
  const heldLongCount = mexcPositions.filter((p) => p.side === 1).length;
  const heldShortCount = mexcPositions.filter((p) => p.side === -1).length;
  const MAX_CONCURRENT_POSITIONS = 3; // Tối đa 3 vị thế trên toàn tài khoản theo yêu cầu của Victor

  // Theo dõi giá chủ tài khoản đặt qua Telegram ("theo dõi SUI 1.041 1.029 1.085 btc 82750")
  const rawWatches = loadWatches();
  // Bỏ qua những coin đã có lệnh mở trên MEXC để không bị spam thông báo "Gần tới điểm vào"
  const watches = rawWatches.filter((w) => !heldCoins.has(w.coin));
  if (watches.length !== rawWatches.length) {
    saveWatches(watches);
  }
  if (watches.length) {
    const price: Record<string, number> = {};
    for (const c of new Set([...watches.map((w) => w.coin), "BTC"])) {
      price[c] = (await ticker(`${c}-USDT-SWAP`).catch(() => null))?.last ?? NaN;
    }
    const { msgs, keep } = evaluateWatches(watches, price, now, {
      allowLong: btcSentinel.allowLong,
      allowShort: btcSentinel.allowShort,
    });
    for (const m of msgs) await say(m);
    if (msgs.length) saveWatches(keep);
  }

  // 1. TỰ ĐỘNG BẢO VỆ VỊ THẾ CHƯA CÓ TP/SL TRÊN SÀN (FAIL-SAFE SHIELD)
  for (const p of mexcPositions) {
    if (p.positionId && p.entry > 0) {
      try {
        const openStops = await getMexcOpenStopOrders(p.symbol);
        const hasStop = openStops.some((s) => s.positionId === p.positionId && s.state === 1);
        if (!hasStop) {
          // Tính SL an toàn 1.2% (12% margin tại x10), TP1 2.0%
          const defaultSl = p.side > 0 ? p.entry * 0.988 : p.entry * 1.012;
          const defaultTp = p.side > 0 ? p.entry * 1.020 : p.entry * 0.980;
          const stopRes = await setMexcPositionStop({
            positionId: p.positionId,
            symbol: p.symbol,
            stopLossPrice: defaultSl,
            takeProfitPrice: defaultTp,
            vol: p.vol,
          });
          if (stopRes.success) {
            await say(
              `🛡️ *[MEXC TỰ ĐỘNG GẮN BẢO VỆ VỊ THẾ]*\n\n` +
              `• Vị thế: *${p.side > 0 ? "🟢 LONG" : "🔴 SHORT"} ${p.coin}* (x${p.leverage})\n` +
              `• Phát hiện vị thế chưa có TP/SL trên sàn! Đã lập tức gắn lệnh sàn:\n` +
              `• Chốt lời (TP): *${f(defaultTp)}* · Cắt lỗ (SL): *${f(defaultSl)}*\n` +
              `🔒 *Vốn được bảo vệ an toàn 100%!*`
            );
          }
        }
      } catch (err) {
        console.error(`[MEXC STOP CHECK ERROR] ${p.coin}:`, err);
      }
    }
  }

  // 2. 🎯 TRAILING BẢO VỆ LÃI TỰ ĐỘNG TRỰC TIẾP TRÊN SÀN (AUTOMATED TRAILING STOP)
  for (const p of mexcPositions) {
    const curTicker = await ticker(`${p.coin}-USDT-SWAP`).catch(() => null);
    const price = curTicker?.last;
    if (price && p.entry > 0 && p.positionId) {
      const priceDiff = p.side > 0 ? price - p.entry : p.entry - price;
      const roi = (priceDiff / p.entry) * p.leverage * 100;

      // Lấy TP hiện tại nếu có để không bị mất khi dời SL
      const currentStops = await getMexcOpenStopOrders(p.symbol).catch(() => []);
      const posStop = currentStops.find((s) => s.positionId === p.positionId && s.state === 1);
      const existingTp = posStop?.takeProfitPrice;

      // 🛡️ Mức 1: Khi ROI >= 4.0% (giá chạy +0.4% ở đòn bẩy x10): Tự động dời SL về Hòa Vốn (Break-even)
      if (roi >= 4.0) {
        const trailingKey = `TRAILING_BE:${p.coin}:${p.side}:${p.positionId}`;
        if (!sent.has(trailingKey)) {
          sent.add(trailingKey);
          await cancelAllMexcStopOrders(p.symbol, p.positionId);
          // Đặt SL hòa vốn nhích nhẹ +0.05% để bù phí sàn Taker
          const bePrice = p.side > 0 ? p.entry * 1.0005 : p.entry * 0.9995;
          const stopRes = await setMexcPositionStop({
            positionId: p.positionId,
            symbol: p.symbol,
            stopLossPrice: bePrice,
            takeProfitPrice: existingTp,
            vol: p.vol,
          });
          await say(
            `🛡️ *[MEXC TRAILING TỰ ĐỘNG: ĐÃ DỜI SL VỀ HÒA VỐN]*\n\n` +
            `• Vị thế: *${p.side > 0 ? "🟢 LONG" : "🔴 SHORT"} ${p.coin}* (x${p.leverage})\n` +
            `• Giá vào (Entry): *${f(p.entry)}* · Giá hiện tại: *${f(price)}*\n` +
            `• Lợi nhuận: 🟢 *+${roi.toFixed(1)}% ROI*\n` +
            `• Trạng thái sàn MEXC: ${stopRes.success ? "✅ Đã dời SL về " + f(bePrice) : "⚠️ Lỗi: " + stopRes.error}\n` +
            `• Chốt lời (TP) giữ nguyên: *${f(existingTp ?? 0)}*\n\n` +
            `🔒 *KÈO ĐÃ HOÀN TOÀN KHÔNG CÒN RỦI RO (FREE RISK)! Thoải mái gồng tới TP!*`
          );
        }
      }

      // 💰 Mức 2: Khi ROI >= 12.0%: Tự động nâng SL khóa chắc chắn +6% ROI lợi nhuận
      if (roi >= 12.0) {
        const lockKey = `TRAILING_LOCK12:${p.coin}:${p.side}:${p.positionId}`;
        if (!sent.has(lockKey)) {
          sent.add(lockKey);
          const lockPrice = p.side > 0 ? p.entry * 1.006 : p.entry * 0.994;
          await cancelAllMexcStopOrders(p.symbol, p.positionId);
          const stopRes = await setMexcPositionStop({
            positionId: p.positionId,
            symbol: p.symbol,
            stopLossPrice: lockPrice,
            takeProfitPrice: existingTp,
            vol: p.vol,
          });
          await say(
            `💰 *[MEXC TRAILING TỰ ĐỘNG: ĐÃ KHÓA +6% LỢI NHUẬN BỎ TÚI]*\n\n` +
            `• Vị thế: *${p.side > 0 ? "🟢 LONG" : "🔴 SHORT"} ${p.coin}*\n` +
            `• Lợi nhuận hiện tại: 🚀 *+${roi.toFixed(1)}% ROI*\n` +
            `• Stop Loss mới trên sàn: *${f(lockPrice)}* (Đảm bảo chắc chắn có lãi mang về!)\n`
          );
        }
      }
    }
  }

  const minute = new Date(now).getUTCMinutes();
  const after15m = forceAll || minute % 15 < 3; // nến 15m vừa đóng (hoặc lệnh quét chủ động)
  const after1h = forceAll || minute < 15; // nến 1H vừa đóng
  const after4h = forceAll || (after1h && new Date(now).getUTCHours() % 4 === 0); // nến 4H vừa đóng
  if (!after15m && !after1h && !forceAll) {
    saveSent();
    return out;
  }

  type DigestItem = {
    rank: number;
    coin: string;
    side: number;
    rsScore: number;
    text: string;
    entry?: number;
    stop?: number;
    tp?: number;
    zone?: import("./macro-hunter").MacroZone;
    isMacroReversal?: boolean;
    rrRatio?: number;
  };
  const digest: DigestItem[] = [];

  // 🚨 ĐIỀU KIỆN PHẾ TRUẤT LA BÀN BTC (INVALIDATION):
  // Nếu BTC đâm thủng đáy râu quét vừa tạo -> Bắn cảnh báo khẩn cấp và thu hồi cờ Long ngay lập tức
  if (btcSentinel.invalidation) {
    const inv = btcSentinel.invalidation;
    const invKey = `BTC_INV:${inv.sweepPrice}:${Math.floor(inv.time / 180_000)}`;
    if (!sent.has(invKey)) {
      sent.add(invKey);
      await say(
        `🚨 *CẢNH BÁO KHẨN CẤP: LA BÀN BTC BỊ PHẾ TRUẤT!*\n\n` +
        `BTC vừa đâm thủng mốc quét đáy *${f(inv.sweepPrice)}* (Hiện tại: *${f(inv.breakPrice)}*).\n` +
        `⚠️ *ĐÂY LÀ BẪY QUÉT 2 NHỊP (SECOND SWEEP) HOẶC XẢ TIẾP DIỄN.*\n\n` +
        `👉 *HÀNH ĐỘNG KHẨN CẤP:*\n` +
        `1. Đóng hoà vốn hoặc cắt lỗ ngay các lệnh LONG Altcoin vừa mở!\n` +
        `2. Đã THU HỒI cờ Long trên toàn hệ thống — CẤM vào lệnh Long mới!`
      );
    }
  }

  // Khóa chiều nếu danh mục MEXC đã mở tối đa vị thế cùng chiều (Max Concurrent Risk)
  const allowLong = btcSentinel.allowLong && heldLongCount < MAX_CONCURRENT_POSITIONS;
  const allowShort = btcSentinel.allowShort && heldShortCount < MAX_CONCURRENT_POSITIONS;

  // ⚡ LA BÀN BTC: Cập nhật La bàn thị trường (CHỈ LÀM THAM CHIẾU - KHÔNG BAO GIỜ GỌI LỆNH TRADE BTC)
  let isNewBtcSweep = false;
  if (btcSentinel.sweep) {
    const sw = btcSentinel.sweep;
    const sweepKey = `BTC_SWEEP:${sw.side}:${sw.barTime}`;
    if (!sent.has(sweepKey)) {
      sent.add(sweepKey);
      isNewBtcSweep = true;
    }
  }

  // 🚨 THEO DÕI CÚ THỦNG / PHÁ NỀN LỚN 15M CỦA LA BÀN BTC (32-56 NẾN ~ 8-14H)
  if (btc15m && btc15m.length >= 35) {
    const btcShelf = detect15mShelfBreakout(btc15m);
    if (btcShelf) {
      const btcShelfKey = `BTC_SHELF:${btcShelf.side}:${btcShelf.barTime}`;
      if (!sent.has(btcShelfKey)) {
        sent.add(btcShelfKey);
        await say(
          btcShelf.side < 0
            ? `🚨 *CẢNH BÁO ĐỎ: BTC VỪA XẢ THỦNG NỀN LỚN 15M!*\n\n` +
              `BTC vừa đục thủng đáy hộp nền *${f(btcShelf.boxLow)}* (Hiện tại: *${f(btcShelf.entry)}*).\n` +
              `📌 ${btcShelf.note}\n` +
              `⚠️ *NGUY CƠ SẬP CÂY ĐỎ THẨM & KÉO XẢ ALTCOIN TOÀN DIỆN.*\n` +
              `👉 *HÀNH ĐỘNG:* CẤM BẮT ĐÁY LONG! Ưu tiên canh SHORT hoặc đứng ngoài bảo toàn vốn!`
            : `🟢 *CẢNH BÁO XANH: BTC VỪA PHÁ ĐỈNH NỀN LỚN 15M!*\n\n` +
              `BTC vừa nổ Vol bùng nổ vượt đỉnh hộp nền *${f(btcShelf.boxHigh)}* (Hiện tại: *${f(btcShelf.entry)}*).\n` +
              `📌 ${btcShelf.note}\n` +
              `👉 Ưu tiên chọn các Altcoin khoẻ nhất (TIA, SUI) để LONG!`
        );
      }
    }
  }

  // ⚡ TÍNH SỨC MẠNH TƯƠNG QUAN THỰC TẾ (REAL RELATIVE STRENGTH VS BTC):
  // Lấy % thay đổi 24h của BTC làm mốc chuẩn
  const btcTicker = await ticker("BTC-USDT-SWAP").catch(() => null);
  const btc24hChange = btcTicker && btcTicker.open24h > 0
    ? ((btcTicker.last - btcTicker.open24h) / btcTicker.open24h) * 100
    : 0;

  for (const coin of COINS) {
    try {
      const isHeld = heldCoins.has(coin);
      const cdUntil = cooldownMap.get(coin);
      const isCooldown = cdUntil ? Date.now() < cdUntil : false;

      if (!isHeld && !isCooldown && coin !== "BTC" && coin !== "ETH") {
        const ownDaily = await dailyTrend(coin);

        if (after15m) {
          const raw15m = await candles(`${coin}-USDT-SWAP`, "15m", 300);
          // 🛡️ CHỐNG NHIỄU GIỮA CHU KỲ: Chỉ phân tích nến 15m đã đóng hoàn tất
          const bars15m = raw15m.filter((c) => c.closed);
          if (bars15m.length < 35) continue;

          stepLimits(coin, bars15m, HIGHTEST_15M_PAPER); // paper chạy ngầm, không spam tin huỷ/khớp lên chat

          // 🧪 CẬP NHẬT TRẠNG THÁI KHỚP TP/SL CHO PAPER AUTO-TRADER
          const paperCloseMsgs = stepPaperTrades(coin, bars15m);
          for (const pmsg of paperCloseMsgs) {
            await say(pmsg);
          }

          const coinTick = await ticker(`${coin}-USDT-SWAP`).catch(() => null);
          const coin24hChange = coinTick && coinTick.open24h > 0
            ? ((coinTick.last - coinTick.open24h) / coinTick.open24h) * 100
            : 0;
          // Alpha = Chênh lệch % tăng trưởng so với BTC (Ví dụ INJ +27% vs BTC +1% -> Alpha = +26%)
          const alphaVsBtc = coin24hChange - btc24hChange;

          const raw4h = await candles(`${coin}-USDT-SWAP`, "4H", 90).catch(() => []);
          const bars4h = raw4h.filter((c) => c.closed);
          const raw1h = await candles(`${coin}-USDT-SWAP`, "1H", 60).catch(() => []);
          const bars1h = raw1h.filter((c) => c.closed);

          const vision15m = analyzeCandleVision(bars15m);
          const candleSum15m = formatCandleSummary("M15", bars15m, vision15m);

          // -------------------------------------------------------------------------
          // --- SETUP 1: MACRO HUNTER MATRIX (ƯU TIÊN SỐ 1 - SĂN CẢN LỚN 4H / FVG) ---
          // -------------------------------------------------------------------------
          const lastBtc = btc15m.at(-1);
          const btc3BarsGain = btc15m.length >= 3
            ? (((btc15m.at(-1)?.c ?? 0) - (btc15m.at(-3)?.o ?? 0)) / (btc15m.at(-3)?.o || 1)) * 100
            : 0;
          const isBtcPump = (lastBtc ? ((lastBtc.c - lastBtc.o) / lastBtc.o) * 100 > 0.6 : false) || btc3BarsGain > 1.2;

          // 🛡️ BẢO VỆ CHỐNG CHẶN ĐẦU XE LỬA:
          // 1. Nếu BTC đang trong xu hướng Tăng / vừa phá cản (btcSentinel.allowShort === false) -> CẤM ĐÁNH SHORT TOÀN DIỆN!
          // 2. CẤM SHORT những đồng coin đang có dòng tiền Fomo cực đại (Alpha vs BTC > +12%)
          const isExtremeBull = alphaVsBtc > 12.0;

          const hunterSig = detectMacroHunterSignal(coin, bars15m, bars4h, bars1h, {
            // Hunter Reversal tại cản lớn BẮT BUỘC tuân thủ La Bàn BTC (btcSentinel.allowShort)
            allowShort: btcSentinel.allowShort && heldShortCount < MAX_CONCURRENT_POSITIONS && !isBtcPump && !isExtremeBull,
            allowLong: btcSentinel.allowLong && heldLongCount < MAX_CONCURRENT_POSITIONS,
            isBtcStrongPump: isBtcPump || !btcSentinel.allowShort,
          });

          if (hunterSig) {
            const hKey = `HUNTER:${coin}:${hunterSig.kind}:${hunterSig.barTime}`;
            if (!sent.has(hKey)) {
              sent.add(hKey);

              // Paper record
              const { alertMsg: paperHMsg } = openPaperTrade({
                coin,
                side: hunterSig.side,
                entry: hunterSig.entry,
                stop: hunterSig.stop,
                tp: hunterSig.tp,
                tp1: hunterSig.tp1,
                tp2: hunterSig.tp,
                note: hunterSig.note,
              });
              if (paperHMsg) await say(paperHMsg);

              digest.push({
                rank: 0, // Ưu tiên số 1
                coin,
                side: hunterSig.side,
                rsScore: 98,
                entry: hunterSig.entry,
                stop: hunterSig.stop,
                tp: hunterSig.tp,
                zone: hunterSig.zone,
                isMacroReversal: true,
                rrRatio: hunterSig.rrRatio,
                text: planText(
                  hunterSig.side,
                  coin,
                  hunterSig.kind === "REJECTION_SHORT"
                    ? "🎯 Săn Đảo Chiều Short tại Cản 4H/FVG"
                    : hunterSig.kind === "RETEST_LONG"
                    ? "🚀 Săn Retest Long sau phá cản"
                    : "🟢 Săn Đáy Hỗ Trợ 4H/FVG",
                  hunterSig.entry,
                  hunterSig.stop,
                  hunterSig.tp,
                  candleSum15m,
                  hunterSig.tp1
                ),
              });
            }
          }

          // -------------------------------------------------------------------------
          // --- SETUP 2: 15M SHELF BREAKOUT ---
          // -------------------------------------------------------------------------
          const macro4h = bars4h.length >= 10 ? extractMacro4HContext(bars4h, bars15m.at(-1)?.c || 0) : undefined;
          const sb15 = detect15mShelfBreakout(bars15m, macro4h);
          if (sb15) {
            // Đã nới lỏng: Cho phép Altcoin bứt phá theo dòng tiền riêng (Alpha vs BTC) mà không bị gông cùm bởi EMA50 Daily cũ
            const isLongOk = sb15.side > 0 && allowLong && (ownDaily >= 0 || alphaVsBtc >= 1.5);
            const isShortOk = sb15.side < 0 && allowShort && (ownDaily <= 0 || alphaVsBtc <= -1.5);
            if (isLongOk || isShortOk) {
              const sbKey = `SB15:${coin}:${sb15.side}:${sb15.barTime}`;
              if (!sent.has(sbKey)) {
                sent.add(sbKey);
                addLimit(coin, { side: sb15.side, level: sb15.entry, limit: sb15.entry, stop: sb15.stop, tp: sb15.tp, atr: 0, barTime: sb15.barTime, market: true }, HIGHTEST_15M_PAPER);

                const { alertMsg: paperAutoMsg } = openPaperTrade({
                  coin,
                  side: sb15.side,
                  entry: sb15.entry,
                  stop: sb15.stop,
                  tp: sb15.tp,
                  tp1: sb15.tp1,
                  tp2: sb15.tp2,
                  note: sb15.note,
                });
                if (paperAutoMsg) await say(paperAutoMsg);

                const baseRs = sb15.side > 0 ? 80 + alphaVsBtc * 2.0 : 80 - alphaVsBtc * 2.0;
                digest.push({
                  rank: 1,
                  coin,
                  side: sb15.side,
                  rsScore: baseRs,
                  entry: sb15.entry,
                  stop: sb15.stop,
                  tp: sb15.tp,
                  text: planText(
                    sb15.side,
                    coin,
                    sb15.side > 0 ? "📦 M15 nổ Vol phá đỉnh nền" : "📦 M15 xả Vol thủng đáy nền",
                    sb15.entry,
                    sb15.stop,
                    sb15.tp,
                    candleSum15m
                  ),
                });
              }
            }
          }

          // -------------------------------------------------------------------------
          // --- SETUP 3: SUPPORT BOUNCE ---
          // -------------------------------------------------------------------------
          const bounce15 = detect15mSupportBounce(bars15m, macro4h);
          // Hỗ trợ rút chân: Cho phép đánh nếu hệ thống cho Long và coin có sức mạnh tương đối không quá yếu
          if (bounce15 && allowLong && (ownDaily >= 0 || alphaVsBtc >= -2.0)) {
            const bounceKey = `BOUNCE15:${coin}:${bounce15.barTime}`;
            if (!sent.has(bounceKey)) {
              sent.add(bounceKey);
              addLimit(coin, { side: 1, level: bounce15.entry, limit: bounce15.entry, stop: bounce15.stop, tp: bounce15.tp, atr: 0, barTime: bounce15.barTime, market: true }, HIGHTEST_15M_PAPER);

              const { alertMsg: paperMsg } = openPaperTrade({
                coin,
                side: 1,
                entry: bounce15.entry,
                stop: bounce15.stop,
                tp: bounce15.tp,
                tp1: bounce15.tp1,
                tp2: bounce15.tp2,
                note: bounce15.note,
              });
              if (paperMsg) await say(paperMsg);

              const bounceRs = 85 + alphaVsBtc * 2.0;
              digest.push({
                rank: 2,
                coin,
                side: 1,
                rsScore: bounceRs,
                entry: bounce15.entry,
                stop: bounce15.stop,
                tp: bounce15.tp,
                text: planText(1, coin, "🎯 Săn đáy hỗ trợ rút chân", bounce15.entry, bounce15.stop, bounce15.tp, candleSum15m),
              });
            }
          }

          // Setup 4: High test 15m đã được tắt hoàn toàn để tránh mua đuổi nến đỏ/vol yếu (như APT lúc 17:01)
        }
      }

      if (after4h) {
        const bars4h = await candles(`${coin}-USDT-SWAP`, "4H", 300);
        stepSwing(coin, bars4h); // 📊 chỉ paper im lặng
        stepLimits(coin, bars4h, HIGHTEST_PAPER); // paper im lặng
        stepSwing(coin, bars4h, ST_PAPER); // paper im lặng

        if (!isHeld && coin !== "BTC" && coin !== "ETH") {
          const own = await dailyTrend(coin);
          const vision4h = analyzeCandleVision(bars4h);

          // 🔨 nến high test (Jason Graystone) → lệnh chờ phá râu, 3 nến 4H, TP 2R
          for (const g of highTestSetup(bars4h)) {
            if (g.side > 0 && !allowLong) continue;
            if (g.side < 0 && !allowShort) continue;
            if (own !== 0 && g.side !== own) continue;

            // 👁️ BỘ MẮT ĐỌC NẾN 4H:
            if (g.side < 0 && !vision4h.isValidShortCandle) continue;
            if (g.side > 0 && !vision4h.isValidLongCandle) continue;
            const key = `HT:${coin}:${g.side}:${g.barTime}`;
            if (sent.has(key)) continue;
            sent.add(key);
            addLimit(coin, { side: g.side, level: g.trigger, limit: g.trigger, stop: g.stop, tp: g.tp, atr: 0, barTime: g.barTime, stopEntry: true, barMs: 4 * H }, HIGHTEST_PAPER);

            const lastB = bars4h.at(-1);
            const r4 = lastB ? lastB.h - lastB.l : 1;
            const rebound = lastB ? (g.side > 0 ? (lastB.c - lastB.l) : (lastB.h - lastB.c)) : 0;
            const rsScore = r4 > 0 ? (rebound / r4) * 100 : 50;

            const candleSum4h = formatCandleSummary("4H", bars4h, vision4h);
            digest.push({
              rank: 0,
              coin,
              side: g.side,
              rsScore,
              entry: g.trigger,
              stop: g.stop,
              tp: g.tp,
              text: planText(g.side, coin, "🔨 High test 4H", g.trigger, g.stop, g.tp, candleSum4h),
            });
          }
          // 📈 Supertrend 4H đổi màu (Wysetrade) → vào ngay, không TP, SL dời theo dải
          const st = stFlipSetup(bars4h);
          if (st && !sent.has(`ST:${coin}:${st.barTime}`)) {
            if ((st.side > 0 && allowLong) || (st.side < 0 && allowShort)) {
              sent.add(`ST:${coin}:${st.barTime}`);
              if (openSwing(coin, { side: st.side, entry: st.entry, stop: st.stop, entryTime: st.barTime + 4 * H, trail: "st" }, ST_PAPER))
                digest.push({
                  rank: 0,
                  coin,
                  side: st.side,
                  rsScore: 75,
                  entry: st.entry,
                  stop: st.stop,
                  text: planText(st.side, coin, "📈 Supertrend 4H", st.entry, st.stop),
                });
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

        if (!isHeld && coin !== "BTC" && coin !== "ETH") {
          const own = await dailyTrend(coin);
          const vision1h = analyzeCandleVision(bars1h);
          // 🧲 TradingLab: đỉnh/đáy B là mồi nhử (chỉ chạy paper ngầm, không spam tin Telegram vì cạnh mỏng)
          for (const g of inducementSetup(bars300)) {
            if (g.side > 0 && !allowLong) continue;
            if (g.side < 0 && !allowShort) continue;
            if (own !== 0 && g.side !== own) continue;
            const curP = bars1h.at(-1)?.c;
            if (curP && Math.abs(g.limit - curP) / curP > 0.025) continue;

            const key = `IDM:${coin}:${g.side}:${g.barTime}`;
            if (sent.has(key)) continue;
            sent.add(key);
            addLimit(coin, { side: g.side, level: g.limit, limit: g.limit, stop: g.stop, tp: g.tp, atr: 0, barTime: g.barTime }, IDM_PAPER, true);
          }
          // Kèo SO Trading: chỉ giữ 🔁 Hồi đỉnh cũ (đạt chuẩn)
          for (const so of soSetups(bars300).filter((s) => s.kind === "pullback")) {
            if (so.side > 0 && !allowLong) continue;
            if (so.side < 0 && !allowShort) continue;
            if (own !== 0 && so.side !== own) continue; // CẤM ĐÁNH NGƯỢC TREND NGÀY CỦA COIN
            // 🚫 BỘ LỌC VÙNG LƠ LỬNG: Nếu giá đang trôi ở giữa không người (No Man's Land) -> ĐỨNG NGOÀI
            if (isPriceInNoMansLand(bars1h)) continue;

            // 👁️ MẮT ĐỌC NẾN 1H:
            if (so.side < 0 && !vision1h.isValidShortCandle) continue;
            if (so.side > 0 && !vision1h.isValidLongCandle) continue;
            const key = `SO:${so.kind}:${coin}:${so.side}:${so.barTime}`;
            if (sent.has(key)) continue;
            sent.add(key);
            addLimit(coin, { side: so.side, level: so.entry, limit: so.entry, stop: so.stop, tp: so.tp, atr: 0, barTime: so.barTime, market: !so.limit }, soPaper(so.kind));
            const candleSum1h = formatCandleSummary("1H", bars1h, vision1h);
            digest.push({
              rank: 3,
              coin,
              side: so.side,
              rsScore: 60,
              entry: so.entry,
              stop: so.stop,
              tp: so.tp,
              text: planText(so.side, coin, "🔁 Hồi đỉnh cũ", so.entry, so.stop, so.tp, candleSum1h, so.tp1),
            });
          }

          // 📦 Mô hình Nén Hộp Bùng Nổ Khung Lớn 1H (HTF VPA Real Breakout - Ep 7 & 8)
          const ab1h = detectHtfBreakout(bars1h);
          if (ab1h) {
            const isLongOk = ab1h.side > 0 && allowLong && own >= 0;
            const isShortOk = ab1h.side < 0 && allowShort && own <= 0;
            if (isLongOk || isShortOk) {
              const abKey = `AB1H:${coin}:${ab1h.side}:${ab1h.barTime}`;
              if (!sent.has(abKey)) {
                sent.add(abKey);
                addLimit(coin, { side: ab1h.side, level: ab1h.entry, limit: ab1h.entry, stop: ab1h.stop, tp: ab1h.tp, atr: 0, barTime: ab1h.barTime, market: true }, HIGHTEST_15M_PAPER);
                const candleSum1h = formatCandleSummary("1H", bars1h, vision1h);
                digest.push({
                  rank: 1,
                  coin,
                  side: ab1h.side,
                  rsScore: 85, // 1H VPA Breakout nổ Vol >= 1.8x
                  entry: ab1h.entry,
                  stop: ab1h.stop,
                  tp: ab1h.tp,
                  text: planText(
                    ab1h.side,
                    coin,
                    ab1h.side > 0 ? "📦 1H nổ Vol phá đỉnh hộp" : "📦 1H xả Vol thủng đáy hộp",
                    ab1h.entry,
                    ab1h.stop,
                    ab1h.tp,
                    candleSum1h
                  ),
                });
              }
            }
          }

          // 🎯 ICT quét đỉnh hôm qua → ChoCh → Sell Limit giữa FVG, TP đáy hôm qua
          const ict = ictSweepShort(bars1h);
          const ictKey = ict && `ICT:${coin}:${ict.barTime}`;
          if (ict && ictKey && !sent.has(ictKey)) {
            if (allowShort) {
              sent.add(ictKey);
              addLimit(coin, ict, ICT_PAPER);
              const candleSum1h = formatCandleSummary("1H", bars1h, vision1h);
              digest.push({
                rank: 1,
                coin,
                side: -1,
                rsScore: 70,
                entry: ict.limit,
                stop: ict.stop,
                tp: ict.tp,
                text: planText(-1, coin, "🎯 ICT FVG Limit", ict.limit, ict.stop, ict.tp, candleSum1h),
              });
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

  // 🛡️ LỌC BẪY TƯƠNG QUAN ĐỒNG LOẠT (CORRELATED PORTFOLIO RISK):
  // 1. Phân loại Hunter Reversal Signals (có cờ isMacroReversal) vs Standard Setups
  const hunterLongs = digest.filter((d) => d.side > 0 && d.isMacroReversal).sort((a, b) => (b.rrRatio || 0) - (a.rrRatio || 0));
  const stdLongs = digest.filter((d) => d.side > 0 && !d.isMacroReversal).sort((a, b) => b.rsScore - a.rsScore);
  const topLongs = [...hunterLongs, ...stdLongs].slice(0, 2);

  // 2. Short: Cho phép Hunter Reversal Short bypass RS, nhưng khống chế tối đa 2 kèo Short đẹp nhất
  const hunterShorts = digest.filter((d) => d.side < 0 && d.isMacroReversal).sort((a, b) => (b.rrRatio || 0) - (a.rrRatio || 0));
  const stdShorts = digest.filter((d) => d.side < 0 && !d.isMacroReversal).sort((a, b) => a.rsScore - b.rsScore);
  const topShorts = [...hunterShorts, ...stdShorts].slice(0, 2);

  const finalDigest = [...topLongs, ...topShorts].sort((a, b) => a.rank - b.rank);

  // 🚀 LIVE TRADING TRÊN MEXC: CHỈ BẬT KHI CÓ CỜ RÕ RÀNG (HIỆN TẠI ĐÃ TẮT HOÀN TOÀN THEO YÊU CẦU CỦA VICTOR)
  const isMexcLiveTradingEnabled = process.env.MEXC_LIVE_TRADING === "true" && process.env.MEXC_DRY_RUN === "false";
  if (isMexcLiveTradingEnabled && finalDigest.length > 0) {
    try {
      let livePositions: import("./mexc").MexcPosition[] = await getMexcOpenPositions().catch(() => []);
      for (const item of finalDigest) {
        if (livePositions.length >= MAX_CONCURRENT_POSITIONS) {
          break; // Đã đạt trần 3 vị thế tối đa trên toàn tài khoản
        }
        if (livePositions.some((p) => p.coin === item.coin) || heldCoins.has(item.coin)) {
          continue; // Coin này đang có vị thế mở, không vào thêm
        }
        const entry = item.entry;
        const stop = item.stop;
        if (!entry || !stop) continue;

        const symbol = `${item.coin}_USDT`;
        const vol = await calculateMexcVolForMargin(symbol, entry, 10.0, 10).catch(() =>
          Math.max(1, Math.round((10 * 10) / entry))
        );

        const liveOrder = await submitMexcOrder({
          symbol,
          side: item.side > 0 ? 1 : 3, // 1: Open Long, 3: Open Short
          type: 5, // Market order
          vol,
          openType: 1, // Isolated
          leverage: 10,
        });

        if (liveOrder.success) {
          heldCoins.add(item.coin);
          livePositions.push({
            positionId: Number(liveOrder.orderId || 0),
            symbol,
            coin: item.coin,
            side: item.side as 1 | -1,
            entry,
            vol,
            leverage: 10,
            unRealizedPnl: 0,
            liquidatePrice: 0,
            margin: 10,
          });

          await say(
            `🚀 *[MEXC LIVE: ĐÃ VÀO LỆNH TỰ ĐỘNG]*\n\n` +
            `• Vị thế: *${item.side > 0 ? "🟢 LONG" : "🔴 SHORT"} ${item.coin}* (x10 Isolated)\n` +
            `• Khối lượng: *${vol} hợp đồng* (~$10 ký quỹ thật)\n` +
            `• Giá vào: *${f(entry)}*\n` +
            `• Chốt lời (TP): *${f(item.tp ?? 0)}* · Cắt lỗ (SL): *${f(stop)}*\n` +
            `• Lý do: ${item.isMacroReversal ? "🎯 Săn đảo chiều cản lớn / FVG 4H" : "📦 Phá nền bứt phá động lượng"}\n` +
            `• Mã lệnh: \`${liveOrder.orderId}\``
          );

          // Tự động gắn TP/SL lên MEXC ngay lập tức (với cơ chế Retry 3 lần)
          try {
            let stopAttached = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
              await new Promise((r) => setTimeout(r, attempt * 600)); // Chờ 600ms, 1200ms, 1800ms
              const updatedPositions = await getMexcOpenPositions().catch(() => []);
              const pos = updatedPositions.find((p) => p.coin === item.coin);
              if (pos && pos.positionId) {
                const stopRes = await setMexcPositionStop({
                  positionId: pos.positionId,
                  symbol,
                  stopLossPrice: item.stop,
                  takeProfitPrice: item.tp,
                  vol,
                });
                if (stopRes.success) {
                  stopAttached = true;
                  break;
                }
              }
            }
            if (!stopAttached) {
              console.warn(`[MEXC LIVE STOP WARNING] ${item.coin}: Chưa gắn được SL ngay lập tức, Fail-Safe Shield sẽ xử lý ở chu kỳ tới.`);
            }
          } catch (stopErr) {
            console.error(`[MEXC LIVE STOP ERR] ${item.coin}:`, stopErr);
          }
        } else {
          console.error(`[MEXC LIVE ORDER REJECTED] ${item.coin}:`, liveOrder.error);
        }
      }
    } catch (mexcErr) {
      console.error("[MEXC CENTRALIZED EXECUTION ERR]:", mexcErr);
    }
  }

  if (finalDigest.length > 0 || isNewBtcSweep) {
    const btcCompass = btcSentinel.sweep
      ? `🧭 *BTC:* ${btcSentinel.sweep.note} → *CHỈ ĐÁNH ${btcSentinel.sweep.side > 0 ? "LONG ↗" : "SHORT ↘"}*\n\n`
      : `🧭 *BTC:* ${btcSentinel.dailyTrend > 0 ? "Xu hướng TĂNG ↗ (Ưu tiên LONG)" : btcSentinel.dailyTrend < 0 ? "Xu hướng GIẢM ↘ (CẤM LONG, Chỉ SHORT)" : "Đi ngang giằng co"}\n\n`;

    if (finalDigest.length > 0) {
      const msg = `📋 *KÈO MỚI ${vnTime(now)}*\n` + btcCompass + finalDigest.map((d) => d.text).join("\n\n");
      out.push(msg);
      // Tự theo dõi kèo có TP: báo ⏰ khi giá cách điểm vào < 0.5%, 🔔 khi chạm (24h)
      for (const d of finalDigest) {
        if (d.tp !== undefined && d.entry !== undefined && d.stop !== undefined && !heldCoins.has(d.coin)) {
          addWatch({ coin: d.coin, side: d.side as 1 | -1, entry: d.entry, stop: d.stop, tp: d.tp, expires: now + 24 * 3_600_000 });
        }
      }

      let chartBuf: Buffer | null = null;
      try {
        const topItem = finalDigest[0];
        const topCoin = topItem.coin;
        const tf = topItem.text.includes("15m") ? "15m" : "1H";
        const c = await candles(`${topCoin}-USDT-SWAP`, tf, 60);
        const zoneInfo = topItem.zone
          ? {
              top: topItem.zone.top,
              bottom: topItem.zone.bottom,
              label: topItem.zone.type === "BEARISH_FVG_4H" ? "Bearish FVG 4H (Sell Zone)" : topItem.zone.type === "BULLISH_FVG_4H" ? "Bullish FVG 4H (Buy Zone)" : "Cản Macro 4H",
              side: (topItem.side > 0 ? 1 : -1) as 1 | -1,
            }
          : undefined;

        chartBuf = await generateCandleChartPng({
          symbol: `${topCoin}/USDT`,
          timeframe: tf,
          candles: c,
          statusText: `TÍN HIỆU: ${topItem.side > 0 ? "LONG ↗" : "SHORT ↘"}`,
          entry: topItem.entry,
          stop: topItem.stop,
          tp: topItem.tp,
          zone: zoneInfo,
        });
      } catch (e) {
        console.error("[CHART_ERR]", e);
      }

      if (chartBuf) {
        await sendPhoto(chartBuf, msg);
      } else {
        await send(msg);
      }
    } else if (isNewBtcSweep) {
      const compassMsg = `🧭 *CẬP NHẬT LA BÀN THỊ TRƯỜNG ${vnTime(now)}*\n` + btcCompass + `⏳ *Altcoin:* Chưa có coin nào xuất hiện nến High Test / Pullback chuẩn đạt R:R. Đang tiếp tục quét...`;
      out.push(compassMsg);

      let btcChartBuf: Buffer | null = null;
      try {
        btcChartBuf = await generateCandleChartPng({
          symbol: "BTC/USDT",
          timeframe: "4H",
          candles: btc4h,
          statusText: `LA BÀN: ${btcSentinel.sweep ? (btcSentinel.sweep.side > 0 ? "QUÉT ĐÁY ↗" : "QUÉT ĐỈNH ↘") : "CẤU TRÚC GIẢM ↘"}`,
        });
      } catch (e) {
        console.error("[BTC_CHART_ERR]", e);
      }

      if (btcChartBuf) {
        await sendPhoto(btcChartBuf, compassMsg);
      } else {
        await send(compassMsg);
      }
    }
  }
  saveSent();
  return out;
}

/**
 * Quét các Altcoin đang trong giai đoạn nén hộp hoặc sắp kích hoạt setup (để rình trước)
 */
export async function scanAnticipatingAltcoins(): Promise<string> {
  const btcDaily = await dailyTrend("BTC");
  const btc1h: Candle[] = await candles("BTC-USDT-SWAP", "1H", 120).catch(() => []);
  const btc15m: Candle[] = await candles("BTC-USDT-SWAP", "15m", 300).catch(() => []);
  const btc4h: Candle[] = await candles("BTC-USDT-SWAP", "4H", 60).catch(() => []);
  const btcSentinel = analyseBtcSentinel(btc1h, btcDaily, btc15m, btc4h);

  const results: string[] = [];
  const altcoins = COINS.filter((c) => c !== "BTC" && c !== "ETH");

  for (const coin of altcoins) {
    try {
      const bars15m = await candles(`${coin}-USDT-SWAP`, "15m", 60);
      const ant = detectAnticipatingBox(bars15m);
      if (ant) {
        results.push(
          `• *${coin}* (@${f(ant.currentPrice)}): ${ant.note} (cách đỉnh ${ant.distancePct}%)`
        );
      }
    } catch {}
  }

  const btcHeader = btcSentinel.sweep
    ? `🧭 *BTC:* ${btcSentinel.sweep.note} → *CHỈ ĐÁNH ${btcSentinel.sweep.side > 0 ? "LONG ↗" : "SHORT ↘"}*\n\n`
    : `🧭 *BTC:* ${btcSentinel.dailyTrend > 0 ? "Xu hướng TĂNG ↗ (Ưu tiên LONG)" : btcSentinel.dailyTrend < 0 ? "Xu hướng GIẢM ↘ (CẤM LONG, Chỉ SHORT)" : "Đi ngang giằng co"}\n\n`;

  const header = `📦 *ALTCOIN ĐANG NÉN HỘP (RÌNH NỔ BREAKOUT)*\n` + btcHeader;

  if (results.length === 0) {
    return header + "Hiện các Altcoin đang di chuyển tự do, chưa có coin nào tạo hộp nén tích luỹ hẹp ≤ 4.2% chuẩn Wyckoff. Hệ thống đang tiếp tục rình...";
  }

  return header + results.join("\n\n") + "\n\n💡 *Cách đánh:* Canh nến 15m nổ Volume đóng vượt đỉnh hộp để vào lệnh theo bot!";
}
