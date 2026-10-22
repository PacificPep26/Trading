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
  findFractalPivots,
  classifyLiquidityTiers,
  detectVolumeAbsorption,
  detectPreviousBarSweep
} from './indicators.js';

import { BOT_CONFIG, DEFAULT_CONFIG } from './config.js';
export { BOT_CONFIG, DEFAULT_CONFIG };

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
 * Bộ Chỉ Huy Đầu Tàu BTC (Locomotive Leader Engine)
 * Triết lý cốt lõi từ phản hồi thực tế:
 * "Đánh sai là do không theo đầu tàu! Thay vì phạt theo giờ đồng hồ cứng nhắc,
 * phải phạt và kiểm soát theo CẤU TRÚC ĐẦU TÀU (BTC)!"
 * 
 * - BTC là "Đầu Tàu" kéo toàn bộ các toa tàu (Altcoins SOL, LINK, NEAR, ETH).
 * - Khi Đầu Tàu BTC đang lao dốc (Dumping Waterfall): CẤM TUYỆT ĐỐI Long Altcoin!
 * - Khi Đầu Tàu BTC đang bơm dựng cột (Pumping Parabolic): CẤM TUYỆT ĐỐI Short Altcoin!
 * - Nhận diện nến rút râu đảo chiều của BTC (CHoCH / Rejection) để giải phóng án phạt cho Altcoin!
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

  // Nhận diện nến H1 của Đầu Tàu có xác nhận đảo chiều cấu trúc (Structural Reversal) hay không
  const h1Anatomy = analyzeCandle(lastH1);
  const hasBullishReversal = h1Anatomy.lowerWickRatio >= 0.35 && lastH1.close > lastH1.open;
  const hasBearishRejection = h1Anatomy.upperWickRatio >= 0.35 && lastH1.close < lastH1.open;

  // 1. Đầu Tàu BTC đang Lao Dốc (Dumping Waterfall) -> Cấm Long Altcoins
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

  // 2. Đầu Tàu BTC đang Bơm Dốc (Pumping Parabolic) -> Cấm Short Altcoins
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
 * Kiểm tra Khiên bảo vệ BTC Macro 1H (Giữ tương thích ngược)
 */
export function checkBtcMacroShield(btcH1Candles) {
  const loco = analyzeBtcLocomotive({ btcH1Candles });
  return {
    canLong: loco.canLongAlts,
    canShort: loco.canShortAlts,
    reason: loco.reason
  };
}

/**
 * Nhận diện Giai đoạn Thị trường (Market Regime / Phase Classifier)
 * Phục vụ bài học cốt lõi: Phải xem nến đánh theo từng giai đoạn, không dùng rập khuôn:
 * - STRONG_UPTREND: EMA34 > EMA89 dốc mạnh (Spread >= 0.8% và đang mở rộng), nến bám trên EMA34 -> CẤM SHORT CHẶN XE LỬA
 * - STRONG_DOWNTREND: EMA34 < EMA89 dốc mạnh (Spread <= -0.8% và đang mở rộng), nến bị đè dưới EMA34 -> CẤM LONG BẮT DAO RƠI
 * - RANGING: Đi ngang có cấu trúc biên độ rõ ràng -> Thích hợp đón đầu tại 2 đầu biên Tier 2 Key Levels
 */
export function detectMarketPhase(candlesH4, ema34Arr, ema89Arr) {
  if (!candlesH4 || candlesH4.length < 10) return 'RANGING';
  const lastIdx = candlesH4.length - 1;
  const e34 = ema34Arr[lastIdx];
  const e89 = ema89Arr[lastIdx];
  const prevE34 = ema34Arr[Math.max(0, lastIdx - 3)] || e34;
  const prevE89 = ema89Arr[Math.max(0, lastIdx - 3)] || e89;

  const curSpreadPct = (e34 - e89) / e89 * 100;
  const prevSpreadPct = (prevE34 - prevE89) / prevE89 * 100;
  const curPrice = candlesH4[lastIdx].close;

  // 1. Xu hướng Tăng Dốc Mạnh (Strong Uptrend)
  if (curSpreadPct >= 0.8 && curSpreadPct >= (prevSpreadPct - 0.05) && curPrice >= e34 * 0.998) {
    return 'STRONG_UPTREND';
  }

  // 2. Xu hướng Giảm Dốc Đứng (Strong Downtrend / Waterfall)
  if (curSpreadPct <= -0.8 && curSpreadPct <= (prevSpreadPct + 0.05) && curPrice <= e34 * 1.002) {
    return 'STRONG_DOWNTREND';
  }

  return 'RANGING';
}

