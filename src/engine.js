/**
 * ENGINE.JS
 * Lõi phân tích chiến lược định lượng Smart Money / Demand-Supply & Liquidity.
 * Hiện thực hóa 100% công thức VIP của Dr. Kane (Sonic R Fibonacci EMAs 34 & 89):
 * 1. KANE_THUAN_TREND (Đánh thuận xu hướng EMA 34/89 & Key Levels)
 * 2. KANE_NGUOC_TREND (Đánh ngược xu hướng khi giá dãn nở xa EMA 34, râu nến H4 >= 45% & RR tới EMA 34 >= 1.0)
 * 
 * BẢO ĐẢM TÍNH TẤT ĐỊNH (PURE FUNCTIONS 100%) & CHỐNG LOOK-AHEAD BIAS.
 */

import {
  calculateEMA,
  calculateATR,
  analyzeCandle,
  isMarubozu,
  findFractalPivots
} from './indicators.js';

export const DEFAULT_CONFIG = {
  riskUsd: 10.0,
  leverage: 10,
  feeRate: 0.0008,          // 0.08% Taker roundtrip
  minRR: 2.0,
  beTriggerR: 1.5,          // Mốc kích hoạt kéo SL (+1.5R)
  lockProfitR: 1.0,         // Kéo SL lên dương +1.0R (khóa chắc 1R lợi nhuận, gồng tới 2R)
  beBufferRate: 0.0008,     // Đệm phí hòa vốn (0.08%)
  timeStopBars: 16,         // 16 nến M15 (4 tiếng)
  wickRatioThreshold: 0.35,
  atrBufferMultiplier: 0.25,
  maxSlDistanceRate: 0.025, // SMC No-Chasing Rule: Không vào nếu giá đã trôi xa cản SMC > 2.5%
  minCoinPrice: 1.0         // Lọc bỏ triệt để các coin giá 0.xx, chỉ giao dịch coin >= 1.0 USDT
};

const H4_MS = 4 * 60 * 60 * 1000;
const M15_MS = 15 * 60 * 1000;

/**
 * Tính toán Position Sizing chuẩn 1R
 */
export function calculatePositionSize(entry, stopLoss, riskUsd = 10, leverage = 10) {
  const riskPerUnit = Math.abs(entry - stopLoss);
  if (riskPerUnit <= 0) {
    return { size: 0, notional: 0, margin: 0, riskPerUnit: 0 };
  }

  const size = riskUsd / riskPerUnit;
  const notional = size * entry;
  const margin = notional / leverage;

  return {
    size,
    notional,
    margin,
    riskPerUnit
  };
}

/**
 * Kiểm tra Khiên bảo vệ BTC Macro 1H
 */
export function checkBtcMacroShield(btcH1Candles) {
  if (!btcH1Candles || btcH1Candles.length < 15) {
    return { canLong: true, canShort: true, reason: null };
  }

  const atrs = calculateATR(btcH1Candles, 14);
  const lastIdx = btcH1Candles.length - 1;
  const lastCandle = btcH1Candles[lastIdx];
  const lastAtr = atrs[lastIdx];

  if (!lastAtr) return { canLong: true, canShort: true, reason: null };

  const { isBullishMarubozu, isBearishMarubozu } = isMarubozu(lastCandle, lastAtr, 0.8, 0.65);

  if (isBearishMarubozu) {
    return { canLong: false, canShort: true, reason: 'BTC_1H_BEARISH_MARUBOZU_DUMP' };
  }
  if (isBullishMarubozu) {
    return { canLong: true, canShort: false, reason: 'BTC_1H_BULLISH_MARUBOZU_PUMP' };
  }

  return { canLong: true, canShort: true, reason: null };
}

/**
 * Master Evaluator - Đánh giá Thị trường theo chuẩn công thức VIP Dr. Kane H4/M15
 * @param {object} params
 * @returns {object|null}
 */
