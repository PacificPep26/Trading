/**
 * ENGINE.JS
 * Lõi phân tích chiến lược định lượng (Pure Functions 100%).
 * Không gọi mạng, không đọc file, không lưu state toàn cục.
 * Đảm bảo tính toán đồng nhất 100% giữa môi trường Backtest và Live Runtime.
 */

import {
  calculateEMA,
  calculateATR,
  analyzeCandle,
  isMarubozu,
  findFractalPivots,
  getNearestKeyLevels,
  detectSqueeze,
  findFairValueGaps
} from './indicators.js';

/**
 * Cấu hình mặc định
 */
export const DEFAULT_CONFIG = {
  riskUsd: 10.0,
  leverage: 10,
  feeRate: 0.0008,          // 0.08% Taker roundtrip
  minRR: 2.0,
  beTriggerR: 1.5,
  beBufferRate: 0.0008,     // Đệm phí hòa vốn (0.08%)
  timeStopBars: 16,         // 16 nến M15 (4 tiếng)
  wickRatioThreshold: 0.35, // Râu quét >= 35% biên độ nến
  atrBufferMultiplier: 0.25 // 0.25 * ATR_H1
};

/**
 * Kiểm tra Khiên bảo vệ BTC Macro 1H
 * - Cấm mở Long Altcoin nếu nến BTC 1H vừa đóng là Marubozu Đỏ xả mạnh
 * - Cấm mở Short Altcoin nếu nến BTC 1H vừa đóng là Marubozu Xanh đẩy mạnh
 * @param {Array<{open: number, high: number, low: number, close: number}>} btcH1Candles
 * @returns {{canLong: boolean, canShort: boolean, reason: string|null}}
 */
export function checkBtcMacroShield(btcH1Candles) {
  if (!btcH1Candles || btcH1Candles.length < 15) {
    return { canLong: true, canShort: true, reason: null };
  }

  const atrs = calculateATR(btcH1Candles, 14);
  const lastIdx = btcH1Candles.length - 1;
  const lastCandle = btcH1Candles[lastIdx];
  const lastAtr = atrs[lastIdx];

  if (!lastAtr) {
    return { canLong: true, canShort: true, reason: null };
  }

  const { isBullishMarubozu, isBearishMarubozu } = isMarubozu(lastCandle, lastAtr, 0.8, 0.65);

  if (isBearishMarubozu) {
    return {
      canLong: false,
      canShort: true,
      reason: 'BTC_1H_BEARISH_MARUBOZU_DUMP'
    };
  }

  if (isBullishMarubozu) {
    return {
      canLong: true,
      canShort: false,
      reason: 'BTC_1H_BULLISH_MARUBOZU_PUMP'
    };
  }

  return { canLong: true, canShort: true, reason: null };
}

/**
 * Tính toán Position Sizing chuẩn 1R
 * @param {number} entry 
 * @param {number} stopLoss 
 * @param {number} riskUsd 
 * @param {number} leverage 
 * @returns {{size: number, notional: number, margin: number, riskPerUnit: number}}
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
 * CHIẾN LƯỢC 1: Quét Thanh Khoản Cản H4 (Liquidity Sweep & Reversal)
 * @param {object} params
 * @returns {object|null}
 */
