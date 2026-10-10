// Telegram signal alerts according to disciplined backtested rules:
// 4H only: BOS LONG; double top/bottom only with matching BTC + coin daily trends.
//    Includes 5-minute heads-up preview before each 4h close when coin is near level (<= 1.2%).
// Uses unified trading policy from @/lib/trading-policy.

import fs from "fs";
import path from "path";
import { analyse, swings, analyseDaily } from "@/lib/patterns";
import { candles, ticker, funding, type Candle } from "@/lib/okx";
import { evaluateSetup } from "@/lib/decision-engine";
import { openPaperPlan, paperSummary, reconcilePaperPositions } from "@/lib/paper-ledger";
import { isStarSetup, isLiveEligible, calculatePartialPnL, formatEntryReason } from "@/lib/trading-policy";
import { getCapitalTier, checkTierChange } from "@/lib/capital-tier";
import { getMexcAccountAsset, getMexcOpenPositions, getMexcOpenStopOrders, submitMexcOrder, submitMexcTpSl, closeMexcPosition, moveStopsToBreakeven } from "@/lib/mexc-client";
import { registerSniperTarget, evaluate15mSniper, sniperRadar, getTradingSessionInfo, detectVolumeAbsorption } from "@/lib/sniper-engine";

const COINS = [
  "BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK",
  "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"
];

const CAPITAL = Number(process.env.ALERT_CAPITAL ?? 40);

// data/ là Railway volume (/app/data) → chống trùng & đỉnh vốn sống sót qua redeploy
const DEDUP_FILE = path.join(process.cwd(), "data", "telegram-sent.json");

