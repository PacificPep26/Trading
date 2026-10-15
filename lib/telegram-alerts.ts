// Telegram signal alerts according to disciplined backtested rules:
// 4H only: BOS LONG; double top/bottom only with matching BTC + coin daily trends.
//    Includes 5-minute heads-up preview before each 4h close when coin is near level (<= 1.2%).
// Uses unified trading policy from @/lib/trading-policy.

import fs from "fs";
import path from "path";
import { analyse, swings, analyseDaily, restingLimit, fvgSweepSignal, ictSweepShort } from "@/lib/patterns";
import { candles, ticker, funding, type Candle } from "@/lib/okx";
import { evaluateSetup } from "@/lib/decision-engine";
import { openPaperPlan, paperSummary, reconcilePaperPositions } from "@/lib/paper-ledger";
import { isStarSetup, isLiveEligible, trailingStop } from "@/lib/trading-policy";
import { getCapitalTier, checkTierChange } from "@/lib/capital-tier";
import { getMexcAccountAsset, getMexcOpenPositions, getMexcOpenStopOrders, submitMexcOrder, submitMexcTpSl, closeMexcPosition, moveStopsToBreakeven, tightenStop, getRealizedPnl } from "@/lib/mexc-client";
import { loadJournal, recordOpen, recordClose, recordTrail, openTrade } from "@/lib/trade-journal";
import { loadWatches, saveWatches, evaluateWatches } from "@/lib/price-watch";
import { managePaper1h, openPaper1h } from "@/lib/paper-1h";
import { addLimit, stepLimits, loadLimits } from "@/lib/resting-limit";
import { pickCoin } from "@/lib/overview";
import { US_EVENTS, newsMessages } from "@/lib/us-events";

const COINS = [
  "BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK",
  "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"
];

const CAPITAL = Number(process.env.ALERT_CAPITAL ?? 40);

// data/ là Railway volume (/app/data) → chống trùng & đỉnh vốn sống sót qua redeploy
const DEDUP_FILE = path.join(process.cwd(), "data", "telegram-sent.json");
const OVERVIEW_PAPER = path.join(process.cwd(), "data", "paper-overview.json");
const FVG_PAPER = path.join(process.cwd(), "data", "paper-fvg.json");
// kèo Toàn cảnh dạng Limit chờ hồi: chỉ tính khi giá thật sự quay về khớp
const OVERVIEW_LIMIT_PAPER = path.join(process.cwd(), "data", "paper-overview-limit.json");
const ICT_PAPER = path.join(process.cwd(), "data", "paper-ict.json");

// Vị thế 4H hai đỉnh/đáy đang trailing SL (không TP), theo symbol MEXC → phải bền qua redeploy
type TrailEntry = { side: 1 | -1; entryTime: number };

function loadDedup(): { sent: string[]; preSent: string[]; peakEquity?: number; trail?: Record<string, TrailEntry> } {
  try {
    if (fs.existsSync(DEDUP_FILE)) {
      const data = JSON.parse(fs.readFileSync(DEDUP_FILE, "utf-8"));
      const peak = Number(data.peakEquity);
      return { sent: data.sent ?? [], preSent: data.preSent ?? [], peakEquity: Number.isFinite(peak) && peak > 0 ? peak : undefined, trail: data.trail ?? {} };
    }
  } catch {}
  return { sent: [], preSent: [] };
}