/**
 * Master Evaluator - Đánh giá Thị trường theo chuẩn công thức VIP Dr. Kane H4/M15
 * @param {object} params
 * @returns {object|null}
 */
export function evaluateMarket({ symbol, candlesH4, candlesH1, candlesM15, btcH1Candles = null, btcH4Candles = null, config = DEFAULT_CONFIG }) {
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
  // barsSinceH4Close: 0 đến 4 là ngay sau khi H4 đóng nến (chạy chiến lược H4 truyền thống)
  // barsSinceH4Close > 4 là giai đoạn trong phiên nến H4 đang chạy (chạy chiến lược Đón Đầu Zone Reaction)
  const barsSinceH4Close = Math.round((curM15CloseTime - lastH4CloseTime) / M15_MS);
  if (barsSinceH4Close < 0) {
    return null;
  }
  const isFreshH4 = barsSinceH4Close <= 4;

  // 1. Chỉ báo Kane VIP: EMA 34 & EMA 89 trên khung H4
  const closesH4 = candlesH4.map(c => c.close);
  const ema34Arr = calculateEMA(closesH4, 34);
  const ema89Arr = calculateEMA(closesH4, 89);
  const ema34 = ema34Arr[ema34Arr.length - 1];
  const ema89 = ema89Arr[ema89Arr.length - 1];

  if (!ema34 || !ema89) return null;

  // Nhận diện Giai đoạn Thị trường (Market Regime): STRONG_UPTREND, STRONG_DOWNTREND, RANGING
  const marketPhase = detectMarketPhase(candlesH4, ema34Arr, ema89Arr);

  // Xu hướng theo Kane EMA 34 & 89
  const isBullTrend = ema34 >= ema89;
  const isBearTrend = ema34 < ema89;

  // Lọc Fractal Key Levels H4 (Đỉnh Kháng cự & Đáy Hỗ trợ)
  const pivots = findFractalPivots(candlesH4, 2, 2);
  const resistances = pivots
    .filter(p => p.type === 'HIGH' && p.price > curPrice)
    .map(p => p.price);

  const supports = pivots
    .filter(p => p.type === 'LOW' && p.price < curPrice)
    .map(p => p.price);

  // Bổ sung các Cản Đỉnh/Đáy gần nhất (nến liền kề prevH4 & Tier 2 Major Levels) để không bao giờ bị mù cản vừa tạo
  const prevH4 = candlesH4[candlesH4.length - 2];
  if (prevH4) {
    if (prevH4.high > curPrice && !resistances.some(r => Math.abs(r - prevH4.high) / r < 0.003)) {
      resistances.push(prevH4.high);
    }
    if (prevH4.low < curPrice && !supports.some(s => Math.abs(s - prevH4.low) / s < 0.003)) {
      supports.push(prevH4.low);
    }
  }

  // Phân cấp Thanh khoản 2 Tầng (Smart Money Inducement vs Major Key Level)
  const liquidityTiers = classifyLiquidityTiers(candlesH4, curPrice);

  if (liquidityTiers.tier2MajorHigh && liquidityTiers.tier2MajorHigh > curPrice && !resistances.some(r => Math.abs(r - liquidityTiers.tier2MajorHigh) / r < 0.003)) {
    resistances.push(liquidityTiers.tier2MajorHigh);
  }
  if (liquidityTiers.tier2MajorLow && liquidityTiers.tier2MajorLow < curPrice && !supports.some(s => Math.abs(s - liquidityTiers.tier2MajorLow) / s < 0.003)) {
    supports.push(liquidityTiers.tier2MajorLow);
  }

  resistances.sort((a, b) => a - b); // Tăng dần (gần nhất lên đầu)
  supports.sort((a, b) => b - a);    // Giảm dần (gần nhất lên đầu)

  const atrsH1 = calculateATR(candlesH1, 14);
  const atrH1 = atrsH1[atrsH1.length - 1] || (curPrice * 0.005);
  const h4Anatomy = analyzeCandle(lastH4);

  // Phân tích Khối Lượng Hấp Thụ VSA (Volume Absorption)
  const volAbsorptionH4 = detectVolumeAbsorption(candlesH4, candlesH4.length - 1);
  const volAbsorptionM15 = detectVolumeAbsorption(candlesM15, candlesM15.length - 1);

  // Bộ Chỉ Huy Đầu Tàu BTC (Locomotive Leader Check)
  const isAltcoin = !symbol.includes('BTC');
  const btcLoco = analyzeBtcLocomotive({ btcH4Candles, btcH1Candles });
  const btcShield = {
    canLong: isAltcoin ? btcLoco.canLongAlts : true,
    canShort: isAltcoin ? btcLoco.canShortAlts : true,
    reason: btcLoco.reason
  };
  let blockedSignal = null;

  // =========================================================================
  // SETUP 1 & 2: KANE SWING & TREND (CHỈ CHẠY KHI H4 VỪA ĐÓNG NẾN FRESH <= 4 BARS)
  // =========================================================================
  if (isFreshH4) {
    // SETUP 1: KANE LONG
    for (const sup of supports) {
    if (lastH4.low < sup) {
      // ĐÁNH THEO GIAI ĐOẠN (REGIME FILTER):
      // Nếu đang trong bão giảm dốc đứng một chiều (STRONG_DOWNTREND), CẤM Long bắt đáy dao rơi!
      if (marketPhase === 'STRONG_DOWNTREND') {
        continue;
      }

      // SMC Inducement Filter: Bỏ qua bắt đáy nếu đang nén tại cản đáy con (Equal Lows) chưa được quét
      if (liquidityTiers.isInducementTrapRisk && liquidityTiers.sweepState === 'INDUCEMENT_TRAP_LOW') {
        const isNearInducement = liquidityTiers.tier1Lows.some(tl => Math.abs(sup - tl.avgPrice) / sup <= 0.01);
        if (isNearInducement && h4Anatomy.lowerWickRatio < 0.45) {
          continue; // Tránh bẫy thanh khoản đáy con
        }
      }

      const isStrongSweep = h4Anatomy.lowerWickRatio >= 0.45;
      const isNormalSweep = h4Anatomy.lowerWickRatio >= (config.wickRatioThreshold || 0.35) && lastH4.close >= sup * 0.998;
      const prevH4 = candlesH4[candlesH4.length - 2];
      const isEngulfing = prevH4 && lastH4.close > lastH4.open && lastH4.close >= prevH4.open;
      const isSmcSweepLong = liquidityTiers.sweepState === 'BULLISH_SWEEP_CONFIRMED';

      let canLong = false;
      let isNgocTrend = false;

      if (isBullTrend) {
        canLong = isNormalSweep || isEngulfing || isSmcSweepLong;
      } else {
        const distBelowEma34 = (ema34 - curPrice) / curPrice;
        const isAtMajorSupport = (liquidityTiers.tier2MajorLow && Math.abs(curPrice - liquidityTiers.tier2MajorLow) / curPrice <= 0.015) || isStrongSweep || isSmcSweepLong;
        if ((distBelowEma34 >= 0.030 && (isStrongSweep || isEngulfing)) || isSmcSweepLong || isAtMajorSupport) {
          canLong = true;
          isNgocTrend = !isSmcSweepLong;
        }
      }

      if (canLong) {
        // Điều kiện xác nhận M15: Nến M15 đóng xanh và phá đỉnh nến trước
        const isM15Green = currentM15.close > currentM15.open;
        const isM15Breakout = currentM15.close > prevM15.high;

        if (isM15Green && isM15Breakout) {
          const entry = currentM15.close;

          // QUY TẮC CHỐNG LONG ĐUỔI KHI TĂNG KIỆT SỨC (PULLBACK / RETRACEMENT RULE):
          // Để Long, giá phải nằm ở nửa dưới Discount Zone (entry <= h4Mid * 1.002)
          // HOẶC các nến M15 gần đây đã có nhịp thoái lui xuống test vùng 50% nến H4.
          const h4Mid = (lastH4.high + lastH4.low) / 2;
          const recentM15Slice = candlesM15.slice(-8);
          const recentLowM15 = Math.min(...recentM15Slice.map(c => c.low));
          const hasValidLongPullback = entry <= (h4Mid * 1.002) || recentLowM15 <= (h4Mid * 1.002);
          if (!hasValidLongPullback) {
            continue; // Bỏ qua pha tăng kiệt sức lết đỉnh (Chống Long đuổi ở đỉnh)!
          }

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

            const stratName = isSmcSweepLong ? 'SMC_SWEEP_REVERSAL_LONG' : (isNgocTrend ? 'KANE_NGUOC_TREND_LONG' : 'KANE_THUAN_TREND_LONG');
            const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);
            const vsaNote = volAbsorptionH4.isAbsorption ? ` | VSA: ${volAbsorptionH4.details}` : (volAbsorptionM15.isAbsorption ? ` | VSA: ${volAbsorptionM15.details}` : '');
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
              reason: `${stratName}: H4 swept Support ${sup} (Râu ${(h4Anatomy.lowerWickRatio * 100).toFixed(1)}%), EMA34=${ema34.toFixed(2)}, M15 Bullish push${vsaNote}`
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
      // ĐÁNH THEO GIAI ĐOẠN (REGIME FILTER):
      // Nếu đang trong bão tăng dốc mạnh một chiều (STRONG_UPTREND), CẤM Short cản tàu!
      if (marketPhase === 'STRONG_UPTREND') {
        continue;
      }

      // SMC Inducement Filter: Bỏ qua bắt đỉnh nếu đang nén tại cản đỉnh con (Equal Highs) chưa được quét
      // (Bảo vệ tài khoản tuyệt đối trước cú bơm quét SL lúc 19h như ngày 21/10)
      if (liquidityTiers.isInducementTrapRisk && liquidityTiers.sweepState === 'INDUCEMENT_TRAP_HIGH') {
        const isNearInducement = liquidityTiers.tier1Highs.some(th => Math.abs(res - th.avgPrice) / res <= 0.01);
        if (isNearInducement && h4Anatomy.upperWickRatio < 0.45) {
          continue; // Bỏ qua bẫy cản con!
        }
      }

      const isStrongRejection = h4Anatomy.upperWickRatio >= 0.45;
      const isNormalRejection = h4Anatomy.upperWickRatio >= (config.wickRatioThreshold || 0.35);
      const isSmcSweepShort = liquidityTiers.sweepState === 'BEARISH_SWEEP_CONFIRMED';

      let canShort = false;
      let isNgocTrend = false;

      if (isBearTrend) {
        canShort = isNormalRejection || isSmcSweepShort;
      } else {
        const distAboveEma34 = (curPrice - ema34) / ema34;
        if ((distAboveEma34 >= 0.030 && isStrongRejection) || isSmcSweepShort) {
          canShort = true;
          isNgocTrend = !isSmcSweepShort;
        }
      }

      if (canShort) {
        // Điều kiện xác nhận M15: Nến M15 đóng đỏ gãy đáy nến trước
        const isM15Red = currentM15.close < currentM15.open;
        const isM15Breakdown = currentM15.close < prevM15.low;

        if (isM15Red && isM15Breakdown) {
          const entry = currentM15.close;

          // QUY TẮC CHỐNG SHORT ĐUỔI KHI XẢ KIỆT SỨC (PULLBACK / RETRACEMENT RULE):
          // Để Short, giá phải nằm ở nửa trên Premium Zone (entry >= h4Mid * 0.998)
          // HOẶC các nến M15 gần đây đã có nhịp hồi lên test tối thiểu vùng 50% nến H4.
          const h4Mid = (lastH4.high + lastH4.low) / 2;
          const recentM15Slice = candlesM15.slice(-8);
          const recentHighM15 = Math.max(...recentM15Slice.map(c => c.high));
          const hasValidShortPullback = entry >= (h4Mid * 0.998) || recentHighM15 >= (h4Mid * 0.998);
          if (!hasValidShortPullback) {
            continue; // Bỏ qua pha xả kiệt sức lết đáy (Chống Short đuổi ở đáy)!
          }

          // QUY TẮC CHỐNG BÁN ĐUỔI TẠI ĐÁY HỖ TRỢ LỚN (ANTI-SHORT AT MAJOR TIER 2 SUPPORT):
          // Nếu giá hiện tại đang áp sát Hỗ trợ lớn cấu trúc Tier 2 trong vòng 0.8%, TUYỆT ĐỐI KHÔNG SHORT!
          const majorLow = liquidityTiers.tier2MajorLow;
          if (majorLow && curPrice <= majorLow * 1.008) {
            continue; // Không bán tháo trên đầu hỗ trợ cứng!
          }

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

            const stratName = isSmcSweepShort ? 'SMC_SWEEP_REVERSAL_SHORT' : (isNgocTrend ? 'KANE_NGUOC_TREND_SHORT' : 'KANE_THUAN_TREND_SHORT');
            const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);
            const vsaNote = volAbsorptionH4.isAbsorption ? ` | VSA: ${volAbsorptionH4.details}` : (volAbsorptionM15.isAbsorption ? ` | VSA: ${volAbsorptionM15.details}` : '');
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
              reason: `${stratName}: H4 tested Res ${res} (Râu trên ${(h4Anatomy.upperWickRatio * 100).toFixed(1)}%), EMA34=${ema34.toFixed(2)}, M15 Bearish drop${vsaNote}`
            };
          }
        }
      }
    }
  }
  } // Đóng if (isFreshH4)

  // =========================================================================
  // SETUP 3: SMC ZONE REACTION (VÀO LỆNH ĐÓN ĐẦU TẠI CẢN & HỖ TRỢ LỚN THEO M15)
  // Thực hiện đúng triết lý: "Lập kịch bản trước các vùng cản/hỗ trợ lớn (Tier 2 / Đỉnh đáy nến H4 trước),
  // khi giá tới đó xem M15 phản ứng sao rồi vào lệnh đón đầu tại đỉnh/đáy,
  // không ngồi chờ nến 4H đóng để rồi dí theo đuổi giá!"
  //
  // NGUYÊN TẮC THỂ CHẾ (INSTITUTIONAL RULE):
  // - BTC & ETH: Là 2 coin dẫn dắt thanh khoản lớn nhất, vùng cản Tier 2 giữ rất chuẩn.
  // - Altcoin (SOL, LINK, NEAR): Rất dễ bị kéo xuyên cản theo quán tính BTC,
  //   do đó đối với Altcoin BẮT BUỘC PHẢI CÓ VOLUME ABSORPTION (VSA Climax) mới được bắt đỉnh/đáy!
  // =========================================================================
  const isLeader = symbol.includes('BTC') || symbol.includes('ETH');
  const m15Anatomy = analyzeCandle(currentM15);

  const majorResistances = [];
  if (liquidityTiers.tier2MajorHigh && liquidityTiers.tier2MajorHigh > curPrice) {
    majorResistances.push(liquidityTiers.tier2MajorHigh);
  }

  const majorSupports = [];
  if (liquidityTiers.tier2MajorLow && liquidityTiers.tier2MajorLow < curPrice) {
    majorSupports.push(liquidityTiers.tier2MajorLow);
  }

  // 1. Zone Reaction Short tại Vùng Kháng cự Lớn
  if (marketPhase !== 'STRONG_UPTREND') {
    for (const res of majorResistances) {
    const testedRes = currentM15.high >= (res * 0.998) || prevM15.high >= (res * 0.998);
    if (testedRes) {
      // Yêu cầu: Với BTC/ETH cần râu trên >= 40% hoặc M15 đảo chiều. Với Altcoin bắt buộc phải có VSA Climax!
      const hasVsaRejection = volAbsorptionM15.isAbsorption || volAbsorptionH4.isAbsorption || (isLeader && m15Anatomy.upperWickRatio >= 0.45);
      const isM15Reversal = currentM15.close < currentM15.open && currentM15.close < prevM15.low;

      if (hasVsaRejection && isM15Reversal) {
        // Nếu ngược trend tăng thì bắt buộc giá phải dãn nở xa EMA34 >= 2.0%
        if (isBullTrend) {
          const distAboveEma34 = (curPrice - ema34) / ema34;
          if (distAboveEma34 < 0.020 && !volAbsorptionM15.isAbsorption) continue;
        }

        const entry = currentM15.close;
        const stopLoss = Math.max(currentM15.high, prevM15.high) + (config.atrBufferMultiplier * atrH1);

        const slDistanceRate = Math.abs(entry - stopLoss) / entry;
        if (config.maxSlDistanceRate && slDistanceRate > config.maxSlDistanceRate) {
          continue;
        }

        const targetSup = supports.find(s => (entry - s) / (stopLoss - entry) >= config.minRR);
        if (targetSup) {
          const rr = (entry - targetSup) / (stopLoss - entry);
          if (!btcShield.canShort) {
            blockedSignal = { isBlocked: true, blockReason: btcShield.reason, symbol, direction: 'SHORT' };
            continue;
          }

          const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);
          const vsaNote = volAbsorptionM15.isAbsorption ? ` | VSA M15: ${volAbsorptionM15.details}` : '';
          return {
            strategy: 'SMC_ZONE_REACTION_SHORT',
            direction: 'SHORT',
            symbol,
            entry,
            stopLoss,
            takeProfit: targetSup,
            riskReward: parseFloat(rr.toFixed(2)),
            triggerTime: currentM15.ts,
            sizing,
            reason: `SMC_ZONE_REACTION_SHORT: Đón đầu tại Cản ${res} (M15 Râu trên ${(m15Anatomy.upperWickRatio * 100).toFixed(1)}%), SL sát đỉnh râu${vsaNote}`
          };
        }
      }
    }
  }
  } // Đóng if (marketPhase !== 'STRONG_UPTREND')

  // 2. Zone Reaction Long tại Vùng Hỗ trợ Lớn
  if (marketPhase !== 'STRONG_DOWNTREND') {
    for (const sup of majorSupports) {
    const testedSup = currentM15.low <= (sup * 1.002) || prevM15.low <= (sup * 1.002);
    if (testedSup) {
      // Yêu cầu: Với BTC/ETH cần râu dưới >= 40% hoặc M15 đảo chiều. Với Altcoin bắt buộc phải có VSA Climax!
      const hasVsaRejection = volAbsorptionM15.isAbsorption || volAbsorptionH4.isAbsorption || (isLeader && m15Anatomy.lowerWickRatio >= 0.45);
      const isM15Reversal = currentM15.close > currentM15.open && currentM15.close > prevM15.high;

      if (hasVsaRejection && isM15Reversal) {
        // Nếu đang ở Hỗ trợ Lớn (Tier 2 Major Low hoặc râu rút chân M15 >= 40%) thì cho phép Long đón đáy!
        const isAtMajorSupport = (liquidityTiers.tier2MajorLow && Math.abs(curPrice - liquidityTiers.tier2MajorLow) / curPrice <= 0.015) || m15Anatomy.lowerWickRatio >= 0.40;
        if (isBearTrend && !isAtMajorSupport) {
          const distBelowEma34 = (ema34 - curPrice) / curPrice;
          if (distBelowEma34 < 0.020 && !volAbsorptionM15.isAbsorption) continue;
        }

        const entry = currentM15.close;
        const stopLoss = Math.min(currentM15.low, prevM15.low) - (config.atrBufferMultiplier * atrH1);

        const slDistanceRate = Math.abs(entry - stopLoss) / entry;
        if (config.maxSlDistanceRate && slDistanceRate > config.maxSlDistanceRate) {
          continue;
        }

        const targetRes = resistances.find(r => (r - entry) / (entry - stopLoss) >= config.minRR);
        if (targetRes) {
          const rr = (targetRes - entry) / (entry - stopLoss);
          if (!btcShield.canLong) {
            blockedSignal = { isBlocked: true, blockReason: btcShield.reason, symbol, direction: 'LONG' };
            continue;
          }

          const sizing = calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage);
          const vsaNote = volAbsorptionM15.isAbsorption ? ` | VSA M15: ${volAbsorptionM15.details}` : '';
          return {
            strategy: 'SMC_ZONE_REACTION_LONG',
            direction: 'LONG',
            symbol,
            entry,
            stopLoss,
            takeProfit: targetRes,
            riskReward: parseFloat(rr.toFixed(2)),
            triggerTime: currentM15.ts,
            sizing,
            reason: `SMC_ZONE_REACTION_LONG: Đón đầu tại Hỗ trợ ${sup} (M15 Râu dưới ${(m15Anatomy.lowerWickRatio * 100).toFixed(1)}%), SL sát đáy râu${vsaNote}`
          };
        }
      }
    }
  }
  } // Đóng if (marketPhase !== 'STRONG_DOWNTREND')

  return blockedSignal;
}

