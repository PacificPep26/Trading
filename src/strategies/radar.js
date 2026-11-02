/**
 * RADAR.JS
 * Lập Bản Đồ Cản "Canh Trước" (Pre-Planned Key Level Radar)
 * Cho phép Pro Trader và Bot biết trước vùng phục kích trước khi giá tới nơi!
 */

import {
  calculateEMA,
  findFractalPivots,
  findFairValueGaps,
  classifyLiquidityTiers,
  findBreakerBlocks
} from '../indicators.js';
import { detectMarketPhase } from './regime.js';
import { detectMacroRangeBox } from './macro_range.js';
import { DEFAULT_CONFIG } from '../config.js';

export function generateKeyLevelRadar({ symbol, candlesH4, curPrice, candlesH1 = null, candlesD1 = null, candlesW1 = null, config = DEFAULT_CONFIG }) {
  if (!candlesH4 || candlesH4.length < 15) return null;

  const closesH4 = candlesH4.map(c => c.close);
  const ema34Arr = calculateEMA(closesH4, 34);
  const ema89Arr = calculateEMA(closesH4, 89);
  const ema34 = ema34Arr[ema34Arr.length - 1] || curPrice;
  const ema89 = ema89Arr[ema89Arr.length - 1] || curPrice;
  const liquidityTiers = classifyLiquidityTiers(candlesH4, curPrice);

  const pivots = findFractalPivots(candlesH4, 2, 2);
  const prevH4 = candlesH4[candlesH4.length - 1];

  const candidateResistances = pivots.filter(p => p.type === 'HIGH').map(p => p.price);
  if (prevH4) candidateResistances.push(prevH4.high);
  if (liquidityTiers.tier2MajorHigh) candidateResistances.push(liquidityTiers.tier2MajorHigh);

  const candidateSupports = pivots.filter(p => p.type === 'LOW').map(p => p.price);
  if (prevH4) candidateSupports.push(prevH4.low);
  if (liquidityTiers.tier2MajorLow) candidateSupports.push(liquidityTiers.tier2MajorLow);

  // Bổ sung các vùng Fair Value Gap (FVG) chưa lấp vào kịch bản đón đầu
  const targetCandlesForFvg = (candlesH1 && candlesH1.length >= 5) ? candlesH1 : candlesH4;
  if (targetCandlesForFvg && targetCandlesForFvg.length >= 5) {
    const fvgs = findFairValueGaps(targetCandlesForFvg);
    fvgs.filter(f => f.type === 'BULLISH' && !f.isMitigated && f.top < curPrice).forEach(f => candidateSupports.push(f.top));
    fvgs.filter(f => f.type === 'BEARISH' && !f.isMitigated && f.bottom > curPrice).forEach(f => candidateResistances.push(f.bottom));
  }

  // Bổ sung các mức Flip Level (Breaker Zones) chưa mitigated vào kịch bản đón đầu
  if (config?.useFlipLevels) {
    const pL = config.breakerPivotL || 2;
    const pR = config.breakerPivotR || 2;
    const flipZones = findBreakerBlocks(candlesH4, pL, pR).filter(b => !b.isMitigated);
    for (const b of flipZones) {
      if (b.type === 'BEARISH' && b.top > curPrice && !candidateResistances.some(r => Math.abs(r - b.top) / r < 0.003)) {
        candidateResistances.push(b.top);
      }
      if (b.type === 'BULLISH' && b.bottom < curPrice && !candidateSupports.some(s => Math.abs(s - b.bottom) / s < 0.003)) {
        candidateSupports.push(b.bottom);
      }
    }
  }

  // Bổ sung các mức Tuần W1 (PWH / PWL / EMA34 W1) vào kịch bản đón đầu vĩ mô
  let pwh = null;
  let pwl = null;
  let ema34W1 = null;
  let w1Phase = 'NEUTRAL';
  let consecutiveRedWeeks = 0;

  if (candlesW1 && candlesW1.length >= 2) {
    const closedW1 = candlesW1.filter(c => c.confirm === 1);
    if (closedW1.length > 0) {
      const lastClosedW1 = closedW1[closedW1.length - 1];
      pwh = lastClosedW1.high;
      pwl = lastClosedW1.low;

      for (let i = closedW1.length - 1; i >= 0; i--) {
        if (closedW1[i].close < closedW1[i].open) consecutiveRedWeeks++;
        else break;
      }
      const curW1 = candlesW1[candlesW1.length - 1];
      if (curW1 && curW1.close < curW1.open) consecutiveRedWeeks++;

      if (config?.useW1MacroLevels !== false) {
        if (pwh > curPrice && !candidateResistances.some(r => Math.abs(r - pwh) / r < 0.003)) {
          candidateResistances.push(pwh);
        }
        if (pwl < curPrice && !candidateSupports.some(s => Math.abs(s - pwl) / s < 0.003)) {
          candidateSupports.push(pwl);
        }
      }

      if (closedW1.length >= 34) {
        const closesW1 = closedW1.map(c => c.close);
        const emaW1Arr = calculateEMA(closesW1, 34);
        ema34W1 = emaW1Arr ? emaW1Arr[emaW1Arr.length - 1] : null;
        if (ema34W1) {
          w1Phase = curPrice >= ema34W1 ? 'BULL' : 'BEAR';
          if (config?.useW1MacroLevels !== false) {
            if (ema34W1 > curPrice && !candidateResistances.some(r => Math.abs(r - ema34W1) / r < 0.003)) {
              candidateResistances.push(ema34W1);
            } else if (ema34W1 < curPrice && !candidateSupports.some(s => Math.abs(s - ema34W1) / s < 0.003)) {
              candidateSupports.push(ema34W1);
            }
          }
        }
      }
    }
  }

  // Bổ sung các mức Fractal Pivots D1 (Macro Key Levels) vào kịch bản đón đầu
  if (config?.useD1MacroLevels && candlesD1 && candlesD1.length >= 10) {
    const d1Pivots = findFractalPivots(candlesD1, 2, 2);
    const lowestH4Sup = candidateSupports.length > 0 ? Math.min(...candidateSupports) : Infinity;
    const highestH4Res = candidateResistances.length > 0 ? Math.max(...candidateResistances) : -Infinity;

    for (const p of d1Pivots) {
      if (p.type === 'HIGH' && p.price > curPrice) {
        const isEligible = config.d1MacroMode === 'OUT_OF_BOUNDS_ONLY' ? p.price > highestH4Res : true;
        if (isEligible && !candidateResistances.some(r => Math.abs(r - p.price) / r < 0.003)) {
          candidateResistances.push(p.price);
        }
      }
      if (p.type === 'LOW' && p.price < curPrice) {
        const isEligible = config.d1MacroMode === 'OUT_OF_BOUNDS_ONLY' ? p.price < lowestH4Sup : true;
        if (isEligible && !candidateSupports.some(s => Math.abs(s - p.price) / s < 0.003)) {
          candidateSupports.push(p.price);
        }
      }
    }
  }

  const marketPhase = detectMarketPhase(candlesH4, ema34Arr, ema89Arr);
  let d1Phase = 'RANGING';
  if (candlesD1 && candlesD1.length >= 90) {
    const closesD1 = candlesD1.map(c => c.close);
    const ema34D1Arr = calculateEMA(closesD1, 34);
    const ema89D1Arr = calculateEMA(closesD1, 89);
    d1Phase = detectMarketPhase(candlesD1, ema34D1Arr, ema89D1Arr);
  }

  const isStrongDown = marketPhase === 'STRONG_DOWNTREND' || d1Phase === 'STRONG_DOWNTREND';
  const isStrongUp = marketPhase === 'STRONG_UPTREND' && d1Phase !== 'STRONG_DOWNTREND';

  let trendH4 = 'BEAR';
  if (isStrongDown) {
    trendH4 = 'STRONG_DOWNTREND';
  } else if (isStrongUp) {
    trendH4 = 'STRONG_UPTREND';
  } else if (marketPhase === 'RANGING') {
    trendH4 = ema34 >= ema89 ? 'RANGING_BULL' : 'RANGING_BEAR';
  } else {
    trendH4 = ema34 >= ema89 ? 'BULL' : 'BEAR';
  }

  const nearestRes = candidateResistances
    .filter(r => r > curPrice)
    .sort((a, b) => a - b)[0] || null;

  const nearestSup = candidateSupports
    .filter(s => s < curPrice)
    .sort((a, b) => b - a)[0] || null;

  const distToResPct = nearestRes ? ((nearestRes - curPrice) / curPrice) * 100 : null;
  const distToSupPct = nearestSup ? ((curPrice - nearestSup) / curPrice) * 100 : null;

  // Nhận diện Hộp Vĩ Mô đa tháng (Macro Range Box)
  const macroRange = detectMacroRangeBox(candlesH4, candlesD1 || [], 300);

  let radarStatus = 'NEUTRAL';
  let scenario = 'Chờ cấu trúc tiếp tục phát triển';

  if (nearestRes && distToResPct <= 1.0) {
    radarStatus = 'APPROACHING_RESISTANCE';
    const isMacroRangeHigh = macroRange && macroRange.isEstablishedRange && (nearestRes >= macroRange.rangeHigh * 0.95);

    if (isMacroRangeHigh) {
      scenario = `🎯 CẢNH BÁO TRẦN HỘP TÍM (${nearestRes}): Giá đang tiếp cận Trần Hộp Vĩ Mô ${macroRange.rangeHigh}$ (Hộp đa tháng $${macroRange.rangeLow} - $${macroRange.rangeHigh}). Kịch bản: Rình nến M15/H1 rút râu xả kèm Volume để SHORT đảo chiều về Trục Giữa $${macroRange.equilibrium} và Sàn Hộp $${macroRange.rangeLow}!`;
    } else if (isStrongUp) {
      scenario = `🚨 CẢNH BÁO CẢN (${nearestRes}): Xu hướng H4 đang tăng dốc. Canh nến M15 phá vỡ cản kèm Volume để đánh Breakout Long, hoặc đợi test cản thất bại mới cân nhắc đảo chiều.`;
    } else {
      scenario = `🎯 CẢNH BÁO CANH SHORT: Giá đang áp sát Cản ${nearestRes} (cách ${distToResPct.toFixed(2)}%). Kịch bản: Canh nến M15 thọc qua ${nearestRes} và rút râu xả kèm Volume Absorption để Short đón đỉnh!`;
    }
  } else if (nearestSup && distToSupPct <= 1.0) {
    radarStatus = 'APPROACHING_SUPPORT';
    const isMacroRangeLow = macroRange && macroRange.isEstablishedRange && (nearestSup <= macroRange.rangeLow * 1.05);

    if (isMacroRangeLow) {
      scenario = `🎯 CẢNH BÁO SÀN HỘP TÍM (${nearestSup}): Giá đang tiếp cận Sàn Hộp Vĩ Mô ${macroRange.rangeLow}$ (Hộp đa tháng $${macroRange.rangeLow} - $${macroRange.rangeHigh}). Kịch bản: Rình nến M15/H1 rút chân gom hàng để LONG bắt đáy kéo về Trục Giữa $${macroRange.equilibrium} và Trần Hộp $${macroRange.rangeHigh}!`;
    } else if (isStrongDown) {
      scenario = `🚨 CẢNH BÁO HỖ TRỢ (${nearestSup}): Xu hướng H4 đang xả dốc đứng. Canh nến M15 xả thủng hỗ trợ biến thành Cản Flip Level để Canh SHORT nhịp retest, hoặc chờ tích lũy 2 đáy vững chắc.`;
    } else {
      scenario = `🎯 CẢNH BÁO CANH LONG: Giá đang áp sát Hỗ trợ ${nearestSup} (cách ${distToSupPct.toFixed(2)}%). Kịch bản: Canh nến M15 nhúng qua ${nearestSup} và rút chân mạnh kèm Volume Absorption để Long bắt đáy!`;
    }
  }

  // Xây dựng Kế hoạch Đặt Lệnh Limit Chờ Sẵn (Pre-Planned Limit Order Setup)
  let limitPlan = null;
  const isAlphaIndependent = symbol.includes('HYPE') || symbol.includes('SOL');

  if (macroRange && macroRange.isEstablishedRange) {
    const shortRisk = (macroRange.rangeHigh * 1.018) - (macroRange.rangeHigh * 0.995);
    const shortProfit = (macroRange.rangeHigh * 0.995) - (macroRange.rangeLow * 1.01);
    const shortRR = parseFloat((shortProfit / shortRisk).toFixed(1));

    const longRisk = (macroRange.rangeLow * 1.005) - (macroRange.rangeLow * 0.982);
    const longProfit = (macroRange.rangeHigh * 0.99) - (macroRange.rangeLow * 1.005);
    const longRR = parseFloat((longProfit / longRisk).toFixed(1));

    limitPlan = {
      type: 'MACRO_BOX_LIMITS',
      isAlphaIndependent,
      rangeHigh: macroRange.rangeHigh,
      rangeLow: macroRange.rangeLow,
      equilibrium: macroRange.equilibrium,
      shortLimit: {
        entry: parseFloat((macroRange.rangeHigh * 0.995).toFixed(3)),
        sl: parseFloat((macroRange.rangeHigh * 1.018).toFixed(3)),
        tp1: parseFloat(macroRange.equilibrium.toFixed(3)),
        tp2: parseFloat((macroRange.rangeLow * 1.01).toFixed(3)),
        rr: shortRR
      },
      longLimit: {
        entry: parseFloat((macroRange.rangeLow * 1.005).toFixed(3)),
        sl: parseFloat((macroRange.rangeLow * 0.982).toFixed(3)),
        tp1: parseFloat(macroRange.equilibrium.toFixed(3)),
        tp2: parseFloat((macroRange.rangeHigh * 0.99).toFixed(3)),
        rr: longRR
      }
    };
  } else if (nearestRes && nearestSup) {
    limitPlan = {
      type: 'PIVOT_LIMITS',
      isAlphaIndependent,
      shortLimit: {
        entry: parseFloat(nearestRes.toFixed(3)),
        sl: parseFloat((nearestRes * 1.015).toFixed(3)),
        tp: parseFloat(nearestSup.toFixed(3)),
        rr: parseFloat((Math.abs(nearestRes - nearestSup) / (nearestRes * 0.015)).toFixed(1))
      },
      longLimit: {
        entry: parseFloat(nearestSup.toFixed(3)),
        sl: parseFloat((nearestSup * 0.985).toFixed(3)),
        tp: parseFloat(nearestRes.toFixed(3)),
        rr: parseFloat((Math.abs(nearestRes - nearestSup) / (nearestSup * 0.015)).toFixed(1))
      }
    };
  }

  return {
    symbol,
    curPrice,
    trendH4,
    ema34: parseFloat(ema34.toFixed(2)),
    ema89: parseFloat(ema89.toFixed(2)),
    nearestRes,
    distToResPct: distToResPct !== null ? parseFloat(distToResPct.toFixed(2)) : null,
    nearestSup,
    distToSupPct: distToSupPct !== null ? parseFloat(distToSupPct.toFixed(2)) : null,
    tier1InducementHighs: liquidityTiers.tier1Highs,
    tier1InducementLows: liquidityTiers.tier1Lows,
    tier2MajorHigh: liquidityTiers.tier2MajorHigh,
    tier2MajorLow: liquidityTiers.tier2MajorLow,
    sweepState: liquidityTiers.sweepState,
    radarStatus,
    scenario,
    limitPlan,
    macroRange,
    pwh,
    pwl,
    ema34W1: ema34W1 ? parseFloat(ema34W1.toFixed(2)) : null,
    w1Phase,
    consecutiveRedWeeks
  };
}

