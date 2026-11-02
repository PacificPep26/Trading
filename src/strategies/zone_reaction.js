/**
 * ZONE_REACTION.JS
 * Chiến lược SMC Đón Đầu Tại Vùng Cản Lớn (Tier 2 Major Levels & Volume Profile VAH/VAL)
 * Vào lệnh theo xác nhận nến M15 + VSA Climax Absorption.
 */

import { analyzeCandle, calculateVolumeProfile, findBreakerBlocks } from '../indicators.js';
import { calculatePositionSize } from './sizing.js';

const TP_BUFFER_RATE = 0.0025; // Trừ hao 0.25% trước cản đối diện

export function tryZoneReactionSetup({
  symbol,
  candlesH4,
  candlesM15,
  currentM15,
  prevM15,
  supports,
  resistances,
  liquidityTiers,
  ema34,
  atrH1,
  marketPhase,
  d1Phase,
  isBullTrend,
  isBearTrend,
  btcShield,
  config,
  volAbsorptionH4,
  volAbsorptionM15
}) {
  const isLeader = symbol.includes('BTC') || symbol.includes('ETH');
  const m15Anatomy = analyzeCandle(currentM15);
  const curPrice = currentM15.close;

  const majorResistances = [];
  if (liquidityTiers.tier2MajorHigh && liquidityTiers.tier2MajorHigh > curPrice) {
    majorResistances.push(liquidityTiers.tier2MajorHigh);
  }

  const majorSupports = [];
  if (liquidityTiers.tier2MajorLow && liquidityTiers.tier2MajorLow < curPrice) {
    majorSupports.push(liquidityTiers.tier2MajorLow);
  }

  // Volume Profile VAH / VAL
  if (config.useVolumeProfile) {
    const shouldAddVP = config.volumeProfileMode === 'ALWAYS' || d1Phase === 'RANGING';
    if (shouldAddVP) {
      const lookback = config.volumeProfileLookback || 50;
      const numBins = config.volumeProfileNumBins || 24;
      const vaPct = config.volumeProfileValueAreaPct !== undefined ? config.volumeProfileValueAreaPct : 0.70;
      const vp = calculateVolumeProfile(candlesH4, lookback, numBins, vaPct);
      if (vp && vp.vah && vp.vah > curPrice) majorResistances.push(vp.vah);
      if (vp && vp.val && vp.val < curPrice) majorSupports.push(vp.val);
    }
  }

  // Breaker Blocks
  if (config.useBreakerBlocks) {
    const pL = config.breakerPivotL || 2;
    const pR = config.breakerPivotR || 2;
    const breakerZones = findBreakerBlocks(candlesH4, pL, pR).filter(b => !b.isMitigated);
    if (config.breakerBlockMode === 'ADD_ZONES') {
      for (const b of breakerZones) {
        if (b.type === 'BEARISH' && b.top > curPrice) majorResistances.push(b.top);
        if (b.type === 'BULLISH' && b.bottom < curPrice) majorSupports.push(b.bottom);
      }
    } else {
      const inBreakerZone = (price, type) => breakerZones.some(b => b.type === type && price >= b.bottom && price <= b.top);
      for (let i = majorResistances.length - 1; i >= 0; i--) {
        if (!inBreakerZone(majorResistances[i], 'BEARISH')) majorResistances.splice(i, 1);
      }
      for (let i = majorSupports.length - 1; i >= 0; i--) {
        if (!inBreakerZone(majorSupports[i], 'BULLISH')) majorSupports.splice(i, 1);
      }
    }
  }

  // 1. Zone Reaction Short tại Vùng Kháng cự Lớn
  if (marketPhase !== 'STRONG_UPTREND' && d1Phase !== 'STRONG_UPTREND') {
    for (const res of majorResistances) {
      const testedRes = currentM15.high >= (res * 0.998) || prevM15.high >= (res * 0.998);
      if (testedRes) {
        const hasVsaRejection = (volAbsorptionM15.isAbsorption && volAbsorptionM15.type === 'BEARISH') ||
          (volAbsorptionH4.isAbsorption && volAbsorptionH4.type === 'BEARISH') ||
          (isLeader && m15Anatomy.upperWickRatio >= 0.45);
        const isM15Reversal = currentM15.close < currentM15.open && currentM15.close < prevM15.low;

        if (hasVsaRejection && isM15Reversal) {
          if (isBullTrend) {
            const distAboveEma34 = (curPrice - ema34) / ema34;
            if (distAboveEma34 < 0.020 && !(volAbsorptionM15.isAbsorption && volAbsorptionM15.type === 'BEARISH')) continue;
          }

          const entry = currentM15.close;
          const stopLoss = Math.max(currentM15.high, prevM15.high) + (config.atrBufferMultiplier * atrH1);
          const riskPerUnit = stopLoss - entry;
          if (riskPerUnit <= 0) continue;

          const slDistanceRate = riskPerUnit / entry;
          if (config.maxSlDistanceRate && slDistanceRate > config.maxSlDistanceRate) {
            continue;
          }

          const targetSup = supports.find(s => (entry - s * (1 + TP_BUFFER_RATE)) / riskPerUnit >= (config.minRR || 2.0));

          if (targetSup) {
            const takeProfit = targetSup * (1 + TP_BUFFER_RATE);
            const rr = (entry - takeProfit) / riskPerUnit;

            if (!btcShield.canShort) {
              return { isBlocked: true, blockReason: btcShield.reason, symbol, direction: 'SHORT' };
            }

            const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);
            const vsaNote = (volAbsorptionM15.isAbsorption && volAbsorptionM15.type === 'BEARISH') ? ` | VSA M15: ${volAbsorptionM15.details}` : '';
            return {
              strategy: 'SMC_ZONE_REACTION_SHORT',
              direction: 'SHORT',
              symbol,
              entry,
              stopLoss,
              takeProfit,
              targetSupport: targetSup,
              riskReward: parseFloat(rr.toFixed(2)),
              triggerTime: currentM15.ts,
              sizing,
              reason: `SMC_ZONE_REACTION_SHORT: Đón đầu tại Cản ${res} (M15 Râu trên ${(m15Anatomy.upperWickRatio * 100).toFixed(1)}%), TP trước Cản ${targetSup}${vsaNote}`
            };
          }
        }
      }
    }
  }

  // 2. Zone Reaction Long tại Vùng Hỗ trợ Lớn
  if (marketPhase !== 'STRONG_DOWNTREND' && d1Phase !== 'STRONG_DOWNTREND') {
    for (const sup of majorSupports) {
      const testedSup = currentM15.low <= (sup * 1.002) || prevM15.low <= (sup * 1.002);
      if (testedSup) {
        const hasVsaRejection = (volAbsorptionM15.isAbsorption && volAbsorptionM15.type === 'BULLISH') ||
          (volAbsorptionH4.isAbsorption && volAbsorptionH4.type === 'BULLISH') ||
          (isLeader && m15Anatomy.lowerWickRatio >= 0.45);
        const isM15Reversal = currentM15.close > currentM15.open && currentM15.close > prevM15.high;

        if (hasVsaRejection && isM15Reversal) {
          const isAtMajorSupport = (liquidityTiers.tier2MajorLow && Math.abs(curPrice - liquidityTiers.tier2MajorLow) / curPrice <= 0.015) || m15Anatomy.lowerWickRatio >= 0.40;
          if (isBearTrend && !isAtMajorSupport) {
            const distBelowEma34 = (ema34 - curPrice) / curPrice;
            if (distBelowEma34 < 0.020 && !(volAbsorptionM15.isAbsorption && volAbsorptionM15.type === 'BULLISH')) continue;
          }

          const entry = currentM15.close;
          const stopLoss = Math.min(currentM15.low, prevM15.low) - (config.atrBufferMultiplier * atrH1);
          const riskPerUnit = entry - stopLoss;
          if (riskPerUnit <= 0) continue;

          const slDistanceRate = riskPerUnit / entry;
          if (config.maxSlDistanceRate && slDistanceRate > config.maxSlDistanceRate) {
            continue;
          }

          const targetRes = resistances.find(r => (r * (1 - TP_BUFFER_RATE) - entry) / riskPerUnit >= (config.minRR || 2.0));

          if (targetRes) {
            const takeProfit = targetRes * (1 - TP_BUFFER_RATE);
            const rr = (takeProfit - entry) / riskPerUnit;

            if (!btcShield.canLong) {
              return { isBlocked: true, blockReason: btcShield.reason, symbol, direction: 'LONG' };
            }

            const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);
            const vsaNote = (volAbsorptionM15.isAbsorption && volAbsorptionM15.type === 'BULLISH') ? ` | VSA M15: ${volAbsorptionM15.details}` : '';
            return {
              strategy: 'SMC_ZONE_REACTION_LONG',
              direction: 'LONG',
              symbol,
              entry,
              stopLoss,
              takeProfit,
              targetResistance: targetRes,
              riskReward: parseFloat(rr.toFixed(2)),
              triggerTime: currentM15.ts,
              sizing,
              reason: `SMC_ZONE_REACTION_LONG: Đón đầu tại Hỗ trợ ${sup} (M15 Râu dưới ${(m15Anatomy.lowerWickRatio * 100).toFixed(1)}%), TP trước Cản ${targetRes}${vsaNote}`
            };
          }
        }
      }
    }
  }

  return null;
}
