/**
 * ENGINE.JS
 * Lõi phân tích chiến lược định lượng Smart Money / Demand-Supply & Liquidity.
 * Hiện thực hóa 100% công thức VIP của Dr. Kane (Sonic R Fibonacci EMAs 34 & 89)
 * kết hợp SMC Quét Thanh Khoản & Phục Kích Đón Đầu (Zone Reaction).
 * 
 * BẢO ĐẢM TÍNH TỰ ĐỊNH (PURE FUNCTIONS 100%) & CHỐNG LOOK-AHEAD BIAS.
 */

import {
  calculateEMA,
  calculateATR,
  calculateSMA,
  analyzeCandle,
  isMarubozu,
  findFractalPivots,
  findFairValueGaps,
  classifyLiquidityTiers,
  detectVolumeAbsorption,
  detectCandlePattern,
  findBreakerBlocks
} from './indicators.js';

import { BOT_CONFIG, DEFAULT_CONFIG } from './config.js';
import { detectMarketPhase, analyzeD1Macro, checkChopSleepMode, analyzeRecentMomentum, computeH4Freshness, isInTradingSession, computeStructTrend } from './strategies/regime.js';
import { calculateSetupQualityScore } from './strategies/quality_scorer.js';
import { generateKeyLevelRadar } from './strategies/radar.js';
import { tryKaneLongSetup, tryKaneShortSetup } from './strategies/kane_strategy.js';
import { tryZoneReactionSetup } from './strategies/zone_reaction.js';
import { detectMacroRangeBox, evaluateMacroRangeFade, buildBoxAlert } from './strategies/macro_range.js';
import { evaluateVolumeBreakout } from './strategies/breakout_strategy.js';
import { evaluateWyckoffSpring, evaluateWyckoffBreakoutRetest } from './strategies/wyckoff_box.js';
import { evaluateTradeFlipOpportunity, registerTakeProfitHit } from './strategies/trade_flip.js';
import { calculatePositionSize } from './strategies/sizing.js';

export {
  BOT_CONFIG,
  DEFAULT_CONFIG,
  detectMarketPhase,
  calculateSetupQualityScore,
  generateKeyLevelRadar,
  detectMacroRangeBox,
  evaluateMacroRangeFade,
  buildBoxAlert,
  evaluateVolumeBreakout,
  evaluateTradeFlipOpportunity,
  registerTakeProfitHit,
  calculatePositionSize
};

const H4_MS = 4 * 60 * 60 * 1000;
const M15_MS = 15 * 60 * 1000;

/**
 * Bộ Chỉ Huy Đầu Tàu BTC (Locomotive Leader Engine)
 */