export function evaluateLiquiditySweep({ symbol, candlesH4, candlesH1, candlesM15, config = DEFAULT_CONFIG }) {
  if (!candlesH4 || candlesH4.length < 15 || !candlesH1 || candlesH1.length < 15 || !candlesM15 || candlesM15.length < 5) {
    return null;
  }

  const atrsH1 = calculateATR(candlesH1, 14);
  const atrH1 = atrsH1[atrsH1.length - 1];
  if (!atrH1) return null;

  const currentPrice = candlesM15[candlesM15.length - 1].close;
  const lastM15 = candlesM15[candlesM15.length - 1];
  const prevM15 = candlesM15[candlesM15.length - 2];

  // Lấy các nến H4 đã đóng để tìm cản cấu trúc
  const h4Lookback = candlesH4.slice(0, -1);
  const { allResistances, allSupports } = getNearestKeyLevels(h4Lookback, currentPrice, 2, 2);

  // Xem xét nến H4 vừa đóng (nến quét thanh khoản)
  const sweepH4 = candlesH4[candlesH4.length - 1];
  const prevH4 = candlesH4.length >= 2 ? candlesH4[candlesH4.length - 2] : null;
  const sweepAnatomy = analyzeCandle(sweepH4);

  // ----------------------------------------------------
  // KÈO LONG: Quét Hỗ trợ H4 rút chân hoặc đảo chiều chữ V
  // ----------------------------------------------------
  for (const support of allSupports) {
    // Điều kiện 1: Nến H4 thọc thủng hỗ trợ
    const sweptBelow = sweepH4.low < support;
    if (!sweptBelow) continue;

    // Điều kiện 2: Rút chân râu dưới >= 35% hoặc Đóng nến chữ V nuốt lại cản (Engulfing)
    const isWickReversal = sweepAnatomy.lowerWickRatio >= config.wickRatioThreshold && sweepH4.close >= support * 0.998;
    const isEngulfingAbsorption = prevH4 && sweepH4.close > sweepH4.open && sweepH4.close >= prevH4.open;

    if (isWickReversal || isEngulfingAbsorption) {
      // Điều kiện 3: Nến M15 vừa đóng nến xanh vượt đỉnh nến trước xác nhận lực mua
      const isM15Green = lastM15.close > lastM15.open;
      const isM15Breakout = lastM15.close > prevM15.high;

      if (isM15Green && isM15Breakout) {
        const entry = lastM15.close;
        const stopLoss = sweepH4.low - (config.atrBufferMultiplier * atrH1);
        
        // Tìm Kháng cự đối diện để làm Take Profit
        const targetResistances = allResistances.filter(r => r > entry);
        if (targetResistances.length === 0) continue;

        // Chọn TP gần nhất đạt R:R >= minRR
        let takeProfit = null;
        let finalRR = 0;
        const riskDistance = entry - stopLoss;

        for (const res of targetResistances) {
          const rewardDistance = res - entry;
          const rr = rewardDistance / riskDistance;
          if (rr >= config.minRR) {
            takeProfit = res;
            finalRR = rr;
            break;
          }
        }

        if (takeProfit && finalRR >= config.minRR) {
          const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);
          return {
            strategy: 'STRATEGY_1_LIQUIDITY_SWEEP',
            direction: 'LONG',
            symbol,
            entry,
            stopLoss,
            takeProfit,
            riskReward: parseFloat(finalRR.toFixed(2)),
            triggerTime: lastM15.ts,
            keyLevel: support,
            targetLevel: takeProfit,
            sizing,
            reason: `H4 swept Support ${support} (Wick ${(sweepAnatomy.lowerWickRatio * 100).toFixed(1)}%), M15 confirmed Bullish push`,
            metadata: {
              sweepLow: sweepH4.low,
              atrH1,
              lowerWickRatio: sweepAnatomy.lowerWickRatio
            }
          };
        }
      }
    }
  }

  // ----------------------------------------------------
  // KÈO SHORT: Quét Kháng cự H4 rút râu trên hoặc đảo chiều
  // ----------------------------------------------------
  for (const resistance of allResistances) {
    const sweptAbove = sweepH4.high > resistance;
    if (!sweptAbove) continue;

    const isWickRejection = sweepAnatomy.upperWickRatio >= config.wickRatioThreshold && sweepH4.close <= resistance * 1.002;
    const isBearishAbsorption = prevH4 && sweepH4.close < sweepH4.open && sweepH4.close <= prevH4.open;

    if (isWickRejection || isBearishAbsorption) {
      // Nến M15 đóng nến đỏ gãy đáy nến trước
      const isM15Red = lastM15.close < lastM15.open;
      const isM15Breakdown = lastM15.close < prevM15.low;

      if (isM15Red && isM15Breakdown) {
        const entry = lastM15.close;
        const stopLoss = sweepH4.high + (config.atrBufferMultiplier * atrH1);

        const targetSupports = allSupports.filter(s => s < entry);
        if (targetSupports.length === 0) continue;

        let takeProfit = null;
        let finalRR = 0;
        const riskDistance = stopLoss - entry;

        for (const sup of targetSupports) {
          const rewardDistance = entry - sup;
          const rr = rewardDistance / riskDistance;
          if (rr >= config.minRR) {
            takeProfit = sup;
            finalRR = rr;
            break;
          }
        }

        if (takeProfit && finalRR >= config.minRR) {
          const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);
          return {
            strategy: 'STRATEGY_1_LIQUIDITY_SWEEP',
            direction: 'SHORT',
            symbol,
            entry,
            stopLoss,
            takeProfit,
            riskReward: parseFloat(finalRR.toFixed(2)),
            triggerTime: lastM15.ts,
            keyLevel: resistance,
            targetLevel: takeProfit,
            sizing,
            reason: `H4 swept Resistance ${resistance} (Upper Wick ${(sweepAnatomy.upperWickRatio * 100).toFixed(1)}%), M15 confirmed Bearish drop`,
            metadata: {
              sweepHigh: sweepH4.high,
              atrH1,
              upperWickRatio: sweepAnatomy.upperWickRatio
            }
          };
        }
      }
    }
  }

  return null;
}

