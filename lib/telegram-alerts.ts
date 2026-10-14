// Telegram signal alerts according to disciplined backtested rules:
// 4H only: BOS LONG; double top/bottom only with matching BTC + coin daily trends.
//    Includes 5-minute heads-up preview before each 4h close when coin is near level (<= 1.2%).
// Uses unified trading policy from @/lib/trading-policy.

import fs from "fs";
import path from "path";
import { analyse, swings, analyseDaily, wickReversal, freshSweep } from "@/lib/patterns";
import { candles, ticker, funding, type Candle } from "@/lib/okx";
import { evaluateSetup } from "@/lib/decision-engine";
import { openPaperPlan, paperSummary, reconcilePaperPositions } from "@/lib/paper-ledger";
import { isStarSetup, isLiveEligible, calculatePartialPnL, formatEntryReason, trailingStop } from "@/lib/trading-policy";
import { getCapitalTier, checkTierChange } from "@/lib/capital-tier";
import { getMexcAccountAsset, getMexcOpenPositions, getMexcOpenStopOrders, submitMexcOrder, submitMexcTpSl, closeMexcPosition, moveStopsToBreakeven, tightenStop, getRealizedPnl } from "@/lib/mexc-client";
import { loadJournal, recordOpen, recordClose, recordTrail, openTrade } from "@/lib/trade-journal";
import { loadWatches, saveWatches, evaluateWatches } from "@/lib/price-watch";
import { managePaper1h, openPaper1h } from "@/lib/paper-1h";
import { pickCoin, type OverviewPick } from "@/lib/overview";

const COINS = [
  "BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK",
  "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"
];

const CAPITAL = Number(process.env.ALERT_CAPITAL ?? 40);

