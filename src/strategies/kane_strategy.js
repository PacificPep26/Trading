/**
 * KANE_STRATEGY.JS
 * Chiến lược Trend-Following Dr. Kane VIP (Sonic R Fibonacci EMA 34 & 89) kết hợp Smart Money Liquidity.
 * 
 * SỬA CÁC LỖI TỬ HUYỆT:
 * 1. Chốt lời luôn trừ hao trước cản (tpBufferRate = 0.25%).
 * 2. Tôn trọng cản: Cấm vào lệnh nếu có Cản Lớn chắn ngang đường với khoảng cách < 1.2R.
 * 3. Đồng pha vĩ mô: Cấm Long bắt dao rơi khi D1/H4 đang Strong Downtrend.
 * 4. Cấm Short cản tàu khi D1/H4 đang Strong Uptrend.
 * 5. M15 Volume Gate: Khối lượng M15 phải >= 0.70x SMA10.
 */

import { calculatePositionSize } from './sizing.js';

const TP_BUFFER_RATE = 0.0025; // Trừ hao 0.25% trước cản đối diện

/**
 * Thử kích hoạt Kane Long Setup
 */
export function tryKaneLongSetup({
  symbol,
  candlesH4,
  candlesM15,
  currentM15,
  prevM15,
  lastH4,
  supports,
  resistances,
  liquidityTiers,
  ema34,
  atrH1,
  h4Anatomy,
  marketPhase,
  d1Phase,
  isBullTrend,
  isLowVolD1,
  isActiveDownMove,
  hasBullishPattern,
  btcShield,
  config,
  volAbsorptionH4,
  volAbsorptionM15,
  chopBlockedSignal,
  isFreshH4
}) {
  if (chopBlockedSignal) return null;
  if (!isFreshH4) return null;

  // BỘ LỌC CẢN TÀU VĨ MÔ (MACRO TREND ALIGNMENT):
  // Cấm tuyệt đối Long khi thị trường đang rơi tự do ở D1 hoặc H4
  if (marketPhase === 'STRONG_DOWNTREND' || isActiveDownMove || d1Phase === 'STRONG_DOWNTREND') {
    return null;
  }

  for (const sup of supports) {
    if (lastH4.low < sup) {
      // SMC Inducement Filter: Bỏ qua nếu đang nén tại cản con chưa quét
      if (liquidityTiers.isInducementTrapRisk && liquidityTiers.sweepState === 'INDUCEMENT_TRAP_LOW') {
        const isNearInducement = liquidityTiers.tier1Lows.some(tl => Math.abs(sup - tl.avgPrice) / sup <= 0.01);
        if (isNearInducement && h4Anatomy.lowerWickRatio < 0.45) {
          continue;
        }
      }

      const isStrongSweep = h4Anatomy.lowerWickRatio >= 0.45;
      const isNormalSweep = h4Anatomy.lowerWickRatio >= (config.wickRatioThreshold || 0.35) && lastH4.close >= sup * 0.998;
      const prevH4 = candlesH4[candlesH4.length - 2];
      const isEngulfing = prevH4 && lastH4.close > lastH4.open && lastH4.close >= prevH4.open;
      const isSmcSweepLong = liquidityTiers.sweepState === 'BULLISH_SWEEP_CONFIRMED';
      const isMinorBarSweep = liquidityTiers.details?.levelType === 'PREVIOUS_BAR_LOW_SWEEP';

      // Nếu chỉ là quét 1 nến con mà lại đang Bear Trend -> CẤM Long
      if (isMinorBarSweep && !isBullTrend) {
        continue;
      }

      let canLong = false;

      if (isBullTrend) {
        if (isLowVolD1) {
          canLong = false;
        } else {
          canLong = isNormalSweep || isEngulfing || isSmcSweepLong;
        }
      } else {
        // Bear Trend: chỉ Long khi SMC Sweep xác nhận. Thêm điều kiện (cách EMA34 >= 2.5%, ở cản Tier-2)
        // từng làm backtest 1 năm tụt từ ~120 lệnh xuống 2 lệnh -> không dùng.
        canLong = isSmcSweepLong;
      }

      if (canLong) {
        const isM15Green = currentM15.close > currentM15.open;
        const isM15Breakout = currentM15.close > prevM15.high;
        const m15VolAvg = candlesM15.length >= 10 ? (candlesM15.slice(-10).reduce((s, c) => s + c.vol, 0) / 10) : 0;
        const hasM15VolLife = m15VolAvg > 0 ? (currentM15.vol >= m15VolAvg * 0.70) : true;

        if (isM15Green && isM15Breakout && hasBullishPattern && hasM15VolLife) {
          const entry = currentM15.close;

          // Chống Long đuổi đỉnh
          const h4Mid = (lastH4.high + lastH4.low) / 2;
          const recentM15Slice = candlesM15.slice(-8);
          const recentLowM15 = Math.min(...recentM15Slice.map(c => c.low));
          const hasValidLongPullback = entry <= (h4Mid * 1.002) || recentLowM15 <= (h4Mid * 1.002);
          if (!hasValidLongPullback) {
            continue;
          }

          // Đối xứng với Short: Long ngay sát Cản Lớn phía trên thì không còn chỗ chạy
          const majorHigh = liquidityTiers.tier2MajorHigh;
          if (majorHigh && entry >= majorHigh * 0.992) {
            continue;
          }

          const stopLoss = lastH4.low - (config.atrBufferMultiplier * atrH1);
          const riskPerUnit = entry - stopLoss;
          if (riskPerUnit <= 0) continue;

          const slDistanceRate = riskPerUnit / entry;
          if (config.maxSlDistanceRate && slDistanceRate > config.maxSlDistanceRate) {
            continue;
          }

          // TÌM CẢN KHÁNG CỰ ĐẠT minRR (ĐÃ TRỪ HAO TRƯỚC CẢN 0.25%)
          const targetRes = resistances.find(r => (r * (1 - TP_BUFFER_RATE) - entry) / riskPerUnit >= (config.minRR || 2.0));

          if (targetRes) {
            const takeProfit = targetRes * (1 - TP_BUFFER_RATE);
            const rr = (takeProfit - entry) / riskPerUnit;

            if (!btcShield.canLong) {
              return { isBlocked: true, blockReason: btcShield.reason, symbol, direction: 'LONG' };
            }

            const stratName = isSmcSweepLong ? 'SMC_SWEEP_REVERSAL_LONG' : 'KANE_THUAN_TREND_LONG';
            const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);
            const vsaNote = (volAbsorptionH4.isAbsorption && volAbsorptionH4.type === 'BULLISH') 
              ? ` | VSA: ${volAbsorptionH4.details}` 
              : ((volAbsorptionM15.isAbsorption && volAbsorptionM15.type === 'BULLISH') ? ` | VSA: ${volAbsorptionM15.details}` : '');

            return {
              strategy: stratName,
              direction: 'LONG',
              symbol,
              entry,
              stopLoss,
              takeProfit,
              targetResistance: targetRes,
              riskReward: parseFloat(rr.toFixed(2)),
              triggerTime: currentM15.ts,
              sizing,
              reason: `${stratName}: H4 swept Support ${sup} (Râu ${(h4Anatomy.lowerWickRatio * 100).toFixed(1)}%), TP đặt trước Cản ${targetRes} (RR ${rr.toFixed(2)})${vsaNote}`
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Thử kích hoạt Kane Short Setup
 */
export function tryKaneShortSetup({
  symbol,
  candlesH4,
  candlesM15,
  currentM15,
  prevM15,
  lastH4,
  supports,
  resistances,
  liquidityTiers,
  ema34,
  atrH1,
  h4Anatomy,
  marketPhase,
  d1Phase,
  isBearTrend,
  isLowVolD1,
  isActiveUpMove,
  hasBearishPattern,
  btcShield,
  config,
  volAbsorptionH4,
  volAbsorptionM15,
  chopBlockedSignal,
  isFreshH4
}) {
  if (chopBlockedSignal) return null;
  if (!isFreshH4) return null;

  // BỘ LỌC CẢN TÀU VĨ MÔ:
  // Cấm tuyệt đối Short khi thị trường đang bơm dốc đứng ở D1 hoặc H4
  if (marketPhase === 'STRONG_UPTREND' || isActiveUpMove || d1Phase === 'STRONG_UPTREND') {
    return null;
  }

  for (const res of resistances) {
    const testedRes = config.strictShortSweep ? lastH4.high > res : (Math.abs(lastH4.high - res) / res <= 0.008 || lastH4.high > res);
    if (testedRes) {
      if (liquidityTiers.isInducementTrapRisk && liquidityTiers.sweepState === 'INDUCEMENT_TRAP_HIGH') {
        const isNearInducement = liquidityTiers.tier1Highs.some(th => Math.abs(res - th.avgPrice) / res <= 0.01);
        if (isNearInducement && h4Anatomy.upperWickRatio < 0.45) {
          continue;
        }
      }

      const isStrongRejection = h4Anatomy.upperWickRatio >= 0.45;
      // Đối xứng với Long: râu trên đủ dài VÀ đóng cửa không vượt cản quá 0.2%
      const isNormalRejection = h4Anatomy.upperWickRatio >= (config.wickRatioThreshold || 0.35) && lastH4.close <= res * 1.002;
      const isSmcSweepShort = liquidityTiers.sweepState === 'BEARISH_SWEEP_CONFIRMED';
      const isMinorBarSweep = liquidityTiers.details?.levelType === 'PREVIOUS_BAR_HIGH_SWEEP';

      if (isMinorBarSweep && !isBearTrend) {
        continue;
      }

      let canShort = false;

      if (isBearTrend) {
        if (isLowVolD1) {
          canShort = false;
        } else {
          canShort = isNormalRejection || isSmcSweepShort;
        }
      } else {
        canShort = isSmcSweepShort;
      }

      if (canShort) {
        const isM15Red = currentM15.close < currentM15.open;
        const isM15Breakdown = currentM15.close < prevM15.low;
        const m15VolAvg = candlesM15.length >= 10 ? (candlesM15.slice(-10).reduce((s, c) => s + c.vol, 0) / 10) : 0;
        const hasM15VolLife = m15VolAvg > 0 ? (currentM15.vol >= m15VolAvg * 0.70) : true;

        if (isM15Red && isM15Breakdown && hasBearishPattern && hasM15VolLife) {
          const entry = currentM15.close;

          const h4Mid = (lastH4.high + lastH4.low) / 2;
          const recentM15Slice = candlesM15.slice(-8);
          const recentHighM15 = Math.max(...recentM15Slice.map(c => c.high));
          const hasValidShortPullback = entry >= (h4Mid * 0.998) || recentHighM15 >= (h4Mid * 0.998);
          if (!hasValidShortPullback) {
            continue;
          }

          const majorLow = liquidityTiers.tier2MajorLow;
          if (majorLow && entry <= majorLow * 1.008) {
            continue;
          }

          const stopLoss = lastH4.high + (config.atrBufferMultiplier * atrH1);
          const riskPerUnit = stopLoss - entry;
          if (riskPerUnit <= 0) continue;

          const slDistanceRate = riskPerUnit / entry;
          if (config.maxSlDistanceRate && slDistanceRate > config.maxSlDistanceRate) {
            continue;
          }

          // TÌM CẢN HỖ TRỢ ĐẠT minRR (ĐÃ TRỪ HAO TRƯỚC CẢN 0.25%)
          const targetSup = supports.find(s => (entry - s * (1 + TP_BUFFER_RATE)) / riskPerUnit >= (config.minRR || 2.0));

          if (targetSup) {
            const takeProfit = targetSup * (1 + TP_BUFFER_RATE);
            const rr = (entry - takeProfit) / riskPerUnit;

            if (!btcShield.canShort) {
              return { isBlocked: true, blockReason: btcShield.reason, symbol, direction: 'SHORT' };
            }

            const stratName = isSmcSweepShort ? 'SMC_SWEEP_REVERSAL_SHORT' : 'KANE_THUAN_TREND_SHORT';
            const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);
            const vsaNote = (volAbsorptionH4.isAbsorption && volAbsorptionH4.type === 'BEARISH') 
              ? ` | VSA: ${volAbsorptionH4.details}` 
              : ((volAbsorptionM15.isAbsorption && volAbsorptionM15.type === 'BEARISH') ? ` | VSA: ${volAbsorptionM15.details}` : '');

            return {
              strategy: stratName,
              direction: 'SHORT',
              symbol,
              entry,
              stopLoss,
              takeProfit,
              targetSupport: targetSup,
              riskReward: parseFloat(rr.toFixed(2)),
              triggerTime: currentM15.ts,
              sizing,
              reason: `${stratName}: H4 tested Res ${res} (Râu trên ${(h4Anatomy.upperWickRatio * 100).toFixed(1)}%), TP đặt trước Cản ${targetSup} (RR ${rr.toFixed(2)})${vsaNote}`
            };
          }
        }
      }
    }
  }

  return null;
}