function saveDedup(sentSet: Set<string>, preSentSet: Set<string>) {
  try {
    const data = {
      sent: Array.from(sentSet).slice(-300),
      preSent: Array.from(preSentSet).slice(-300),
      peakEquity: globalThis.mexcPeakEquity,
      trail: trailing,
    };
    fs.mkdirSync(path.dirname(DEDUP_FILE), { recursive: true });
    fs.writeFileSync(DEDUP_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("[DEDUP] Không ghi được file chống trùng:", e);
  }
}

const initialDedup = loadDedup();
const trailing: Record<string, TrailEntry> = initialDedup.trail ?? {};

declare global {
  var telegramSent: Set<string> | undefined;
  var telegramPreSent: Set<string> | undefined;
  var lastReportedTierEquity: number | undefined;
  var mexcPeakEquity: number | undefined;
  var lastKnownLivePositions: Map<string, { symbol: string; side: "LONG" | "SHORT"; openAvgPrice: number; holdVol: number }> | undefined;
}
const sent = (globalThis.telegramSent ??= new Set<string>(initialDedup.sent));
const preSent = (globalThis.telegramPreSent ??= new Set<string>(initialDedup.preSent));

// Tin tay (🧭 ⏳ 👀 📌 🎯): mỗi coin + chiều tối đa 1 tin / 6 giờ, tính chung mọi loại (13-14/10: DOT báo 5 lần, nhiều loại cùng ý)
const alertHour = () => Math.floor(Date.now() / 3_600_000);
const recentlyAlerted = (coin: string, side: number) => [0, 1, 2, 3, 4, 5].some((h) => sent.has(`ANY:${coin}:${side}:${alertHour() - h}`));
const markAlerted = (coin: string, side: number) => sent.add(`ANY:${coin}:${side}:${alertHour()}`);
const lastPositions = (globalThis.lastKnownLivePositions ??= new Map<string, { symbol: string; side: "LONG" | "SHORT"; openAvgPrice: number; holdVol: number }>());

const dailyDataCache: Record<string, { trend: 1 | -1 | 0; cs: Candle[]; ts: number }> = {};

async function getDailyData(coin: string): Promise<{ trend: 1 | -1 | 0; cs: Candle[] }> {
  const cached = dailyDataCache[coin];
  if (cached && Date.now() - cached.ts < 30 * 60_000) return cached;
  try {
    const cs = (await candles(`${coin}-USDT-SWAP`, "1Dutc", 300)).filter((c) => c.closed);
    if (cs.length < 60) return { trend: 0, cs };
    let ema = cs[0].c;
    for (const c of cs) ema += (2 / 51) * (c.c - ema);
    const trend: 1 | -1 | 0 = cs.at(-1)!.c > ema ? 1 : -1;
    const entry = { trend, cs, ts: Date.now() };
    dailyDataCache[coin] = entry;
    return entry;
  } catch {
    if (cached) return cached;
    return { trend: 0, cs: [] };
  }
}

async function dailyTrend(coin: string): Promise<1 | -1 | 0> {
  const data = await getDailyData(coin);
  return data.trend;
}

// coin giá rất nhỏ (PEPE) cần chữ số có nghĩa, không phải số lẻ cố định
const f = (v: number) => v.toLocaleString("vi-VN", v > 0 && v < 0.01 ? { maximumSignificantDigits: 5 } : { maximumFractionDigits: v > 1000 ? 1 : v > 1 ? 3 : 7 });

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
// Không xác nhận được SL → đóng ngay, không giữ vị thế trần trụi. Trả về true nếu vị thế được giữ.
async function keepOnlyIfProtected(
  coin: string,
  side: 1 | -1,
  vol: number,
  protection: Awaited<ReturnType<typeof submitMexcTpSl>>,
): Promise<boolean> {
  if (!protection.isDryRun && !protection.slConfirmed) {
    try {
      await closeMexcPosition({ symbol: coin, side, vol });
      await send(`🛑 [MEXC] ${coin}: không xác nhận được SL (${protection.error ?? "unknown"}) → đã đóng vị thế ngay.`);
    } catch (e) {
      await send(`🚨 [MEXC] ${coin}: KHÔNG có SL và ĐÓNG THẤT BẠI (${e instanceof Error ? e.message : e}). Vào app đóng tay NGAY!`);
    }
    return false;
  }
  if (!protection.success) {
    await send(`⚠️ [MEXC] ${coin} đã mở và có SL, nhưng đặt TP thất bại: ${protection.error ?? "unknown error"}`);
  }
  return true;
}

export async function scanAndAlert(): Promise<string[]> {
  try {
    const moved = await moveStopsToBreakeven();
    for (const sym of moved) await send(`🔒 [MEXC] ${sym}: TP1 đã khớp → dời SL về giá vào (hòa vốn).`);
  } catch (e) {
    await send(`⚠️ [MEXC] Không dời được SL về hòa vốn: ${e instanceof Error ? e.message : e}`);
  }

  // Tin Mỹ: nhắc trước 1 giờ + báo nến 5m đầu của BTC sau tin. Chỉ là thông tin (vào theo nến đầu backtest lỗ)
  try {
    const now = Date.now();
    const btc5m = US_EVENTS.some((e) => now >= e.t + 5 * 60_000 && now < e.t + 30 * 60_000) ? await candles("BTC-USDT-SWAP", "5m", 12) : [];
    for (const m of newsMessages(US_EVENTS, now, sent, btc5m)) await send(m);
    saveDedup(sent, preSent);
  } catch (e) {
    console.error("[NEWS]", e);
  }

  const [btc, btc1h] = await Promise.all([
    dailyTrend("BTC"),
    candles("BTC-USDT-SWAP", "1H", 10).catch(() => []),
  ]);
  const mexcAsset = await getMexcAccountAsset(CAPITAL);
  const currentEquity = mexcAsset.equity;
  const prevPeak = globalThis.mexcPeakEquity ?? initialDedup.peakEquity ?? currentEquity;
  globalThis.mexcPeakEquity = Math.max(prevPeak, currentEquity);
  if (globalThis.mexcPeakEquity !== initialDedup.peakEquity) {
    initialDedup.peakEquity = globalThis.mexcPeakEquity;
    saveDedup(sent, preSent);
  }
  const currentTier = getCapitalTier(currentEquity);
  let remainingMargin = mexcAsset.availableBalance;

  if (globalThis.lastReportedTierEquity !== undefined && globalThis.lastReportedTierEquity !== currentEquity) {
    const tierCheck = checkTierChange(globalThis.lastReportedTierEquity, currentEquity);
    if (tierCheck.changed) {
      if (tierCheck.direction === "up") {
        await send(
          `🚀 *[THĂNG HẠNG VỐN THÀNH CÔNG]*\n\n` +
          `• *Số dư tài khoản:* \`${currentEquity.toFixed(2)}$\` ➔ *LÊN ${tierCheck.newTier.name}*\n` +
          `• *Rủi ro mỗi lệnh mới:* \`${tierCheck.newTier.riskPerTradeUsd}$\` / lệnh\n` +
          `• *Số lệnh tối đa đồng thời:* \`${tierCheck.newTier.maxOpenTrades}\` lệnh\n` +
          `• *Mốc khóa bảo vệ lợi nhuận (Ratchet):* \`${tierCheck.newTier.ratchetFloorUsd}$\``
        );
      } else if (tierCheck.direction === "down") {
        await send(
          `🛡️ *[KÍCH HOẠT PHÒNG VỆ VỐN]*\n\n` +
          `• *Số dư tài khoản:* \`${currentEquity.toFixed(2)}$\` ➔ *HẠ VỀ ${tierCheck.newTier.name}*\n` +
          `• Tự động hạ rủi ro về \`${tierCheck.newTier.riskPerTradeUsd}$\` / lệnh để bảo toàn vốn đã tích lũy.`
        );
      }
    }
  }
  globalThis.lastReportedTierEquity = currentEquity;

  // Kiểm tra hạn API MEXC (90 ngày từ lúc tạo: 10/10/2026 -> hết hạn 08/01/2027)
  // Chỉ cảnh báo khi còn đúng <= 1 ngày
  const apiCreatedAt = new Date("2026-10-10T12:00:00+07:00").getTime();
  const apiExpiresAt = apiCreatedAt + 90 * 24 * 3600 * 1000;
  const daysLeft = (apiExpiresAt - Date.now()) / (24 * 3600 * 1000);
  if (daysLeft <= 1.0 && daysLeft > 0) {
    const keyExpire = `API_EXPIRE_ALERT_${new Date().toISOString().slice(0, 10)}`;
    if (!sent.has(keyExpire)) {
      await send(
        `⚠️ *[CẢNH BÁO: KEY API MEXC SẮP HẾT HẠN]*\n\n` +
        `• Key API của bác chỉ còn *${Math.max(0, Math.ceil(daysLeft * 24))} giờ* nữa là hết hạn 90 ngày!\n` +
        `• Bác vào MEXC: *Quản lý API ➔ Thao tác ➔ Bấm Gia hạn* để cộng thêm 90 ngày nhé!`
      );
      sent.add(keyExpire);
      saveDedup(sent, preSent);
    }
  }

  const itemsToSend: { key: string; msg: string }[] = [];
  const out: string[] = [];

  // Lấy danh sách vị thế đang mở thực tế trên MEXC và các lệnh Stop/TP đi kèm
  const [livePositions, openStopOrders] = await Promise.all([
    getMexcOpenPositions(),
    getMexcOpenStopOrders(),
  ]);
  const liveOpenSymbols = new Set(livePositions.filter((position) => position.holdVol > 0).map((position) => position.symbol.replace("_USDT", "")));

  // Phát hiện và thông báo vị thế vừa đóng (khớp TP hoặc SL)
  for (const [sym, oldPos] of Array.from(lastPositions.entries())) {
    const isStillOpen = livePositions.some((p) => p.symbol === sym && p.holdVol > 0);
    if (!isStillOpen) {
      lastPositions.delete(sym);
      if (openTrade(sym)) continue; // lệnh có trong nhật ký → báo bằng PnL thật bên dưới
      try {
        const coinName = sym.replace("_USDT", "");
        const t = await ticker(`${coinName}-USDT-SWAP`).catch(() => null);
        const exitPrice = t?.last ?? oldPos.openAvgPrice;
        const sideMult = oldPos.side === "LONG" ? 1 : -1;
        const pnlPct = ((exitPrice - oldPos.openAvgPrice) / oldPos.openAvgPrice) * sideMult * 100;
        const isWin = pnlPct > 0;
        const outcomeTag = isWin ? `🎯 *[MEXC: ĐÃ CHỐT LỜI (TP)]*` : `🛑 *[MEXC: ĐÃ CHẠM CẮT LỖ (SL)]*`;
        const icon = isWin ? "🟢" : "🔴";

        await send(
          `${outcomeTag} ${icon} *${coinName}* (${oldPos.side})\n` +
          `• *Vị thế đã đóng:* ${oldPos.holdVol} HĐ\n` +
          `• *Giá vào lệnh:* ~${f(oldPos.openAvgPrice)}\n` +
          `• *Giá hiện tại/thoát:* ~${f(exitPrice)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)\n` +
          `• *Số dư ví hiện tại:* \`${currentEquity.toFixed(2)}$\` USDT`
        );
      } catch (err) {
        console.error(`[MEXC CLOSE ALERT] Lỗi báo đóng vị thế ${sym}:`, err);
      }
    }
  }

  // Nhật ký lệnh thật: vị thế đã đóng → lấy lãi/lỗ ròng sau phí từ lịch sử lệnh MEXC
  for (const jt of loadJournal().filter((t) => t.exitTime === undefined)) {
    if (livePositions.some((p) => p.symbol === jt.symbol && p.holdVol > 0)) continue;
    try {
      const real = await getRealizedPnl(jt.symbol, jt.entryTime);
      if (!real) continue; // lịch sử chưa cập nhật → thử lại lượt sau
      const done = recordClose(jt.symbol, { exitTime: Date.now(), exitPrice: real.exitPrice, pnlUsd: real.pnlUsd });
      const r = done && done.riskUsd > 0 ? real.pnlUsd / done.riskUsd : 0;
      await send(
        `${real.pnlUsd >= 0 ? "🎯" : "🛑"} *[MEXC ĐÃ ĐÓNG]* *${jt.symbol.replace("_USDT", "")}* ${jt.side > 0 ? "LONG" : "SHORT"}\n` +
        `• Vào ${f(jt.entry)} ➔ Thoát ${f(real.exitPrice)}${jt.trailMoves ? ` (dời SL ${jt.trailMoves} lần)` : ""}\n` +
        `• *Ròng sau phí:* ${real.pnlUsd >= 0 ? "+" : ""}${real.pnlUsd.toFixed(2)}$ (${r >= 0 ? "+" : ""}${r.toFixed(2)}R)\n` +
        `• *Số dư:* \`${currentEquity.toFixed(2)}$\`\n_Gõ "thống kê" để so với backtest._`
      );
    } catch (e) {
      console.error(`[JOURNAL] Không lấy được PnL ${jt.symbol}:`, e);
    }
  }

  // Cập nhật danh sách vị thế đang mở hiện tại
  for (const pos of livePositions) {
    if (pos.holdVol > 0) {
      lastPositions.set(pos.symbol, {
        symbol: pos.symbol,
        side: pos.positionType === 1 ? "LONG" : "SHORT",
        openAvgPrice: pos.openAvgPrice ?? 0,
        holdVol: pos.holdVol,
      });
    }
  }

  // Trailing SL 3×ATR cho lệnh 4H hai đỉnh/đáy (backtest trailing_study 2026-10-12)
  const openSyms = new Set(livePositions.filter((p) => p.holdVol > 0).map((p) => p.symbol));
  for (const sym of Object.keys(trailing)) {
    if (!openSyms.has(sym)) { delete trailing[sym]; saveDedup(sent, preSent); }
  }
  for (const pos of livePositions) {
    const tr = trailing[pos.symbol];
    if (!tr || pos.holdVol <= 0) continue;
    try {
      const bars = await candles(`${pos.symbol.replace("_USDT", "")}-USDT-SWAP`, "4H", 120);
      const target = trailingStop(bars, tr.side, tr.entryTime, tr.side > 0 ? 0 : Infinity);
      if (!Number.isFinite(target) || target <= 0) continue;
      const price = bars.at(-1)?.c ?? 0;
      // Giá đã vượt SL mới (sàn sẽ từ chối SL này) → thoát như backtest
      if (price > 0 && (tr.side > 0 ? price <= target : price >= target)) {
        await closeMexcPosition({ symbol: pos.symbol, side: tr.side, vol: pos.holdVol });
        await send(`🚪 [MEXC] ${pos.symbol}: giá ${f(price)} đã qua SL trailing ${f(target)} → đóng Market.`);
        continue;
      }
      const res = await tightenStop({ positionId: pos.positionId, side: tr.side, newStop: target });
      if (res.moved) {
        recordTrail(pos.symbol);
        await send(`📈 [MEXC] ${pos.symbol}: trailing 3 ATR → dời SL ${f(res.from ?? 0)} ➔ ${f(target)}`);
      }
    } catch (e) {
      await send(`⚠️ [MEXC] ${pos.symbol}: không dời được SL trailing: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Trailing Stop & Thoát lệnh chuẩn Backtest cho các vị thế đang nắm giữ (đặc biệt là 1D Donchian Trend)
  for (const pos of livePositions) {
    if (pos.holdVol <= 0) continue;
    try {
      const posCoin = pos.symbol.replace("_USDT", "");
      const dailyInfo = await getDailyData(posCoin);
      if (dailyInfo.cs.length < 25) continue;
      const aDaily = analyseDaily(dailyInfo.cs);
      const lastDailyClose = dailyInfo.cs.at(-1)?.c ?? 0;

      // Nhận diện vị thế 1D Donchian: Vị thế không có bất kỳ lệnh Take Profit nào đang chờ
      const posStopOrders = openStopOrders.filter(
        (o) => String(o.symbol ?? "") === pos.symbol && Number(o.isFinished ?? 0) === 0
      );
      const hasTpOrder = posStopOrders.some((o) => Number(o.takeProfitPrice ?? 0) > 0);
      // Chỉ lệnh bot tự mở theo Donchian (có trong nhật ký); lệnh tay không TP không được bot tự đóng
      const is1dDonchianPosition = !hasTpOrder && pos.positionType === 1 && openTrade(pos.symbol)?.style === "daily_trend_donchian";

      if (is1dDonchianPosition) {
        // THOÁT LỆNH CHUẨN BACKTEST: Nếu nến ngày đóng cửa thủng đáy 10 ngày -> Đóng Market ngay lập tức!
        // (Bất kể đang lãi hay đang lỗ, cắt ngay để bảo toàn vốn như backtest)
        if (lastDailyClose < aDaily.pastLow10d) {
          console.warn(`[MEXC 1D EXIT] ${pos.symbol} đóng nến ngày (${lastDailyClose}) dưới đáy 10D (${aDaily.pastLow10d}) -> Đóng Market thoát theo trend!`);
          await closeMexcPosition({ symbol: pos.symbol, side: 1, vol: pos.holdVol });
          await send(
            `🚪 *[MEXC THOÁT LỆNH 1D - TREND EXIT]* 🔴 Đóng *${posCoin}*\n` +
            `• *Lý do:* Nến ngày đóng cửa (${f(lastDailyClose)}) thủng đáy 10 ngày (${f(aDaily.pastLow10d)})\n` +
            `• *Thoát lệnh chuẩn Backtest* để bảo vệ vốn tối đa!`
          );
          liveOpenSymbols.delete(posCoin);
          continue;
        }
        // Không trailing SL trong ngày: backtest chỉ thoát khi NẾN NGÀY ĐÓNG thủng đáy 10D, còn lại giữ SL 2×ATR
      }
    } catch (trailErr) {
      console.error(`[MEXC TRAIL] Lỗi xử lý vị thế ${pos.symbol}:`, trailErr);
    }
  }

  // Theo dõi giá chủ tài khoản đặt qua Telegram ("theo dõi SUI 1.041 1.029 1.085 btc 82750")
  const watches = loadWatches();
  if (watches.length) {
    const price: Record<string, number> = {};
    for (const c of new Set([...watches.map((w) => w.coin), "BTC"])) {
      price[c] = (await ticker(`${c}-USDT-SWAP`).catch(() => null))?.last ?? NaN;
    }
    const { msgs, keep } = evaluateWatches(watches, price);
    for (const m of msgs) await send(m);
    if (msgs.length) saveWatches(keep);
  }

  // Gộp mọi kèo tay của lượt quét thành 1 tin (chủ dự án 14/10: báo nhiều quá rối)
  const digest: { rr: number; text: string }[] = [];
  // tối đa x10 (chủ dự án 14/10: x20 với SL sát dễ bị quét cháy); SL xa thì giảm để lỗ khi chạm SL ≤ 80% ký quỹ
  const lev = (risk: number) => Math.min(10, Math.max(1, Math.floor(0.8 / risk)));
  // Mẫu tin chung (chủ dự án 14/10: thống nhất, ngắn nhất): dòng 1 chiều + coin + cách vào, dòng 2 SL/TP/đòn bẩy
  const plan = (side: number, coin: string, how: string, entry: number, stop: number, tp: number, note = "") => {
    const r = Math.abs(entry - stop), risk = r / entry, rr = Math.abs(tp - entry) / r;
    const tp1 = entry + Math.sign(tp - entry) * r; // chốt 50% ở 1R rồi dời SL về giá vào
    digest.push({ rr, text: `${side > 0 ? "🟢 LONG" : "🔴 SHORT"} *${coin}* · ${how} ${f(entry)}${note ? ` · ${note}` : ""}\n` +
      `   SL ${f(stop)} (−${(risk * 100).toFixed(1)}%) · TP1 ${f(tp1)} · TP2 ${f(tp)} · x${lev(risk)}` });
  };

  // Toàn cảnh 5 lớp, quét mỗi 5 phút, cả LONG lẫn SHORT. Chỉ báo + paper (data/paper-overview.json).
  if (new Date().getUTCMinutes() % 5 < 2) {
    for (const coin of COINS) {
      try {
        const [h4o, h1o, m15o] = await Promise.all([
          candles(`${coin}-USDT-SWAP`, "4H", 120), candles(`${coin}-USDT-SWAP`, "1H", 100), candles(`${coin}-USDT-SWAP`, "15m", 300),
        ]);
        const h1c = h1o.filter((x) => x.closed);
        // kèo đã tắt tin (Toàn cảnh, FVG): chỉ ghi paper im lặng, không gửi tin khớp/đóng
        managePaper1h(coin, h1o, OVERVIEW_PAPER);

        // SMC: FVG H1 → hồi về vùng → 15m quét + đóng quay lại (chỉ lần đầu). Paper: data/paper-fvg.json
        // shortcut: paper quản lý SL/TP trên nến 1H (backtest dùng 15m), đủ để so chiều hướng; đổi sang 15m nếu thành ứng viên live
        stepLimits(coin, h1o, FVG_PAPER);
        stepLimits(coin, h1o, OVERVIEW_LIMIT_PAPER);
        const ownD = (await getDailyData(coin)).trend;
        const fv = fvgSweepSignal(h1o, m15o, ownD);
        const fvKey = fv && `FVG:${coin}:${fv.fvgTime}`;
        if (fv && fvKey && !sent.has(fvKey)) {
          sent.add(fvKey);
          addLimit(coin, { side: fv.side, level: fv.entry, limit: fv.entry, stop: fv.stop, tp: fv.tp, atr: 0, barTime: Math.floor(Date.now() / 3_600_000) * 3_600_000 }, FVG_PAPER);
          // FVG chỉ ghi paper, không gửi tin → không markAlerted (trước đây chặn nhầm tin 📌 của coin 6 giờ)
        }
        const btcH1 = await candles("BTC-USDT-SWAP", "1H", 30).catch(() => []);
        const p = pickCoin(coin, { own: (await getDailyData(coin)).trend, btc, h4: h4o.filter((x) => x.closed), h1: h1c, m15: m15o.filter((x) => x.closed), btcH1 }, 4);
        const hour = Math.floor(Date.now() / 3_600_000);
        const key = p && `OV:${coin}:${p.side}:${hour}`;
        // Đã báo coin này (bất kỳ chiều) trong 6 giờ → không báo lặp, không lật kèo
        const recent = p && [0, 1, 2, 3, 4, 5].some((h) => sent.has(`OV:${coin}:1:${hour - h}`) || sent.has(`OV:${coin}:-1:${hour - h}`));
        if (p && key && !recent) {
          // Tắt tin: overview_study 2025–26 phí 0 −0.02R, 2025 âm, điểm ≥5 còn tệ hơn → chỉ paper để đo tiếp
          sent.add(key);
          // barTime = nến 1H đang chạy: bỏ qua phần nến trước lúc vào lệnh
          const barTime = Math.floor(Date.now() / 3_600_000) * 3_600_000;
          // Limit chờ hồi: trước đây paper coi như khớp ngay ở giá limit → thổi phồng kết quả khi giá chạy luôn không hồi
          // shortcut: limit paper hết hạn sau 24h (stepLimits), không phải 4 nến 15m như tin nhắn; đổi nếu kèo này thành ứng viên live
          if (p.orderType === "LIMIT_PULLBACK") addLimit(coin, { side: p.side, level: p.entry, limit: p.entry, stop: p.stop, tp: p.tp, atr: 0, barTime }, OVERVIEW_LIMIT_PAPER);
          else openPaper1h(coin, { side: p.side, entry: p.entry, stop: p.stop, barTime }, OVERVIEW_PAPER);
        }
      } catch (e) {
        console.error(`[OVERVIEW] ${coin}:`, e);
      }
    }
    saveDedup(sent, preSent);
  }

  // Quản lý paper 1H (chạy ngầm, không gửi alert rác tay lên Telegram)
  if (new Date().getUTCMinutes() < 15) {
    for (const coin of COINS) {
      try {
        // 100 nến: kèo ICT cần trọn ngày hôm qua (và hôm kia khi quét từ hôm qua)
        const bars1h = await candles(`${coin}-USDT-SWAP`, "1H", 100);
        for (const m of managePaper1h(coin, bars1h)) await send(m);
        for (const m of stepLimits(coin, bars1h)) await send(m);
        for (const m of stepLimits(coin, bars1h, ICT_PAPER)) await send(m);
        // 📌 Đặt sẵn Limit bắt râu quét (đạt chuẩn fee0_shootout 2025–26: +0.07R, hơn vào ngẫu nhiên cả 2 năm). Bị xoá nhầm ở 09fdfd3
        const own = (await getDailyData(coin)).trend;
        // chỉ LONG: SHORT 2025–26 +0.047R nhưng thua vào ngẫu nhiên (+0.070R) → không đạt
        const rl = own > 0 ? restingLimit(bars1h, 1) : null;
        const rlKey = rl && `RL:${coin}:${rl.side}:${rl.barTime}`;
        const oldRl = rl && loadLimits().find((x) => x.coin === coin && x.status === "pending");
        if (rl && rlKey && !sent.has(rlKey) && addLimit(coin, rl, undefined, true)) {
          // lệnh thay thế luôn báo (bỏ qua chặn 6 giờ) để chủ tài khoản huỷ Limit cũ trên sàn
          // TP1 = 1R chốt 50% rồi dời SL về giá vào (chủ dự án đánh nhanh; 2025 +0.003R, 2026 +0.076R, thắng ~53%)
          if (oldRl || !recentlyAlerted(coin, rl.side)) plan(rl.side, coin, "📌 Limit", rl.limit, rl.stop, rl.tp, oldRl ? `huỷ Limit cũ ${f(oldRl.limit)}` : "");
          markAlerted(coin, rl.side);
          sent.add(rlKey);
          saveDedup(sent, preSent);
        }
        // 🎯 ICT quét đỉnh hôm qua → ChoCh → Sell Limit giữa FVG (ict_sweep_study + live_replay_study: 2025 +119$, 2026 +85$)
        const ict = ictSweepShort(bars1h);
        const ictKey = ict && `ICT:${coin}:${ict.barTime}`;
        if (ict && ictKey && !sent.has(ictKey)) {
          addLimit(coin, ict, ICT_PAPER);
          plan(-1, coin, "🎯 ICT Limit", ict.limit, ict.stop, ict.tp, "quét đỉnh hôm qua");
          markAlerted(coin, -1);
          sent.add(ictKey);
          saveDedup(sent, preSent);
        }
      } catch (e) {
        console.error(`[MANAGE 1H] ${coin}:`, e);
      }
    }
  }

  if (digest.length) {
    digest.sort((a, b) => b.rr - a.rr);
    await send(
      `📋 *KÈO MỚI ${vnTime(Date.now())}*\n` + digest.slice(0, 5).map((d) => d.text).join("\n")
    );
  }

  // Giới hạn số lệnh đồng thời: Kèo thường theo maxOpenTrades (2 lệnh), Kèo Đẹp ★★★ cho phép tối đa 3 lệnh
  const maxLiveLimit = Math.max(currentTier.maxOpenTrades, 3);
  if (liveOpenSymbols.size >= maxLiveLimit) {
    return [];
  }

  for (const coin of COINS) {
    // Không bao giờ nhồi thêm lệnh vào coin đang có vị thế mở trên MEXC
    if (liveOpenSymbols.has(coin)) continue;
    try {
      await new Promise((r) => setTimeout(r, 120));
      const [bars4h, dailyInfo] = await Promise.all([
        candles(`${coin}-USDT-SWAP`, "4H", 300),
        getDailyData(coin),
      ]);
      const own = coin === "BTC" ? btc : dailyInfo.trend;
      const bars1d = dailyInfo.cs;
      reconcilePaperPositions(coin, bars4h, currentEquity);
      const a4 = analyse(bars4h);

      const [tLive, fLive] = await Promise.all([
        ticker(`${coin}-USDT-SWAP`).catch(() => null),
        funding(`${coin}-USDT-SWAP`).catch(() => null),
      ]);
      // Không có giá live → không kiểm được trôi giá → không vào lệnh
      if (!tLive || !Number.isFinite(tLive.last)) continue;
      const fundingRate = fLive?.rate;

      // 0. Quét Daily Trend Following Donchian (backtest: lợi thế 2025–2026 chỉ ~+0.01–0.03R/lệnh)
      if (bars1d.length >= 25 && btc > 0) {
        const aDaily = analyseDaily(bars1d);
        for (const s of aDaily.setups) {
          if (s.state !== "triggered") continue;
          if (liveOpenSymbols.has(coin) || liveOpenSymbols.size >= maxLiveLimit) continue;
          const decision = evaluateSetup(s, {
            coin,
            timeframe: "1D",
            btcDaily: btc,
            ownDaily: own,
            equity: currentEquity,
            peakEquity: globalThis.mexcPeakEquity ?? currentEquity, // đỉnh vốn THẬT; đỉnh paper lãi ảo gây khóa oan
            lastBarTime: aDaily.lastBarTime,
            livePrice: tLive?.last,
            fundingRate,
          });

          if (!decision.accepted || !decision.plan) continue;
          const plan = decision.plan;
          const key = `1D:${coin}:${s.style}:${s.side}:${aDaily.lastBarTime}`;
          if (sent.has(key)) continue;

          const sizing = plan.sizing;
          if (sizing.margin > remainingMargin) continue;

          const mexcOrder = await submitMexcOrder({
            symbol: coin,
            side: s.side,
            notional: sizing.notional,
            price: s.entry,
            leverage: sizing.leverage,
            stopLossPrice: s.stop,
            dryRunOverride: !isLiveEligible(s.style, s.side, "1D", own, btc), // Donchian 1D chỉ paper
          });

          if (mexcOrder.success) {
            const protection = await submitMexcTpSl({
              symbol: coin,
              side: s.side,
              vol: mexcOrder.vol,
              stopLossPrice: s.stop,
              takeProfit1Price: plan.tp1,
              takeProfit2Price: plan.tp2,
              dryRunOverride: mexcOrder.isDryRun,
            });

            const isKept = await keepOnlyIfProtected(coin, s.side, mexcOrder.vol, protection);
            if (!isKept) {
              console.warn(`[MEXC 1D] Không giữ được lệnh ${coin} do lỗi SL.`);
              continue;
            }

            if (!mexcOrder.isDryRun) {
              liveOpenSymbols.add(coin);
              remainingMargin = Math.max(0, remainingMargin - sizing.margin);
              const fullSymbol = `${coin}_USDT`;
              lastPositions.set(fullSymbol, {
                symbol: fullSymbol,
                side: "LONG",
                openAvgPrice: s.entry,
                holdVol: mexcOrder.vol,
              });
            }

            // Donchian 1D chỉ paper: ghi sổ, không gửi Telegram (backtest không đạt, tránh bị vào theo)
            if (mexcOrder.isDryRun) { sent.add(key); saveDedup(sent, preSent); continue; }
            const riskPct = Math.abs(s.entry - s.stop) / s.entry;
            const autoTag = mexcOrder.isDryRun
              ? `🚀 *[VÀO LỆNH (PAPER)]*`
              : `🤖 *[MEXC ĐÃ VÀO LỆNH THẬT - ${mexcOrder.vol} HĐ]*`;

            itemsToSend.push({
              key,
              msg:
                `${autoTag} 🟢 LONG *${coin}* (Khung Ngày 1D)\n` +
                `• *Chiến lược:* Daily Donchian Trend Following (thoát theo đáy 10D, không TP cố định)\n` +
                `• *Điểm vào:* ~${f(s.entry)}\n` +
                `• *Cắt lỗ (SL cứng 2 ATR):* ${f(s.stop)} (-${(riskPct * 100).toFixed(2)}%)\n` +
                `• *Mốc Trailing thoát lệnh (Đáy 10D):* ${f(aDaily.pastLow10d)}\n` +
                `• *Vốn rủi ro (Risk):* \`${sizing.actualRiskUsd.toFixed(2)}$\` (${mexcOrder.vol} HĐ x10 Isolated)\n` +
                `• *Điều kiện vĩ mô:* BTC Ngày Uptrend 🟢, Phá đỉnh 20 ngày 🚀`,
            });
            sent.add(key);
            saveDedup(sent, preSent);
          }
        }
      }

      // 1. Quét 4H
      for (const s of a4.setups) {
        if (s.state !== "triggered") continue;
        const isStar = isStarSetup(s.side, own, btc);
        const tradeLimit = isStar ? maxLiveLimit : currentTier.maxOpenTrades;
        if (liveOpenSymbols.has(coin) || liveOpenSymbols.size >= tradeLimit) continue;
        const decision = evaluateSetup(s, {
          coin,
          timeframe: "4H",
          btcDaily: btc,
          ownDaily: own,
          equity: currentEquity,
          peakEquity: globalThis.mexcPeakEquity ?? currentEquity, // đỉnh vốn THẬT; đỉnh paper lãi ảo gây khóa oan
          lastBarTime: a4.lastBarTime,
          livePrice: tLive?.last,
          btc1hBars: btc1h,
          fundingRate,
        });
        if (!decision.accepted || !decision.plan) continue;
        const plan = decision.plan;
        const risk = plan.riskPct;

        const key = `4H:${coin}:${s.style}:${s.side}:${a4.lastBarTime}`;
        if (sent.has(key)) continue;

        const sizing = plan.sizing;

        const isLiveConfigured = process.env.MEXC_LIVE_TRADING === "true" && process.env.MEXC_DRY_RUN === "false";
        const eligibleForLive = isLiveEligible(s.style, s.side, "4H", own, btc, s.volumeRatio ?? 1.0, new Date());

        // Chỉ kiểm tra margin thật nếu setup này thực sự được phép đánh Live tiền thật
        if (isLiveConfigured && eligibleForLive && sizing.margin > remainingMargin) {
          console.error(`[MEXC] Bỏ qua ${coin}: cần ${sizing.margin} USDT margin, chỉ còn ${remainingMargin} USDT`);
          continue;
        }

        // Đặt lệnh MEXC (thực tế hoặc dry-run). Nếu bật Live nhưng setup không đủ chuẩn Live -> Ép về mock.
        const effectiveDryRun = isLiveConfigured && !eligibleForLive;
        if (effectiveDryRun) {
          console.warn(`[MEXC LIVE BẢO VỆ] ${coin} ${s.style} không đủ chuẩn Live (+ExpR sau phí). Chỉ chạy Paper/Cảnh báo.`);
        }

        const mexcOrder = await submitMexcOrder({
          symbol: coin,
          side: s.side,
          notional: sizing.notional,
          price: s.entry,
          leverage: sizing.leverage,
          stopLossPrice: s.stop,
          dryRunOverride: effectiveDryRun,
        });

        if (!mexcOrder.success) {
          console.error(`[MEXC] Không mở được ${coin}: ${mexcOrder.error ?? "unknown error"}`);
          continue;
        }

        // Hai đỉnh/đáy đủ chuẩn live: không TP, gồng lãi bằng trailing 3 ATR
        const trailMode = eligibleForLive && s.style === "double_top_bottom";
        const protection = await submitMexcTpSl({
            symbol: coin,
            side: s.side,
            vol: mexcOrder.vol,
            stopLossPrice: s.stop,
            takeProfit1Price: trailMode ? 0 : plan.tp1,
            takeProfit2Price: trailMode ? 0 : plan.tp2,
            dryRunOverride: effectiveDryRun,
        });
        if (!(await keepOnlyIfProtected(coin, s.side, mexcOrder.vol, protection))) {
          if (!mexcOrder.isDryRun) liveOpenSymbols.add(coin);
          continue;
        }
        if (!mexcOrder.isDryRun) {
          liveOpenSymbols.add(coin);
          remainingMargin = Math.max(0, remainingMargin - sizing.margin);
          if (trailMode) { trailing[`${coin}_USDT`] = { side: s.side, entryTime: Date.now() }; saveDedup(sent, preSent); }
          recordOpen({ symbol: `${coin}_USDT`, style: s.style, side: s.side, entry: tLive.last, stop: s.stop, riskUsd: sizing.actualRiskUsd, entryTime: Date.now() });
          const fullSymbol = `${coin}_USDT`;
          lastPositions.set(fullSymbol, {
            symbol: fullSymbol,
            side: s.side > 0 ? "LONG" : "SHORT",
            openAvgPrice: s.entry,
            holdVol: mexcOrder.vol,
          });
        }

        const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";

        // Setup không đủ chuẩn live (BOS, pinbar, ngược trend): chỉ ghi sổ paper, không gửi thẻ Telegram
        if (effectiveDryRun) {
          sent.add(key);
          saveDedup(sent, preSent);
          openPaperPlan(key, decision, bars4h, currentEquity);
          break;
        }
        // Cùng mẫu 2 dòng với tin kèo tay
        itemsToSend.push({
          key,
          msg:
            `${mexcOrder.isDryRun ? "📋 Thử (chưa vào thật)" : "🤖 Bot đã vào"} ${sideStr} *${coin}* · 4H kim cương ${f(s.entry)}\n` +
            `   SL ${f(s.stop)} (−${(risk * 100).toFixed(1)}%) · ` +
            (trailMode ? "không TP, SL tự dời theo 3 ATR" : `TP1 ${f(plan.tp1)} · TP2 ${f(plan.tp2)}`) +
            ` · ký quỹ ${sizing.margin}$ x${sizing.leverage}`
        });
        openPaperPlan(key, decision, bars4h, currentEquity);
        break;
      }

      // Khung 1H không tự động vào lệnh và dễ gây ngứa tay, chỉ phục vụ tra cứu khi người dùng gõ bot (/scan, tên coin).
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
  const candidates: { coin: string; distPct: number; line: string }[] = [];
  const paper = paperSummary(CAPITAL);

  for (const coin of COINS) {
    try {
      await new Promise((r) => setTimeout(r, 60));
      const own = coin === "BTC" ? btc : await dailyTrend(coin);

      // 1. Quét 4h nếu đang ở slot 4h: CHỈ LỌC KÈO CHUẨN KIM CƯƠNG (Hai đáy / Hai đỉnh), LOẠI BỎ BOS ĐỂ TRÁNH BÁO COIN XẤU
      if (is4hSlot) {
        const a4 = analyse(await candles(`${coin}-USDT-SWAP`, "4H", 300));
        for (const s of a4.setups) {
          if (s.state !== "pending") continue;
          // Chỉ giữ Hai đỉnh / Hai đáy (loại bỏ hoàn toàn BOS phá cản yếu như XRP)
          if (s.style !== "double_top_bottom") continue;
          const decision = evaluateSetup(s, { coin, timeframe: "4H", btcDaily: btc, ownDaily: own, equity: paper.equity, peakEquity: paper.peakEquity, lastBarTime: a4.lastBarTime, now });
          if (decision.code !== "PENDING_CONFIRMATION" || Math.abs(s.distancePct) > 0.015) continue;
          const risk = Math.abs(s.entry - s.stop) / s.entry;
          const isStar = isStarSetup(s.side, own, btc);
          const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
          const styleStr = s.side > 0 ? "Hai đáy 4H" : "Hai đỉnh 4H";

          candidates.push({
            coin,
            distPct: Math.abs(s.distancePct) * 100,
            line: `• ${coin} ${sideStr} (${styleStr})${isStar ? " ⭐ [KÈO ĐẸP ★★★]" : ""}: cần đóng ${s.side > 0 ? ">" : "<"} ${f(s.entry)} (sát cản ${(Math.abs(s.distancePct) * 100).toFixed(2)}%) · SL ${f(s.stop)} (-${(risk * 100).toFixed(1)}%)`
          });
        }
      }

    } catch (e) {
      console.error(`telegram pre ${coin}`, e);
    }
  }

  // Nếu KHÔNG có coin nào sắp kích hoạt: TUYỆT ĐỐI IM LẶNG
  if (!candidates.length) {
    return null;
  }

  // Sắp xếp chọn ĐÚNG TOP 2 coin áp sát cản nhất, loại bỏ danh sách dài gây rối
  candidates.sort((a, b) => a.distPct - b.distPct);
  const lines4h = candidates.slice(0, 2).map((c) => c.line);

  const msg = `⏰ *[SẮP ĐÓNG NẾN 4H]* ${vnTime(close4h)} (còn ~${Math.round(left4h / 60_000)} phút)\n` +
    `📌 *Setup áp sát điểm kích hoạt:*\n${lines4h.join("\n")}\n\n💡 _Bot sẽ tự động đánh giá khối lượng và vào lệnh nếu đạt Chuẩn Kim Cương (24/7)._`;

  const ok = await send(msg);
  if (ok) {
    preSent.add(key);
    saveDedup(sent, preSent);
    return msg;
  }
  return null;
}

