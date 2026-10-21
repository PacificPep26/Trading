/**
 * ENGINE.JS
 * Lõi phân tích chiến lược định lượng Smart Money / Demand-Supply & Liquidity.
 * Mô phỏng chính xác phương pháp thực chiến của Dr. Kane:
 * 1. Setup A (Demand Sweep Long): Vùng cầu có điều kiện (Buy Zone ko Limit)
 * 2. Setup B (Supply Rejection Short): Kháng cự & Trendline giảm H4 từ chối (ETH H4 setup)
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
  beTriggerR: 1.5,
  beBufferRate: 0.0008,     // Đệm phí hòa vốn (0.08%)
  timeStopBars: 48,         // 48 nến M15 (12 tiếng) - Không bóp nghẹt lệnh Swing H4
  wickRatioThreshold: 0.35,
  atrBufferMultiplier: 0.25
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
 * Master Evaluator - Đánh giá Thị trường theo chuẩn Dr. Kane H4/M15
 * @param {object} params
 * @returns {object|null}
 */
export function evaluateMarket({ symbol, candlesH4, candlesH1, candlesM15, btcH1Candles = null, config = DEFAULT_CONFIG }) {
  if (!candlesH4 || candlesH4.length < 30 || !candlesH1 || candlesH1.length < 15 || !candlesM15 || candlesM15.length < 5) {
    return null;
  }

  const currentM15 = candlesM15[candlesM15.length - 1];
  const prevM15 = candlesM15[candlesM15.length - 2];
  const curPrice = currentM15.close;

  const lastH4 = candlesH4[candlesH4.length - 1];
  const lastH4CloseTime = lastH4.ts + H4_MS;
  const curM15CloseTime = currentM15.ts + M15_MS;

  // QUY TẮC ĐỘ TƯƠI MỚI (FRESHNESS):
  // Tín hiệu xác nhận M15 chỉ có giá trị trong vòng 1-4 nến M15 (1 giờ) ngay sau khi nến H4 đóng!
  // Tránh lặp lại tín hiệu bừa bãi hàng chục lần trên cùng 1 cây nến H4 cũ.
  const barsSinceH4Close = Math.round((curM15CloseTime - lastH4CloseTime) / M15_MS);
  if (barsSinceH4Close < 1 || barsSinceH4Close > 4) {
    return null;
  }

  // Phân tích xu hướng vĩ mô H4 (EMA20 vs EMA50)
  const closesH4 = candlesH4.map(c => c.close);
  const ema20Arr = calculateEMA(closesH4, 20);
  const ema50Arr = calculateEMA(closesH4, 50);
  const ema20 = ema20Arr[ema20Arr.length - 1];
  const ema50 = ema50Arr[ema50Arr.length - 1];

  const isBullTrend = ema20 >= ema50;
  const isBearTrend = ema20 < ema50;

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

  // =========================================================================
  // SETUP 1: KANE DEMAND ZONE & LIQUIDITY SWEEP (BUY ZONE CÓ ĐIỀU KIỆN)
  // Bắt đáy chữ V (như WLD 0,4561 và BTC 79.7k)
  // =========================================================================
  for (const sup of supports) {
    if (lastH4.low < sup) {
      // Điều kiện nến H4: Quét thủng hỗ trợ
      const isStrongSweep = h4Anatomy.lowerWickRatio >= 0.45;
      const isNormalSweep = h4Anatomy.lowerWickRatio >= 0.35 && lastH4.close >= sup * 0.998;
      const prevH4 = candlesH4[candlesH4.length - 2];
      const isEngulfing = prevH4 && lastH4.close > lastH4.open && lastH4.close >= prevH4.open;

      // Trong Bull Trend: Sweep thường là được. Trong Bear Trend: Yêu cầu rút râu cực mạnh (>= 45%) hoặc chữ V nuốt nến!
      const canLong = isBullTrend ? (isNormalSweep || isEngulfing) : (isStrongSweep || isEngulfing);

      if (canLong) {
        // Điều kiện xác nhận M15: Nến M15 đóng xanh và phá đỉnh nến trước
        const isM15Green = currentM15.close > currentM15.open;
        const isM15Breakout = currentM15.close > prevM15.high;

        if (isM15Green && isM15Breakout) {
          const entry = currentM15.close;
          const stopLoss = lastH4.low - (config.atrBufferMultiplier * atrH1);

          // Tìm Kháng cự đối diện đạt R:R >= minRR
          const targetRes = resistances.find(r => (r - entry) / (entry - stopLoss) >= config.minRR);

          if (targetRes) {
            const rr = (targetRes - entry) / (entry - stopLoss);
            if (!btcShield.canLong) {
              return { isBlocked: true, blockReason: btcShield.reason };
            }

            const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);
            return {
              strategy: 'KANE_DEMAND_SWEEP_LONG',
              direction: 'LONG',
              symbol,
              entry,
              stopLoss,
              takeProfit: targetRes,
              riskReward: parseFloat(rr.toFixed(2)),
              triggerTime: currentM15.ts,
              sizing,
              reason: `H4 swept Support ${sup} (Wick ${(h4Anatomy.lowerWickRatio * 100).toFixed(1)}%), M15 confirmed Bullish push`
            };
          }
        }
      }
    }
  }

  // =========================================================================
  // SETUP 2: KANE SUPPLY / TRENDLINE REJECTION SHORT (ETH H4 SETUP)
  // Bắt đỉnh hồi về Trendline / Kháng cự trong xu hướng giảm (như kèo ETH 2436 -> 2359)
  // =========================================================================
  for (const res of resistances) {
    const testedRes = Math.abs(lastH4.high - res) / res <= 0.008 || lastH4.high > res;
    if (testedRes) {
      // H4 phải có râu từ chối hoặc nến đỏ
      const isStrongRejection = h4Anatomy.upperWickRatio >= 0.45;
      const isNormalRejection = h4Anatomy.upperWickRatio >= 0.25 || lastH4.close < lastH4.open;

      // Trong Bear Trend: Rejection bình thường. Trong Bull Trend: Cần râu cực dài (>= 45%)
      const canShort = isBearTrend ? isNormalRejection : isStrongRejection;

      if (canShort) {
        // Điều kiện xác nhận M15: Nến M15 đóng đỏ gãy đáy nến trước
        const isM15Red = currentM15.close < currentM15.open;
        const isM15Breakdown = currentM15.close < prevM15.low;

        if (isM15Red && isM15Breakdown) {
          const entry = currentM15.close;
          const stopLoss = lastH4.high + (config.atrBufferMultiplier * atrH1);

          // Tìm Hỗ trợ đối diện đạt R:R >= minRR
          const targetSup = supports.find(s => (entry - s) / (stopLoss - entry) >= config.minRR);

          if (targetSup) {
            const rr = (entry - targetSup) / (stopLoss - entry);
            if (!btcShield.canShort) {
              return { isBlocked: true, blockReason: btcShield.reason };
            }

            const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);
            return {
              strategy: 'KANE_SUPPLY_REJECTION_SHORT',
              direction: 'SHORT',
              symbol,
              entry,
              stopLoss,
              takeProfit: targetSup,
              riskReward: parseFloat(rr.toFixed(2)),
              triggerTime: currentM15.ts,
              sizing,
              reason: `H4 tested Resistance ${res} (Upper Wick ${(h4Anatomy.upperWickRatio * 100).toFixed(1)}%), M15 confirmed Bearish drop`
            };
          }
        }
      }
    }
  }

  return null;
}