/**
 * CHIẾN LƯỢC 2: Short Hồi Về Cản Theo Xu Hướng Giảm H4 (Trend Pullback Short)
 * @param {object} params
 * @returns {object|null}
 */
export function evaluateTrendPullbackShort({ symbol, candlesH4, candlesH1, candlesM15, config = DEFAULT_CONFIG }) {
  if (!candlesH4 || candlesH4.length < 25 || !candlesH1 || candlesH1.length < 15 || !candlesM15 || candlesM15.length < 5) {
    return null;
  }

  const closesH4 = candlesH4.map(c => c.close);
  const emasH4 = calculateEMA(closesH4, 20);
  const currentEma20 = emasH4[emasH4.length - 1];
  if (!currentEma20) return null;

  const lastH4 = candlesH4[candlesH4.length - 1];
  // Xu hướng giảm: Giá H4 nằm dưới EMA20
  if (lastH4.close >= currentEma20) return null;

  const currentPrice = candlesM15[candlesM15.length - 1].close;
  const { allResistances, allSupports } = getNearestKeyLevels(candlesH4, currentPrice, 2, 2);

  // Kiểm tra nến H4 có nhịp hồi chạm Kháng cự hoặc tiệm cận EMA20
  const isNearEma = Math.abs(lastH4.high - currentEma20) / currentEma20 <= 0.008;
  const hitResistance = allResistances.some(r => Math.abs(lastH4.high - r) / r <= 0.004);

  if (!isNearEma && !hitResistance) return null;

  // Xác nhận M15: Nến đỏ gãy đáy
  const lastM15 = candlesM15[candlesM15.length - 1];
  const prevM15 = candlesM15[candlesM15.length - 2];
  if (!(lastM15.close < lastM15.open && lastM15.close < prevM15.low)) return null;

  const atrsH1 = calculateATR(candlesH1, 14);
  const atrH1 = atrsH1[atrsH1.length - 1] || (currentPrice * 0.005);

  const entry = lastM15.close;
  const stopLoss = Math.max(lastH4.high, currentEma20) + (config.atrBufferMultiplier * atrH1);

  // Target Hỗ trợ đáy mỏ thanh khoản
  const targetSupports = allSupports.filter(s => s < entry);
  if (targetSupports.length === 0) return null;

  let takeProfit = null;
  let finalRR = 0;
  const riskDist = stopLoss - entry;

  for (const sup of targetSupports) {
    const rr = (entry - sup) / riskDist;
    if (rr >= config.minRR) {
      takeProfit = sup;
      finalRR = rr;
      break;
    }
  }

  if (!takeProfit || finalRR < config.minRR) return null;

  const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);

  return {
    strategy: 'STRATEGY_2_TREND_PULLBACK_SHORT',
    direction: 'SHORT',
    symbol,
    entry,
    stopLoss,
    takeProfit,
    riskReward: parseFloat(finalRR.toFixed(2)),
    triggerTime: lastM15.ts,
    keyLevel: currentEma20,
    targetLevel: takeProfit,
    sizing,
    reason: `H4 downtrend below EMA20, pullback rejected at EMA20/Resistance, M15 confirmed drop`,
    metadata: {
      reversalFlipReady: true, // Cờ báo sẵn sàng bắt Long chữ V khi chạm đáy
      ema20: currentEma20
    }
  };
}