const radarSent = new Map<string, number>();

/**
 * Radar tự động: quét liên tục mỗi 5 phút, báo động khi coin lọt vào vùng tiệm cận <= 1.0% Đỉnh cũ / Đáy cũ
 */
export async function proximityRadarAlert(): Promise<string | null> {
  const alerts: string[] = [];
  const now = Date.now();

  for (const coin of COINS) {
    try {
      await new Promise((r) => setTimeout(r, 50));
      const [c4, tLive] = await Promise.all([
        candles(`${coin}-USDT-SWAP`, "4H", 60),
        ticker(`${coin}-USDT-SWAP`).catch(() => null),
      ]);
      const { highs, lows } = swings(c4);
      if (!highs.length || !lows.length || !tLive) continue;

      const lastHigh = c4[highs.at(-1)!].h;
      const lastLow = c4[lows.at(-1)!].l;
      const livePrice = tLive.last;

      const distHigh = (lastHigh - livePrice) / livePrice;
      const distLow = (livePrice - lastLow) / livePrice;

      // 1. Áp sát Đỉnh cũ (cách <= 1.0% hoặc vừa nhú qua <= 0.3%)
      if (distHigh >= -0.003 && distHigh <= 0.010) {
        const key = `RADAR:HIGH:${coin}:${lastHigh}`;
        const lastSent = radarSent.get(key) ?? 0;
        if (now - lastSent > 2 * 3_600_000) {
          radarSent.set(key, now);
          const pct = (Math.abs(distHigh) * 100).toFixed(2);
          alerts.push(
            `🏔️ *${coin}* đang ở \`${f(livePrice)}\` ➔ Sát ĐỈNH CŨ \`${f(lastHigh)}\` (cách *${pct}%*)!\n` +
            `👉 *Mở chart canh:* Rút râu xả (Pinbar) ➔ Canh SHORT; Nến 1H đóng vượt ➔ Canh LONG.`
          );
        }
      }

      // 2. Áp sát Đáy cũ (cách <= 1.0% hoặc vừa nhúng qua <= 0.3%)
      if (distLow >= -0.003 && distLow <= 0.010) {
        const key = `RADAR:LOW:${coin}:${lastLow}`;
        const lastSent = radarSent.get(key) ?? 0;
        if (now - lastSent > 2 * 3_600_000) {
          radarSent.set(key, now);
          const pct = (Math.abs(distLow) * 100).toFixed(2);
          alerts.push(
            `🏖️ *${coin}* đang ở \`${f(livePrice)}\` ➔ Sát ĐÁY CŨ \`${f(lastLow)}\` (cách *${pct}%*)!\n` +
            `👉 *Mở chart canh:* Rút chân pinbar ➔ Canh LONG bắt đáy; Nến đóng thủng ➔ Canh SHORT.`
          );
        }
      }
    } catch {}
  }

  if (!alerts.length) return null;

  const msg = `🧭 *[RADAR TỰ ĐỘNG: TIỆM CẬN ĐỈNH / ĐÁY]*\n\n${alerts.join("\n\n")}\n\n💡 Nhắn tên coin (ví dụ: \`${COINS[0]}\`) để xem thông số SL/TP!`;
  await send(msg);
  return msg;
}