export function evaluateMarket({ symbol, candlesH4, candlesH1, candlesM15, btcH1Candles = null, config = DEFAULT_CONFIG }) {
  if (!candlesH4 || candlesH4.length < 90 || !candlesH1 || candlesH1.length < 15 || !candlesM15 || candlesM15.length < 5) {
    return null;
  }

  const currentM15 = candlesM15[candlesM15.length - 1];
  const prevM15 = candlesM15[candlesM15.length - 2];
  const curPrice = currentM15.close;

  // LỌC GIÁ TỐI THIỂU: Bỏ qua tuyệt đối các coin 0.xx (giá < minCoinPrice, mặc định 1.0 USDT)
  if (config.minCoinPrice && curPrice < config.minCoinPrice) {
    return null;
  }

  const lastH4 = candlesH4[candlesH4.length - 1];
  const lastH4CloseTime = lastH4.ts + H4_MS;
  const curM15CloseTime = currentM15.ts + M15_MS;

  // QUY TẮC ĐỘ TƯƠI MỚI (FRESHNESS):
  // Tín hiệu xác nhận M15 chỉ có giá trị trong vòng 1-4 nến M15 (1 giờ) ngay sau khi nến H4 đóng!
  const barsSinceH4Close = Math.round((curM15CloseTime - lastH4CloseTime) / M15_MS);
  if (barsSinceH4Close < 1 || barsSinceH4Close > 4) {
    return null;
  }

  // 1. Chỉ báo Kane VIP: EMA 34 & EMA 89 trên khung H4
  const closesH4 = candlesH4.map(c => c.close);
  const ema34Arr = calculateEMA(closesH4, 34);
  const ema89Arr = calculateEMA(closesH4, 89);
  const ema34 = ema34Arr[ema34Arr.length - 1];
  const ema89 = ema89Arr[ema89Arr.length - 1];

  if (!ema34 || !ema89) return null;

  // Xu hướng theo Kane EMA 34 & 89
  const isBullTrend = ema34 >= ema89;
  const isBearTrend = ema34 < ema89;

  // Lọc Fractal Key Levels H4 (Đỉnh Kháng cự & Đáy Hỗ trợ)
  const pivots = findFractalPivots(candlesH4, 2, 2);
  const resistances = pivots
    .filter(p => p.type === 'HIGH' && p.price > curPrice)
    .map(p => p.price)
    .sort((a, b) => a - b); // Tăng dần (gần nhất lên đầu)

  const supports = pivots
    .filter(p => p.type === 'LOW' && p.price < curPrice)
    .map(p => p.price)
    .sort((a, b) => b - a); // Giảm dần (gần nhất lên đầu)

  const atrsH1 = calculateATR(candlesH1, 14);
  const atrH1 = atrsH1[atrsH1.length - 1] || (curPrice * 0.005);
  const h4Anatomy = analyzeCandle(lastH4);

  // Khiên BTC Macro 1H
  const btcShield = checkBtcMacroShield(btcH1Candles);
  let blockedSignal = null;

  // =========================================================================
  // SETUP 1: KANE LONG
  // - Thuận trend Bull (EMA34 >= EMA89): Sweep hỗ trợ thường hoặc nến đảo chiều
  // - Ngược trend Bear (EMA34 < EMA89): CÔNG THỨC KANE: CHỈ KHI GIÁ CÁCH XA EMA34 (>= 3.0%),
  //   Râu H4 >= 45% & Khoảng cách về EMA 34 phải cho RR >= 1.0!
  // =========================================================================
  for (const sup of supports) {
    if (lastH4.low < sup) {
      const isStrongSweep = h4Anatomy.lowerWickRatio >= 0.45;
      const isNormalSweep = h4Anatomy.lowerWickRatio >= 0.35 && lastH4.close >= sup * 0.998;
      const prevH4 = candlesH4[candlesH4.length - 2];
      const isEngulfing = prevH4 && lastH4.close > lastH4.open && lastH4.close >= prevH4.open;

      let canLong = false;
      let isNgocTrend = false;

      if (isBullTrend) {
        canLong = isNormalSweep || isEngulfing;
      } else {
        const distBelowEma34 = (ema34 - curPrice) / curPrice;
        if (distBelowEma34 >= 0.030 && (isStrongSweep || isEngulfing)) {
          canLong = true;
          isNgocTrend = true;
        }
      }

      if (canLong) {
        // Điều kiện xác nhận M15: Nến M15 đóng xanh và phá đỉnh nến trước
        const isM15Green = currentM15.close > currentM15.open;
        const isM15Breakout = currentM15.close > prevM15.high;

        if (isM15Green && isM15Breakout) {
          const entry = currentM15.close;
          const stopLoss = lastH4.low - (config.atrBufferMultiplier * atrH1);

          // SMC No-Chasing Rule: Không vào nếu giá đã chạy quá xa đáy cản kỹ thuật
          const slDistanceRate = Math.abs(entry - stopLoss) / entry;
          if (config.maxSlDistanceRate && slDistanceRate > config.maxSlDistanceRate) {
            continue;
          }

          // Kane Rule: Đánh ngược trend thì khoảng cách tới EMA 34 phải đạt tối thiểu 1R
          if (isNgocTrend) {
            const rrToEma34 = (ema34 - entry) / (entry - stopLoss);
            if (rrToEma34 < 1.0) continue;
          }

          // Tìm Kháng cự đối diện đạt R:R >= minRR
          const targetRes = resistances.find(r => (r - entry) / (entry - stopLoss) >= config.minRR);

          if (targetRes) {
            const rr = (targetRes - entry) / (entry - stopLoss);
            if (!btcShield.canLong) {
              blockedSignal = { isBlocked: true, blockReason: btcShield.reason, symbol, direction: 'LONG' };
              continue;
            }

            const stratName = isNgocTrend ? 'KANE_NGUOC_TREND_LONG' : 'KANE_THUAN_TREND_LONG';
            const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);
            return {
              strategy: stratName,
              direction: 'LONG',
              symbol,
              entry,
              stopLoss,
              takeProfit: targetRes,
              riskReward: parseFloat(rr.toFixed(2)),
              triggerTime: currentM15.ts,
              sizing,
              reason: `${stratName}: H4 swept Support ${sup} (Râu ${(h4Anatomy.lowerWickRatio * 100).toFixed(1)}%), EMA34=${ema34.toFixed(2)}, M15 Bullish push`
            };
          }
        }
      }
    }
  }

  // =========================================================================
  // SETUP 2: KANE SHORT (Kèo ETH & LINK H4 của Kane)
  // - Thuận trend Bear (EMA34 < EMA89): Test Kháng cự & EMA34/89
  // - Ngược trend Bull (EMA34 >= EMA89): CÔNG THỨC KANE: CHỈ KHI GIÁ CÁCH XA EMA34 (>= 3.0%),
  //   Râu trên H4 >= 45% & Khoảng cách về EMA 34 phải cho RR >= 1.0!
  // =========================================================================
  for (const res of resistances) {
    const testedRes = Math.abs(lastH4.high - res) / res <= 0.008 || lastH4.high > res;
    if (testedRes) {
      const isStrongRejection = h4Anatomy.upperWickRatio >= 0.45;
      const isNormalRejection = h4Anatomy.upperWickRatio >= 0.25 || lastH4.close < lastH4.open;

      let canShort = false;
      let isNgocTrend = false;

      if (isBearTrend) {
        canShort = isNormalRejection;
      } else {
        const distAboveEma34 = (curPrice - ema34) / ema34;
        if (distAboveEma34 >= 0.030 && isStrongRejection) {
          canShort = true;
          isNgocTrend = true;
        }
      }

      if (canShort) {
        // Điều kiện xác nhận M15: Nến M15 đóng đỏ gãy đáy nến trước
        const isM15Red = currentM15.close < currentM15.open;
        const isM15Breakdown = currentM15.close < prevM15.low;

        if (isM15Red && isM15Breakdown) {
          const entry = currentM15.close;
          const stopLoss = lastH4.high + (config.atrBufferMultiplier * atrH1);

          // SMC No-Chasing Rule: Không vào nếu giá đã chạy quá xa đỉnh cản kỹ thuật
          const slDistanceRate = Math.abs(entry - stopLoss) / entry;
          if (config.maxSlDistanceRate && slDistanceRate > config.maxSlDistanceRate) {
            continue;
          }

          // Kane Rule: Đánh ngược trend thì khoảng cách tới EMA 34 phải đạt tối thiểu 1R
          if (isNgocTrend) {
            const rrToEma34 = (entry - ema34) / (stopLoss - entry);
            if (rrToEma34 < 1.0) continue;
          }

          // Tìm Hỗ trợ đối diện đạt R:R >= minRR
          const targetSup = supports.find(s => (entry - s) / (stopLoss - entry) >= config.minRR);

          if (targetSup) {
            const rr = (entry - targetSup) / (stopLoss - entry);
            if (!btcShield.canShort) {
              blockedSignal = { isBlocked: true, blockReason: btcShield.reason, symbol, direction: 'SHORT' };
              continue;
            }

            const stratName = isNgocTrend ? 'KANE_NGUOC_TREND_SHORT' : 'KANE_THUAN_TREND_SHORT';
            const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);
            return {
              strategy: stratName,
              direction: 'SHORT',
              symbol,
              entry,
              stopLoss,
              takeProfit: targetSup,
              riskReward: parseFloat(rr.toFixed(2)),
              triggerTime: currentM15.ts,
              sizing,
              reason: `${stratName}: H4 tested Res ${res} (Râu trên ${(h4Anatomy.upperWickRatio * 100).toFixed(1)}%), EMA34=${ema34.toFixed(2)}, M15 Bearish drop`
            };
          }
        }
      }
    }
  }

  return blockedSignal;
}