/**
 * CHIẾN LƯỢC 3: Nén Biên Độ Đón Sóng Bùng Nổ (Pre-Breakout Squeeze)
 * @param {object} params
 * @returns {object|null}
 */
export function evaluatePreBreakoutSqueeze({ symbol, candlesH4, candlesH1, candlesM15, config = DEFAULT_CONFIG }) {
  if (!candlesH4 || candlesH4.length < 25 || !candlesH1 || candlesH1.length < 15 || !candlesM15 || candlesM15.length < 5) {
    return null;
  }

  const squeeze = detectSqueeze(candlesH4, 0.70, 0.65);
  if (!squeeze.isSqueeze) return null;

  const closesH4 = candlesH4.map(c => c.close);
  const emasH4 = calculateEMA(closesH4, 20);
  const currentEma20 = emasH4[emasH4.length - 1];
  if (!currentEma20) return null;

  const atrsH1 = calculateATR(candlesH1, 14);
  const atrH1 = atrsH1[atrsH1.length - 1];
  if (!atrH1) return null;

  const lastM15 = candlesM15[candlesM15.length - 1];
  const prevM15 = candlesM15[candlesM15.length - 2];
  const entry = lastM15.close;

  // Lấy 3 nến H4 gần nhất
  const h4_1 = candlesH4[candlesH4.length - 1];
  const h4_2 = candlesH4[candlesH4.length - 2];
  const h4_3 = candlesH4[candlesH4.length - 3];

  // 1. Kèo LONG: Bám trên EMA20 H4, 3 đáy H4 nâng dần
  const isAboveEma = h4_1.close >= currentEma20 && h4_2.close >= currentEma20;
  const isHigherLows = h4_1.low >= h4_2.low && h4_2.low >= h4_3.low;
  const isM15BounceUp = lastM15.close > lastM15.open && lastM15.close > prevM15.high;

  if (isAboveEma && isHigherLows && isM15BounceUp) {
    const lowestLow = Math.min(h4_1.low, h4_2.low, h4_3.low);
    const stopLoss = lowestLow - (config.atrBufferMultiplier * atrH1);
    const riskDistance = entry - stopLoss;
    
    // Mục tiêu tối thiểu 2.5R cho setup nén biên độ
    const minTarget = entry + (2.5 * riskDistance);
    const { allResistances } = getNearestKeyLevels(candlesH4, entry, 2, 2);
    const targetResistance = allResistances.find(r => r >= minTarget) || minTarget;
    const finalRR = (targetResistance - entry) / riskDistance;

    const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);

    return {
      strategy: 'STRATEGY_3_PRE_BREAKOUT_SQUEEZE',
      direction: 'LONG',
      symbol,
      entry,
      stopLoss,
      takeProfit: targetResistance,
      riskReward: parseFloat(finalRR.toFixed(2)),
      triggerTime: lastM15.ts,
      keyLevel: currentEma20,
      targetLevel: targetResistance,
      sizing,
      reason: `H4 Squeeze (ATR ratio ${squeeze.atrRatio.toFixed(2)}, Vol ratio ${squeeze.volRatio.toFixed(2)}), 3 higher lows on EMA20`,
      metadata: {
        squeezeDetails: squeeze
      }
    };
  }

  // 2. Kèo SHORT: Bị đè dưới EMA20 H4, 3 đỉnh H4 thấp dần
  const isBelowEma = h4_1.close <= currentEma20 && h4_2.close <= currentEma20;
  const isLowerHighs = h4_1.high <= h4_2.high && h4_2.high <= h4_3.high;
  const isM15Drop = lastM15.close < lastM15.open && lastM15.close < prevM15.low;

  if (isBelowEma && isLowerHighs && isM15Drop) {
    const highestHigh = Math.max(h4_1.high, h4_2.high, h4_3.high);
    const stopLoss = highestHigh + (config.atrBufferMultiplier * atrH1);
    const riskDistance = stopLoss - entry;

    const minTarget = entry - (2.5 * riskDistance);
    const { allSupports } = getNearestKeyLevels(candlesH4, entry, 2, 2);
    const targetSupport = allSupports.find(s => s <= minTarget) || minTarget;
    const finalRR = (entry - targetSupport) / riskDistance;

    const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);

    return {
      strategy: 'STRATEGY_3_PRE_BREAKOUT_SQUEEZE',
      direction: 'SHORT',
      symbol,
      entry,
      stopLoss,
      takeProfit: targetSupport,
      riskReward: parseFloat(finalRR.toFixed(2)),
      triggerTime: lastM15.ts,
      keyLevel: currentEma20,
      targetLevel: targetSupport,
      sizing,
      reason: `H4 Squeeze (ATR ratio ${squeeze.atrRatio.toFixed(2)}, Vol ratio ${squeeze.volRatio.toFixed(2)}), 3 lower highs below EMA20`,
      metadata: {
        squeezeDetails: squeeze
      }
    };
  }

  return null;
}