// data/ là Railway volume (/app/data) → chống trùng & đỉnh vốn sống sót qua redeploy
const DEDUP_FILE = path.join(process.cwd(), "data", "telegram-sent.json");
const OVERVIEW_PAPER = path.join(process.cwd(), "data", "paper-overview.json");

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

  // Toàn cảnh 5 lớp, quét mỗi 5 phút, cả LONG lẫn SHORT. Chỉ báo + paper (data/paper-overview.json).
  if (new Date().getUTCMinutes() % 5 < 2) {
    const picks: OverviewPick[] = [];
    for (const coin of COINS) {
      try {
        const [h4o, h1o, m15o] = await Promise.all([
          candles(`${coin}-USDT-SWAP`, "4H", 120), candles(`${coin}-USDT-SWAP`, "1H", 100), candles(`${coin}-USDT-SWAP`, "15m", 100),
        ]);
        const h1c = h1o.filter((x) => x.closed);
        for (const m of managePaper1h(coin, h1o, OVERVIEW_PAPER)) await send(m.replace("PAPER 1H", "PAPER TOÀN CẢNH"));
        const p = pickCoin(coin, { own: (await getDailyData(coin)).trend, btc, h4: h4o.filter((x) => x.closed), h1: h1c, m15: m15o.filter((x) => x.closed) }, 3);
        const hour = Math.floor(Date.now() / 3_600_000);
        const key = p && `OV:${coin}:${p.side}:${hour}`;
        // Đã báo coin này (bất kỳ chiều) trong 6 giờ → không báo lặp, không lật kèo
        // (2026-10-13: NEAR/DOT LONG bị báo lại mỗi giờ khi setup còn nguyên)
        const recent = p && [0, 1, 2, 3, 4, 5].some((h) => sent.has(`OV:${coin}:1:${hour - h}`) || sent.has(`OV:${coin}:-1:${hour - h}`));
        if (p && key && !recent) {
          picks.push(p);
          sent.add(key);
          // barTime = nến 1H đang chạy: bỏ qua phần nến trước lúc vào lệnh (PAPER PEPE từng "chạm SL" bằng giá trước khi vào)
          if (p.score >= 4) openPaper1h(coin, { side: p.side, entry: p.entry, stop: p.stop, barTime: Math.floor(Date.now() / 3_600_000) * 3_600_000 }, OVERVIEW_PAPER);
        }
      } catch (e) {
        console.error(`[OVERVIEW] ${coin}:`, e);
      }
    }
    if (picks.length) {
      saveDedup(sent, preSent);
      picks.sort((a, b) => b.score - a.score || b.rr - a.rr);
      await send(
        `🧭 *[TOÀN CẢNH ${vnTime(Date.now())}]* ${picks.length} kèo\n` +
        picks.map((p) => {
          const risk = Math.abs(p.entry - p.stop) / p.entry;
          return `${p.score >= 4 ? "⭐ " : ""}*${p.side > 0 ? "🟢 LONG" : "🔴 SHORT"} ${p.coin}* (${p.score}/5): ${p.reasons.join(" · ")}\n` +
            `   Vào ~${f(p.entry)} · SL ${f(p.stop)} · TP ${f(p.tp)} (${p.rr.toFixed(1)}R) · x tối đa ${Math.min(20, Math.max(1, Math.floor(0.8 / risk)))}`;
        }).join("\n") +
        `\n_⭐ = bot đánh paper để đo. Chưa backtest, đánh nhỏ._`
      );
    }
  }

  // Cảnh báo tay sau nến 1H: quét swing đỉnh/đáy rồi nến đảo chiều mạnh. Chỉ báo, không vào lệnh.
  if (new Date().getUTCMinutes() < 15) {
    for (const coin of COINS) {
      try {
        const bars1h = await candles(`${coin}-USDT-SWAP`, "1H", 60);
        for (const m of managePaper1h(coin, bars1h)) await send(m);
        const own = (await getDailyData(coin)).trend;
        // Chỉ báo kèo thuận xu hướng ngày của coin (chủ dự án nới: BTC ngược chiều vẫn báo, có ghi chú)
        const aligned = (side: number) => own === side;
        const btcNote = (side: number) => (btc === side ? "✅ BTC cùng chiều" : "⚠️ BTC ngược chiều");
        // Đòn bẩy tối đa để SL nằm trước giá thanh lý (chừa 20% đệm)
        const maxLev = (riskPct: number) => Math.min(20, Math.max(1, Math.floor(0.8 / riskPct)));
        const sw = freshSweep(bars1h);
        const swKey = sw && `SW1H:${coin}:${sw.side}:${sw.barTime}`;
        if (sw && swKey && !sent.has(swKey) && aligned(sw.side)) {
          const swRisk = Math.abs(sw.close - sw.wick) / sw.close;
          await send(
            `⏳ *[SẮP QUAY ĐẦU 1H]* ${sw.side > 0 ? "🟢 LONG" : "🔴 SHORT"} *${coin}* ✅ thuận coin · ${btcNote(sw.side)}\n` +
            `• Râu ${sw.side > 0 ? "thủng đáy" : "vượt đỉnh"} ${f(sw.level)} rồi bị đẩy lại (râu ${f(sw.wick)}, đóng ${f(sw.close)})\n` +
            `• *Nên chờ* nến 1H kế ${sw.side > 0 ? "xanh" : "đỏ"} thân lớn. Vào sớm ngay bây giờ backtest ≈ −0.27R/lệnh (tệ nhất).\n` +
            `• Nếu vẫn vào sớm: SL ngoài râu ${f(sw.wick)} · đòn bẩy tối đa x${maxLev(swRisk)}`
          );
          sent.add(swKey);
          saveDedup(sent, preSent);
        }
        const w = wickReversal(bars1h);
        if (!w || !aligned(w.side) || Math.abs(w.entry - w.stop) / w.entry > 0.06) continue; // SL > 6%: như luật bot, quá xa
        const key = `WR1H:${coin}:${w.side}:${w.barTime}`;
        if (sent.has(key)) continue;
        const risk = Math.abs(w.entry - w.stop) / w.entry;
        const paperOpened = openPaper1h(coin, w);
        await send(
          (paperOpened ? `🧪 _Bot đã vào lệnh PAPER (tiền giả), trailing 3 ATR 1H._\n` : "") +
          `👀 *[TÍN HIỆU QUAY ĐẦU 1H]* ${w.side > 0 ? "🟢 LONG" : "🔴 SHORT"} *${coin}* ✅ thuận coin · ${btcNote(w.side)}\n` +
          `• ${w.side > 0 ? "Thủng đáy" : "Vượt đỉnh"} ${f(w.level)} *thất bại*, nến 1H ${w.side > 0 ? "xanh" : "đỏ"} thân lớn xác nhận\n` +
          `• Entry ~${f(w.entry)} · SL ${f(w.stop)} (${(risk * 100).toFixed(2)}%) · TP 1.8R ${f(w.tp)}\n` +
          `• *Đòn bẩy tối đa x${maxLev(risk)}* (cao hơn → SL nằm sau giá thanh lý)\n` +
          `_Bot KHÔNG tự vào. Backtest 1H thuận trend ≈ −0.1R/lệnh sau phí: chưa có lợi thế, đánh nhỏ._`
        );
        sent.add(key);
        saveDedup(sent, preSent);
      } catch (e) {
        console.error(`[WR1H] ${coin}:`, e);
      }
    }
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
        const pnl = calculatePartialPnL(sizing.actualRiskUsd);

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
        const reason = formatEntryReason({
          style: s.style,
          side: s.side,
          timeframe: "4H",
          btcDaily: btc,
          ownDaily: own,
          volumeRatio: s.volumeRatio,
        });

        // Setup không đủ chuẩn live (BOS, pinbar, ngược trend): chỉ ghi sổ paper, không gửi thẻ Telegram
        if (effectiveDryRun) {
          sent.add(key);
          saveDedup(sent, preSent);
          openPaperPlan(key, decision, bars4h, currentEquity);
          break;
        }
        const autoTag = !mexcOrder.isDryRun
          ? `🤖 *[MEXC TỰ ĐỘNG VÀO LỆNH (KIM CƯƠNG 24/7) - ${mexcOrder.vol} HĐ]*`
          : `📋 *[PAPER - KHÔNG ĐỦ CHUẨN LIVE]*`;

        itemsToSend.push({
          key,
          msg:
            `${autoTag} ${sideStr} *${coin}*\n` +
            `• *Điểm vào:* ~${f(s.entry)}\n` +
            `• *Cắt lỗ (SL):* ${f(s.stop)} (-${(risk * 100).toFixed(2)}%)\n` +
            (trailMode
              ? `• *Chốt lời:* không TP cố định, SL trailing 3 ATR theo nến 4H đóng${mexcOrder.isDryRun ? " (DRY-RUN)" : ""}\n`
              : `• *Chốt lời (TP):* TP1 ${f(plan.tp1)} (+${pnl.winTp1.toFixed(2)}$) | TP2 ${f(plan.tp2)} (+${pnl.totalWin.toFixed(2)}$)\n`) +
            `• *Sao vô:* ${reason}\n` +
            `• *Ký quỹ:* ~${sizing.margin}$ (x${sizing.leverage} Isolated) · *Rủi ro 1R:* ${sizing.actualRiskUsd}$`
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