/**
 * Lập Bản Đồ Cản "Canh Trước" (Pre-Planned Key Level Radar)
 * Cho phép Pro Trader và Bot biết trước vùng phục kích trước khi giá tới nơi!
 * @param {object} params
 * @returns {object|null}
 */
export function generateKeyLevelRadar({ symbol, candlesH4, curPrice }) {
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

  const nearestRes = candidateResistances
    .filter(r => r > curPrice)
    .sort((a, b) => a - b)[0] || null;

  const nearestSup = candidateSupports
    .filter(s => s < curPrice)
    .sort((a, b) => b - a)[0] || null;

  const distToResPct = nearestRes ? ((nearestRes - curPrice) / curPrice) * 100 : null;
  const distToSupPct = nearestSup ? ((curPrice - nearestSup) / curPrice) * 100 : null;

  let radarStatus = 'NEUTRAL';
  let scenario = 'Chờ cấu trúc tiếp tục phát triển';

  if (nearestRes && distToResPct <= 1.0) {
    radarStatus = 'APPROACHING_RESISTANCE';
    scenario = `🎯 CẢNH BÁO CANH SHORT: Giá đang áp sát Cản ${nearestRes} (cách ${distToResPct.toFixed(2)}%). Kịch bản: Canh nến M15 thọc qua ${nearestRes} và rút râu xả kèm Volume Absorption để Short đón đỉnh!`;
  } else if (nearestSup && distToSupPct <= 1.0) {
    radarStatus = 'APPROACHING_SUPPORT';
    scenario = `🎯 CẢNH BÁO CANH LONG: Giá đang áp sát Hỗ trợ ${nearestSup} (cách ${distToSupPct.toFixed(2)}%). Kịch bản: Canh nến M15 nhúng qua ${nearestSup} và rút chân mạnh kèm Volume Absorption để Long bắt đáy!`;
  }

  return {
    symbol,
    curPrice,
    trendH4: ema34 >= ema89 ? 'BULL' : 'BEAR',
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
    scenario
  };
}