/**
 * Hàm đánh giá thị trường tổng hợp (Master Evaluator)
 * Chạy đồng thời 3 chiến lược và lọc qua Khiên BTC Macro 1H
 * @param {object} params
 * @returns {object|null}
 */
export function evaluateMarket({ symbol, candlesH4, candlesH1, candlesM15, btcH1Candles = null, config = DEFAULT_CONFIG }) {
  // 1. Kiểm tra Khiên BTC Macro 1H
  const btcShield = checkBtcMacroShield(btcH1Candles);

  // 2. Chạy lần lượt 3 chiến lược theo thứ tự ưu tiên
  // Ưu tiên 1: Quét thanh khoản đảo chiều cản H4
  const sweepSignal = evaluateLiquiditySweep({ symbol, candlesH4, candlesH1, candlesM15, config });
  if (sweepSignal) {
    if (sweepSignal.direction === 'LONG' && !btcShield.canLong) {
      return { ...sweepSignal, isBlocked: true, blockReason: btcShield.reason };
    }
    if (sweepSignal.direction === 'SHORT' && !btcShield.canShort) {
      return { ...sweepSignal, isBlocked: true, blockReason: btcShield.reason };
    }
    return sweepSignal;
  }

  // Ưu tiên 2: Short hồi theo xu hướng giảm H4
  const pullbackSignal = evaluateTrendPullbackShort({ symbol, candlesH4, candlesH1, candlesM15, config });
  if (pullbackSignal) {
    if (pullbackSignal.direction === 'SHORT' && !btcShield.canShort) {
      return { ...pullbackSignal, isBlocked: true, blockReason: btcShield.reason };
    }
    return pullbackSignal;
  }

  // Ưu tiên 3: Nén biên độ Squeeze bùng nổ H4
  const squeezeSignal = evaluatePreBreakoutSqueeze({ symbol, candlesH4, candlesH1, candlesM15, config });
  if (squeezeSignal) {
    if (squeezeSignal.direction === 'LONG' && !btcShield.canLong) {
      return { ...squeezeSignal, isBlocked: true, blockReason: btcShield.reason };
    }
    if (squeezeSignal.direction === 'SHORT' && !btcShield.canShort) {
      return { ...squeezeSignal, isBlocked: true, blockReason: btcShield.reason };
    }
    return squeezeSignal;
  }

  return null;
}