export function analyzeBtcLocomotive({ btcH4Candles = null, btcH1Candles = null }) {
  if (!btcH1Candles || btcH1Candles.length < 15) {
    return {
      canLongAlts: true,
      canShortAlts: true,
      phase: 'NEUTRAL',
      reason: null,
      hasBullishReversal: false,
      hasBearishRejection: false
    };
  }

  const atrsH1 = calculateATR(btcH1Candles, 14);
  const lastH1Idx = btcH1Candles.length - 1;
  const lastH1 = btcH1Candles[lastH1Idx];
  const lastAtrH1 = atrsH1[lastH1Idx] || (lastH1.close * 0.005);
  const { isBullishMarubozu, isBearishMarubozu } = isMarubozu(lastH1, lastAtrH1, 0.8, 0.65);

  let btcH4Phase = 'RANGING';
  if (btcH4Candles && btcH4Candles.length >= 35) {
    const closesH4 = btcH4Candles.map(c => c.close);
    const ema34Arr = calculateEMA(closesH4, 34);
    const ema89Arr = calculateEMA(closesH4, 89);
    btcH4Phase = detectMarketPhase(btcH4Candles, ema34Arr, ema89Arr);
  }

  const h1Anatomy = analyzeCandle(lastH1);
  const hasBullishReversal = h1Anatomy.lowerWickRatio >= 0.35 && lastH1.close > lastH1.open;
  const hasBearishRejection = h1Anatomy.upperWickRatio >= 0.35 && lastH1.close < lastH1.open;

  // 1. Đầu Tàu BTC Đang Lao Dốc -> Cấm Long Altcoins
  if (isBearishMarubozu || (btcH4Phase === 'STRONG_DOWNTREND' && !hasBullishReversal)) {
    return {
      canLongAlts: false,
      canShortAlts: true,
      phase: 'DUMPING_WATERFALL',
      reason: 'LOCOMOTIVE_BTC_DUMPING: Đầu tàu BTC đang rơi tự do, CẤM TUYỆT ĐỐI Long Altcoin!',
      hasBullishReversal: false,
      hasBearishRejection
    };
  }

  // 2. Đầu Tàu BTC Đang Bơm Dốc -> Cấm Short Altcoins
  if (isBullishMarubozu || (btcH4Phase === 'STRONG_UPTREND' && !hasBearishRejection)) {
    return {
      canLongAlts: true,
      canShortAlts: false,
      phase: 'PUMPING_PARABOLIC',
      reason: 'LOCOMOTIVE_BTC_PUMPING: Đầu tàu BTC đang bơm dốc đứng, CẤM TUYỆT ĐỐI Short Altcoin!',
      hasBullishReversal,
      hasBearishRejection: false
    };
  }

  return {
    canLongAlts: true,
    canShortAlts: true,
    phase: btcH4Phase,
    reason: null,
    hasBullishReversal,
    hasBearishRejection
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
  const lastH1Idx = btcH1Candles.length - 1;
  const lastH1 = btcH1Candles[lastH1Idx];
  const lastAtr = atrs[lastH1Idx] || (lastH1.close * 0.005);
  const { isBullishMarubozu, isBearishMarubozu } = isMarubozu(lastH1, lastAtr, 0.8, 0.65);

  if (isBearishMarubozu) {
    return {
      canLong: false,
      canShort: true,
      reason: 'BTC_MACRO_BEARISH_DUMP: BTC 1H vừa đóng nến Marubozu xả đỏ lực lớn, chặn mở Long Altcoin'
    };
  }
  if (isBullishMarubozu) {
    return {
      canLong: true,
      canShort: false,
      reason: 'BTC_MACRO_BULLISH_PUMP: BTC 1H vừa đóng nến Marubozu xanh bơm dốc đứng, chặn mở Short Altcoin'
    };
  }
  return { canLong: true, canShort: true, reason: null };
}

/**
 * Master Evaluator - Đánh giá Thị trường theo chuẩn công thức VIP Dr. Kane H4/M15 & SMC
 */
export function evaluateMarket({
  symbol,
  candlesH4,
  candlesH1,
  candlesM15,
  candlesD1 = null,
  candlesW1 = null,
  btcH1Candles = null,
  btcH4Candles = null,
  config = DEFAULT_CONFIG
}) {
  if (!candlesH4 || candlesH4.length < 90 || !candlesH1 || candlesH1.length < 15 || !candlesM15 || candlesM15.length < 5) {
    return null;
  }

  const currentM15 = candlesM15[candlesM15.length - 1];
  const prevM15 = candlesM15[candlesM15.length - 2];
  const curPrice = currentM15.close;

  // Lọc giá tối thiểu (< 1.0 USDT)
  if (config.minCoinPrice && curPrice < config.minCoinPrice) {
    return null;
  }

  if (!isInTradingSession(currentM15.ts, config.sessionStartHourUtc ?? 0, config.sessionEndHourUtc ?? 24)) {
    return null;
  }

  const lastH4 = candlesH4[candlesH4.length - 1];
  const isFreshH4 = computeH4Freshness(currentM15.ts + M15_MS, lastH4.ts + H4_MS, config.freshH4Bars ?? 8).isFresh;

  // 1. Chỉ báo Kane VIP: EMA 34 & EMA 89 trên H4
  const closesH4 = candlesH4.map(c => c.close);
  const ema34Arr = calculateEMA(closesH4, 34);
  const ema89Arr = calculateEMA(closesH4, 89);
  const ema34 = ema34Arr[ema34Arr.length - 1];
  const ema89 = ema89Arr[ema89Arr.length - 1];
  if (!ema34 || !ema89) return null;

  const marketPhase = detectMarketPhase(candlesH4, ema34Arr, ema89Arr);
  const { d1Phase, natrD1 } = analyzeD1Macro(candlesD1);

  const minD1NATR = config.minD1NATR !== undefined ? config.minD1NATR : 0.030;
  const isLowVolD1 = Boolean(config.enableDynamicNatr && natrD1 < minD1NATR);

  // Đà biến động gần
  const momentumLookbackBars = config.momentumLookbackBars || 6;
  const momentumThresholdPct = config.momentumThresholdPct || 4;
  const { isActiveDownMove, isActiveUpMove } = analyzeRecentMomentum(candlesH4, momentumLookbackBars, momentumThresholdPct);

  // Price Action Pattern M15
  let hasBullishPattern = true;
  let hasBearishPattern = true;
  if (config.requirePricePattern && candlesM15 && candlesM15.length >= 20) {
    const m15VolSma = calculateSMA(candlesM15.map(c => c.vol), 20);
    const curM15VolSma = m15VolSma[m15VolSma.length - 1];
    const hasM15VolumeConfirm = curM15VolSma ? currentM15.vol >= curM15VolSma : true;
    const m15Patterns = detectCandlePattern(candlesM15, candlesM15.length - 1);
    const bullishMatch = m15Patterns.some(p => ['BULLISH_ENGULFING', 'HAMMER', 'MORNING_STAR', 'PIERCING_LINE', 'THREE_WHITE_SOLDIERS', 'TWEEZER_BOTTOM'].includes(p));
    const bearishMatch = m15Patterns.some(p => ['BEARISH_ENGULFING', 'SHOOTING_STAR', 'EVENING_STAR', 'DARK_CLOUD_COVER', 'THREE_BLACK_CROWS', 'TWEEZER_TOP'].includes(p));
    hasBullishPattern = bullishMatch && hasM15VolumeConfirm;
    hasBearishPattern = bearishMatch && hasM15VolumeConfirm;
  }

  // Chop Sleep Mode
  const chopBlockedSignal = checkChopSleepMode(candlesH1, config, symbol);

  const isBullTrend = ema34 >= ema89;
  const isBearTrend = ema34 < ema89;

  // Lọc Fractal Key Levels H4
  const pivots = findFractalPivots(candlesH4, 2, 2);
  const resistances = pivots.filter(p => p.type === 'HIGH' && p.price > curPrice).map(p => p.price);
  const supports = pivots.filter(p => p.type === 'LOW' && p.price < curPrice).map(p => p.price);

  // prevH4 chỉ là nến liền kề con, không đưa vào danh sách cản chính để tránh nghẽn mục tiêu Take Profit

  const liquidityTiers = classifyLiquidityTiers(candlesH4, curPrice);

  if (liquidityTiers.tier2MajorHigh && liquidityTiers.tier2MajorHigh > curPrice && !resistances.some(r => Math.abs(r - liquidityTiers.tier2MajorHigh) / r < 0.003)) {
    resistances.push(liquidityTiers.tier2MajorHigh);
  }
  if (liquidityTiers.tier2MajorLow && liquidityTiers.tier2MajorLow < curPrice && !supports.some(s => Math.abs(s - liquidityTiers.tier2MajorLow) / s < 0.003)) {
    supports.push(liquidityTiers.tier2MajorLow);
  }

  // FVG H1
  if (candlesH1 && candlesH1.length >= 5) {
    const fvgsH1 = findFairValueGaps(candlesH1);
    fvgsH1.filter(f => f.type === 'BULLISH' && !f.isMitigated && f.top < curPrice)
      .forEach(f => { if (!supports.some(s => Math.abs(s - f.top) / s < 0.003)) supports.push(f.top); });
    fvgsH1.filter(f => f.type === 'BEARISH' && !f.isMitigated && f.bottom > curPrice)
      .forEach(f => { if (!resistances.some(r => Math.abs(r - f.bottom) / r < 0.003)) resistances.push(f.bottom); });
  }

  // Flip Levels
  if (config.useFlipLevels) {
    const pL = config.breakerPivotL || 2;
    const pR = config.breakerPivotR || 2;
    const flipZones = findBreakerBlocks(candlesH4, pL, pR).filter(b => !b.isMitigated);
    for (const b of flipZones) {
      if (b.type === 'BEARISH' && b.top > curPrice && !resistances.some(r => Math.abs(r - b.top) / r < 0.003)) {
        resistances.push(b.top);
      }
      if (b.type === 'BULLISH' && b.bottom < curPrice && !supports.some(s => Math.abs(s - b.bottom) / s < 0.003)) {
        supports.push(b.bottom);
      }
    }
  }

  // D1 Macro Key Levels
  if (config.useD1MacroLevels && candlesD1 && candlesD1.length >= 10) {
    const d1Pivots = findFractalPivots(candlesD1, 2, 2);
    const lowestH4Sup = supports.length > 0 ? Math.min(...supports) : Infinity;
    const highestH4Res = resistances.length > 0 ? Math.max(...resistances) : -Infinity;

    for (const p of d1Pivots) {
      if (p.type === 'HIGH' && p.price > curPrice) {
        const isEligible = config.d1MacroMode === 'OUT_OF_BOUNDS_ONLY' ? p.price > highestH4Res : true;
        if (isEligible && !resistances.some(r => Math.abs(r - p.price) / r < 0.003)) {
          resistances.push(p.price);
        }
      }
      if (p.type === 'LOW' && p.price < curPrice) {
        const isEligible = config.d1MacroMode === 'OUT_OF_BOUNDS_ONLY' ? p.price < lowestH4Sup : true;
        if (isEligible && !supports.some(s => Math.abs(s - p.price) / s < 0.003)) {
          supports.push(p.price);
        }
      }
    }
  }

  resistances.sort((a, b) => a - b); // Tăng dần (gần nhất lên đầu)
  supports.sort((a, b) => b - a);    // Giảm dần (gần nhất lên đầu)

  const atrsH1 = calculateATR(candlesH1, 14);
  const atrH1 = atrsH1[atrsH1.length - 1] || (curPrice * 0.005);
  const h4Anatomy = analyzeCandle(lastH4);

  const volAbsorptionH4 = detectVolumeAbsorption(candlesH4, candlesH4.length - 1);
  const volAbsorptionM15 = detectVolumeAbsorption(candlesM15, candlesM15.length - 1);

  // Đầu Tàu BTC
  const isAltcoin = !symbol.includes('BTC');
  const btcLoco = analyzeBtcLocomotive({ btcH4Candles, btcH1Candles });
  const btcShield = {
    canLong: isAltcoin ? btcLoco.canLongAlts : true,
    canShort: isAltcoin ? btcLoco.canShortAlts : true,
    reason: btcLoco.reason
  };

  const setupParams = {
    symbol,
    candlesH4,
    candlesH1,
    candlesM15,
    currentM15,
    prevM15,
    lastH4,
    supports,
    resistances,
    liquidityTiers,
    ema34,
    ema89,
    atrH1,
    h4Anatomy,
    marketPhase,
    d1Phase,
    isBullTrend,
    isBearTrend,
    isLowVolD1,
    isActiveDownMove,
    isActiveUpMove,
    hasBullishPattern,
    hasBearishPattern,
    btcShield,
    config: {
      ...config,
      isBullTrend,
      isBearTrend,
      marketPhase
    },
    volAbsorptionH4,
    volAbsorptionM15,
    chopBlockedSignal,
    isFreshH4
  };

  const formatFinalSignal = (sig) => {
    if (!sig || sig.isBlocked) return sig;
    if (config.enableTrendAlignFilter) {
      const trend = computeStructTrend(candlesH4.slice(-250));
      if ((sig.direction === 'LONG' && trend < 0) || (sig.direction === 'SHORT' && trend > 0)) {
        return { isBlocked: true, blockReason: `TREND_ALIGN: ${sig.direction} ngược cấu trúc BOS H4 (${trend > 0 ? 'tăng' : 'giảm'})`, symbol, direction: sig.direction };
      }
    }
    // Flip/MacroRange/Breakout không tự tính sizing và không biết khiên BTC -> áp tại đây
    const shieldOk = sig.direction === 'LONG' ? btcShield.canLong : btcShield.canShort;
    if (!shieldOk) {
      return { isBlocked: true, blockReason: btcShield.reason, symbol, direction: sig.direction };
    }
    const sizing = sig.sizing || calculatePositionSize(sig.entry, sig.stopLoss, config.riskUsd, config.leverage);
    if (sizing.isBlocked) {
      return { isBlocked: true, blockReason: sizing.blockReason, symbol, direction: sig.direction };
    }
    return {
      ...sig,
      sizing,
      marketPhase,
      d1Phase,
      natrD1: parseFloat((natrD1 * 100).toFixed(2)),
      isLowVolD1,
      customBeTriggerR: isLowVolD1 ? 1.0 : (config.beTriggerR || 1.2)
    };
  };

  // ==============================================================
  // 1. ƯU TIÊN CAO NHẤT: TRADE FLIP (Chốt Long xong rình Short tại cản)
  // ==============================================================
  const flipSignal = !config.enableTradeFlip ? null : evaluateTradeFlipOpportunity({
    symbol,
    candles15m: candlesM15,
    candlesH1,
    atrH1,
    config: {
      ...config,
      isBullTrend,
      isBearTrend,
      marketPhase
    }
  });
  if (flipSignal) return formatFinalSignal(flipSignal);

  // ==============================================================
  // 2. PHẢN ỨNG BIÊN HỘP VĨ MÔ 300 NẾN (MACRO RANGE FADE)
  // Quét chiếc hộp đa tháng: Short tại Range High (95-97$), Long tại Range Low (74-76$)
  // ==============================================================
  const macroRange = detectMacroRangeBox(candlesH4, candlesD1, 300);
  if (macroRange && macroRange.isEstablishedRange) {
    const rangeFadeSignal = evaluateMacroRangeFade({
      symbol,
      candlesH4,
      candlesH1,
      candlesM15,
      macroRange,
      atrH1,
      config: {
      ...config,
      isBullTrend,
      isBearTrend,
      marketPhase
    }
    });
    if (rangeFadeSignal && (rangeFadeSignal.direction === 'SHORT' ? config.enableMacroRangeShort : config.enableMacroRangeLong)) return formatFinalSignal(rangeFadeSignal);
  }

  // ==============================================================
  // 3. SÓNG BÙNG NỔ PHÁ HỘP TÍCH LŨY (M15 VOLUME BREAKOUT)
  // Nổ volume cá mập >= 2.0x -> Vào ngay chân sóng (81.5$), không chờ nến H4
  // ==============================================================
  const breakoutSignal = !config.enableBreakoutStrategy ? null : evaluateVolumeBreakout({
    symbol,
    candles15m: candlesM15,
    candlesH1,
    candlesH4,
    atrH1,
    resistances,
    supports,
    config: {
      ...config,
      isBullTrend,
      isBearTrend,
      marketPhase
    }
  });
  if (breakoutSignal) return formatFinalSignal(breakoutSignal);

  // ==============================================================
  // 4. CHIẾN LƯỢC THEO CẤU TRÚC: KANE SONIC R & SMC ZONE REACTION
  // ==============================================================
  if (marketPhase === 'RANGING' && d1Phase === 'RANGING') {
    const zoneReactionSignal = tryZoneReactionSetup(setupParams);
    if (zoneReactionSignal) return formatFinalSignal(zoneReactionSignal);

    const kaneLongSignal = tryKaneLongSetup(setupParams);
    if (kaneLongSignal) return formatFinalSignal(kaneLongSignal);

    const kaneShortSignal = tryKaneShortSetup(setupParams);
    if (kaneShortSignal) return formatFinalSignal(kaneShortSignal);
  } else {
    const kaneLongSignal = tryKaneLongSetup(setupParams);
    if (kaneLongSignal) return formatFinalSignal(kaneLongSignal);

    const kaneShortSignal = tryKaneShortSetup(setupParams);
    if (kaneShortSignal) return formatFinalSignal(kaneShortSignal);

    const zoneReactionSignal = tryZoneReactionSetup(setupParams);
    if (zoneReactionSignal) return formatFinalSignal(zoneReactionSignal);
  }

  // 5. HỘP WYCKOFF (xét SAU Kane/Zone để không chiếm chỗ lõi cũ). Bỏ qua chop-sleep vì hộp vốn là vùng đi ngang.
  if ((config.enableWyckoffSpring || config.enableWyckoffBreakout) && macroRange && macroRange.isEstablishedRange) {
    const wyParams = { symbol, candlesH1, candlesM15, macroRange, atrH1, d1Phase, config };
    const wy = (config.enableWyckoffSpring && evaluateWyckoffSpring(wyParams))
      || (config.enableWyckoffBreakout && evaluateWyckoffBreakoutRetest(wyParams));
    if (wy) return formatFinalSignal(wy);
  }

  return chopBlockedSignal;
}