function loadDedup(): { sent: string[]; preSent: string[]; peakEquity?: number } {
  try {
    if (fs.existsSync(DEDUP_FILE)) {
      const data = JSON.parse(fs.readFileSync(DEDUP_FILE, "utf-8"));
      const peak = Number(data.peakEquity);
      return { sent: data.sent ?? [], preSent: data.preSent ?? [], peakEquity: Number.isFinite(peak) && peak > 0 ? peak : undefined };
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
    };
    fs.mkdirSync(path.dirname(DEDUP_FILE), { recursive: true });
    fs.writeFileSync(DEDUP_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("[DEDUP] Không ghi được file chống trùng:", e);
  }
}

const initialDedup = loadDedup();

declare global {
  var telegramSent: Set<string> | undefined;
  var telegramPreSent: Set<string> | undefined;
  var lastReportedTierEquity: number | undefined;
  var mexcPeakEquity: number | undefined;
}
const sent = (globalThis.telegramSent ??= new Set<string>(initialDedup.sent));
const preSent = (globalThis.telegramPreSent ??= new Set<string>(initialDedup.preSent));

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

  const paper = paperSummary(currentEquity);
  const itemsToSend: { key: string; msg: string }[] = [];
  const out: string[] = [];

  // Lấy danh sách vị thế đang mở thực tế trên MEXC và các lệnh Stop/TP đi kèm
  const [livePositions, openStopOrders] = await Promise.all([
    getMexcOpenPositions(),
    getMexcOpenStopOrders(),
  ]);
  const liveOpenSymbols = new Set(livePositions.filter((position) => position.holdVol > 0).map((position) => position.symbol.replace("_USDT", "")));

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
      const is1dDonchianPosition = !hasTpOrder && pos.positionType === 1;

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
            peakEquity: Math.max(paper.peakEquity, globalThis.mexcPeakEquity),
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
            }

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
          peakEquity: Math.max(paper.peakEquity, globalThis.mexcPeakEquity),
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
        const eligibleForLive = isLiveEligible(s.style, s.side, "4H", own, btc);

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

        const protection = await submitMexcTpSl({
            symbol: coin,
            side: s.side,
            vol: mexcOrder.vol,
            stopLossPrice: s.stop,
            takeProfit1Price: plan.tp1,
            takeProfit2Price: plan.tp2,
            dryRunOverride: effectiveDryRun,
        });
        if (!(await keepOnlyIfProtected(coin, s.side, mexcOrder.vol, protection))) {
          if (!mexcOrder.isDryRun) liveOpenSymbols.add(coin);
          continue;
        }
        if (!mexcOrder.isDryRun) {
          liveOpenSymbols.add(coin);
          remainingMargin = Math.max(0, remainingMargin - sizing.margin);
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

        const autoTag = mexcOrder.isDryRun
          ? `🚀 *[VÀO LỆNH]*`
          : `🤖 *[MEXC ĐÃ VÀO LỆNH - ${mexcOrder.vol} HĐ]*`;

        itemsToSend.push({
          key,
          msg:
            `${autoTag} ${sideStr} *${coin}*\n` +
            `• *Điểm vào:* ~${f(s.entry)}\n` +
            `• *Cắt lỗ (SL):* ${f(s.stop)} (-${(risk * 100).toFixed(2)}%)\n` +
            `• *Chốt lời (TP):* TP1 ${f(plan.tp1)} (+${pnl.winTp1.toFixed(2)}$) | TP2 ${f(plan.tp2)} (+${pnl.totalWin.toFixed(2)}$)\n` +
            `• *Sao vô:* ${reason}\n` +
            `• *Ký quỹ:* ~${sizing.margin}$ (x${sizing.leverage} Isolated) · *Rủi ro 1R:* ${sizing.actualRiskUsd}$`
        });
        openPaperPlan(key, decision, bars4h, currentEquity);
        break;
      }

      // 2. Quét 1H (Lướt sóng sớm)
      if (liveOpenSymbols.has(coin)) continue;
      const bars1h = await candles(`${coin}-USDT-SWAP`, "1H", 120);
      reconcilePaperPositions(coin, bars1h, currentEquity);
      const a1 = analyse(bars1h);
      for (const s of a1.setups) {
        if (s.state !== "triggered") continue;
        const isStar = isStarSetup(s.side, own, btc);
        const tradeLimit = isStar ? maxLiveLimit : currentTier.maxOpenTrades;
        if (liveOpenSymbols.has(coin) || liveOpenSymbols.size >= tradeLimit) continue;
        const decision1h = evaluateSetup(s, {
          coin,
          timeframe: "1H",
          btcDaily: btc,
          ownDaily: own,
          equity: currentEquity,
          peakEquity: Math.max(paper.peakEquity, globalThis.mexcPeakEquity),
          lastBarTime: a1.lastBarTime,
          livePrice: tLive?.last,
          btc1hBars: btc1h,
          fundingRate,
        });
        if (!decision1h.accepted || !decision1h.plan) continue;
        const plan1h = decision1h.plan;

        const key1h = `1H:${coin}:${s.style}:${s.side}:${a1.lastBarTime}`;
        if (sent.has(key1h)) continue;

        const sizing1h = plan1h.sizing;
        const pnl1h = calculatePartialPnL(sizing1h.actualRiskUsd);

        // QUY TẮC AN TOÀN TUYỆT ĐỐI: 1H chỉ chạy Paper & gửi Alert Telegram tham khảo, KHÔNG BAO GIỜ đặt lệnh thật
        const mexcOrder1h = await submitMexcOrder({
          symbol: coin,
          side: s.side,
          notional: sizing1h.notional,
          price: s.entry,
          leverage: sizing1h.leverage,
          stopLossPrice: s.stop,
          dryRunOverride: true,
        });

        if (!mexcOrder1h.success) {
          console.error(`[MEXC] Không mở được ${coin}: ${mexcOrder1h.error ?? "unknown error"}`);
          continue;
        }

        const protection1h = await submitMexcTpSl({
            symbol: coin,
            side: s.side,
            vol: mexcOrder1h.vol,
            stopLossPrice: s.stop,
            takeProfit1Price: plan1h.tp1,
            takeProfit2Price: plan1h.tp2,
            dryRunOverride: mexcOrder1h.isDryRun,
        });
        if (!(await keepOnlyIfProtected(coin, s.side, mexcOrder1h.vol, protection1h))) {
          continue;
        }

        const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
        const reason1h = formatEntryReason({
          style: s.style,
          side: s.side,
          timeframe: "1H",
          btcDaily: btc,
          ownDaily: own,
          volumeRatio: s.volumeRatio,
        });

        const autoTag1h = mexcOrder1h.isDryRun
          ? `⚡ *[LƯỚT SÓNG 1H]*`
          : `🤖 *[MEXC ĐÃ VÀO LỆNH - ${mexcOrder1h.vol} HĐ]*`;

        // ĐƯA VÀO RADAR BẮN TỈA 15M: Khi 1H phá vỡ, đăng ký theo dõi nhịp hồi 15m để tỉa điểm vào tối ưu
        registerSniperTarget({
          coin,
          side: s.side,
          breakoutTime: a1.lastBarTime + 3_600_000,
          breakoutPrice: s.entry,
          brokenLevel: s.level,
          waveHigh: Math.max(...bars1h.slice(-12).map((b) => b.h)),
          waveLow: Math.min(...bars1h.slice(-12).map((b) => b.l)),
          atr1h: Math.abs(s.entry - s.stop),
        });

        itemsToSend.push({
          key: key1h,
          msg:
            `${autoTag1h} ${sideStr} *${coin}*\n` +
            `• *Điểm vào:* ~${f(s.entry)}\n` +
            `• *Cắt lỗ (SL):* ${f(s.stop)} (-${(plan1h.riskPct * 100).toFixed(2)}%)\n` +
            `• *Chốt lời (TP):* TP1 ${f(plan1h.tp1)} (+${pnl1h.winTp1.toFixed(2)}$) | TP2 ${f(plan1h.tp2)} (+${pnl1h.totalWin.toFixed(2)}$)\n` +
            `• *Sao vô:* ${reason1h}\n` +
            `• *Ký quỹ:* ~${sizing1h.margin}$ (x${sizing1h.leverage} Isolated) · *Rủi ro 1R:* ${sizing1h.actualRiskUsd}$\n` +
            `🎯 *[RADAR 15M]*: Theo dõi nhịp hồi 15m về cản ${f(s.level)} trong 90 phút, có tín hiệu sẽ báo (chỉ báo tin, không tự vào lệnh)`
        });
        openPaperPlan(key1h, decision1h, bars1h, currentEquity);
        break;
      }

    } catch (e) {
      console.error(`telegram scan ${coin}`, e);
    }
  }

  // 3. Quét kiểm tra các mục tiêu đang nằm trong RADAR BẮN TỈA 15M
  for (const coin of Array.from(sniperRadar.keys())) {
    try {
      const bars15m = await candles(`${coin}-USDT-SWAP`, "15m", 30).catch(() => []);
      const sniperSignal = evaluate15mSniper(coin, bars15m);
      if (sniperSignal && sniperSignal.triggered) {
        const sniperKey = `SNIPER:15M:${coin}:${sniperSignal.side}:${bars15m.at(-1)?.t ?? Date.now()}`;
        if (!sent.has(sniperKey)) {
          const sideStr = sniperSignal.side > 0 ? "🟢 LONG" : "🔴 SHORT";
          const rDist = Math.abs(sniperSignal.entry - sniperSignal.stop);
          const tp1R = ((sniperSignal.tp1 - sniperSignal.entry) * sniperSignal.side) / rDist;
          const tp2R = ((sniperSignal.tp2 - sniperSignal.entry) * sniperSignal.side) / rDist;

          const sessionInfo = getTradingSessionInfo();
          const absorption = detectVolumeAbsorption(bars15m.filter((b) => b.closed));

          let extraInsights = `• *Khung giờ:* ${sessionInfo.multiplierText}\n`;
          if (absorption.isAbsorption) {
            extraInsights += `• *Dòng tiền:* 🐋 Phát hiện Cá Mập Hấp Thụ (Volume x${absorption.ratio.toFixed(1)} nổ to đỡ giá!)\n`;
          }

          itemsToSend.push({
            key: sniperKey,
            msg:
              `🎯 *[BẮN TỈA 15M - THAM KHẢO, KHÔNG VÀO LỆNH]* ${sideStr} *${coin}*\n\n` +
              `• *Tín hiệu:* ${sniperSignal.reason}\n` +
              `• *Giá vào lệnh tối ưu (Entry):* ~${f(sniperSignal.entry)}\n` +
              `• *Cắt lỗ siêu ngắn (SL):* ${f(sniperSignal.stop)} (-${(sniperSignal.riskPct * 100).toFixed(2)}%)\n` +
              `• *Chốt lời:* TP1 ~${f(sniperSignal.tp1)} (+${tp1R.toFixed(1)}R) | TP2 ~${f(sniperSignal.tp2)} (+${tp2R.toFixed(1)}R)\n` +
              extraInsights +
              `• *Lưu ý:* Backtest 2023–2026 sau phí −0.31R/lệnh (win 38%), chưa có lợi thế`
          });
        }
      }
    } catch (sniperErr) {
      console.error(`[SNIPER 15M] Lỗi quét ${coin}:`, sniperErr);
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

