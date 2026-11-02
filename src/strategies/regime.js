/**
 * REGIME.JS
 * Nhận diện giai đoạn thị trường (Market Regime), phân tích vĩ mô D1/W1,
 * đo lường biến động nhanh (Momentum) và kích hoạt chế độ ngủ đông khi Sideway (Chop Sleep Mode).
 */

import { calculateEMA, calculateATR, calculateADX, calculateATRCompression } from '../indicators.js';

/**
 * Nhận diện Giai đoạn Thị trường trên khung H4 hoặc D1
 * @param {Array} candles - Mảng nến
 * @param {Array} ema34Arr - Mảng EMA 34
 * @param {Array} ema89Arr - Mảng EMA 89
 * @returns {'STRONG_UPTREND' | 'STRONG_DOWNTREND' | 'RANGING'}
 */
export function detectMarketPhase(candles, ema34Arr, ema89Arr) {
  if (!candles || candles.length < 10 || !ema34Arr || !ema89Arr) return 'RANGING';
  const lastIdx = candles.length - 1;
  const e34 = ema34Arr[lastIdx];
  const e89 = ema89Arr[lastIdx];
  if (!e34 || !e89) return 'RANGING';

  const prevE34 = ema34Arr[Math.max(0, lastIdx - 3)] || e34;
  const prevE89 = ema89Arr[Math.max(0, lastIdx - 3)] || e89;

  const curSpreadPct = (e34 - e89) / e89 * 100;
  const prevSpreadPct = (prevE34 - prevE89) / prevE89 * 100;
  const curPrice = candles[lastIdx].close;

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
 * Phân tích Vĩ mô D1 (D1 Macro Regime)
 */
export function analyzeD1Macro(candlesD1) {
  let d1Phase = 'RANGING';
  let natrD1 = 0.05;

  if (candlesD1 && candlesD1.length >= 90) {
    const closesD1 = candlesD1.map(c => c.close);
    const ema34D1Arr = calculateEMA(closesD1, 34);
    const ema89D1Arr = calculateEMA(closesD1, 89);
    d1Phase = detectMarketPhase(candlesD1, ema34D1Arr, ema89D1Arr);

    if (candlesD1.length >= 14) {
      const atrD1Arr = calculateATR(candlesD1, 14);
      const lastAtr = atrD1Arr[atrD1Arr.length - 1];
      const lastClose = closesD1[closesD1.length - 1];
      if (lastAtr && lastClose > 0) {
        natrD1 = lastAtr / lastClose;
      }
    }
  }

  return { d1Phase, natrD1 };
}

/**
 * Kiểm tra Chế độ Ngủ đông khi Sideway (Chop Sleep Mode)
 */
export function checkChopSleepMode(candlesH1, config, symbol) {
  if (!candlesH1 || candlesH1.length < 20) return null;
  const isChopModeEnabled = config.regime?.enableChopSleepMode !== false && config.enableChopSleepMode !== false;
  if (!isChopModeEnabled) return null;

  const minADX = config.minH1ADX || config.regime?.minH1ADX || 20;
  const adxSeries = calculateADX(candlesH1, 14);
  const curADX = adxSeries && adxSeries.length > 0 ? adxSeries[adxSeries.length - 1].adx : null;

  if (curADX !== null && curADX <= minADX) {
    return {
      isBlocked: true,
      blockReason: `CHOP_SLEEP_MODE: H1 ADX (${curADX.toFixed(1)}) <= ${minADX} (Thị trường đi ngang -> Chỉ Zone Reaction còn hoạt động)`,
      symbol
    };
  }

  const minAtrRatio = config.minAtrCompressionRatio || config.regime?.minAtrCompressionRatio || 0.70;
  const atrRatio = calculateATRCompression(candlesH1, 14, 50);
  if (atrRatio !== null && atrRatio < minAtrRatio) {
    return {
      isBlocked: true,
      blockReason: `VOLATILITY_COMPRESSED: Tỷ số nén ATR (${atrRatio.toFixed(2)}) < ${minAtrRatio} (Biến động co thắt -> Chỉ Zone Reaction còn hoạt động)`,
      symbol
    };
  }

  return null;
}

/**
 * Đo lường đà biến động nhanh trong N nến H4 gần nhất
 */
export function analyzeRecentMomentum(candlesH4, lookbackBars = 6, thresholdPct = 4) {
  if (!candlesH4 || candlesH4.length <= lookbackBars) {
    return { recentMovePct: 0, isActiveDownMove: false, isActiveUpMove: false };
  }
  const lastClose = candlesH4[candlesH4.length - 1].close;
  const refClose = candlesH4[candlesH4.length - 1 - lookbackBars].close;
  const recentMovePct = (lastClose - refClose) / refClose * 100;
  return {
    recentMovePct,
    isActiveDownMove: recentMovePct <= -thresholdPct,
    isActiveUpMove: recentMovePct >= thresholdPct
  };
}

/**
 * Độ tươi của nến H4: số nến M15 đã trôi qua kể từ lúc H4 đóng. Kane chỉ chạy trong
 * `maxBars` nến đầu (cửa sổ rộng hơn làm PF giảm: bảng quét 4/6/8/10/16 trong docs).
 */
export function computeH4Freshness(curM15CloseTime, lastH4CloseTime, maxBars) {
  const bars = Math.round((curM15CloseTime - lastH4CloseTime) / (15 * 60 * 1000));
  return { bars, isFresh: bars >= 0 && bars <= maxBars };
}

/**
 * Phiên giao dịch (giờ UTC của nến M15 hiện tại). Phiên Á (00-07) đi ngang/tạo mồi: backtest 1 năm
 * PF 0.58, đa năm 2021-26 bỏ 00-07 làm PF 1.06 -> 1.17. endHour = 24 nghĩa là tới hết ngày.
 */
export function isInTradingSession(tsMs, startHour, endHour) {
  const h = new Date(tsMs).getUTCHours();
  return h >= startHour && h < endHour;
}

/**
 * Xu hướng theo cấu trúc (Pat): nến ĐÓNG CỬA phá swing high chưa bị phá -> +1 (tăng); phá swing low -> -1 (giảm).
 * Swing xác nhận bằng `L` nến mỗi bên. 0 = chưa có BOS nào / thiếu dữ liệu.
 */
export function computeStructTrend(candles, L = 3) {
  if (!candles || candles.length < 4 * L) return 0;
  let sh = null, sl = null, trend = 0;
  const brokenH = new Set(), brokenL = new Set();
  for (let i = 2 * L; i < candles.length; i++) {
    const p = i - L;
    const isHigh = [...Array(L).keys()].every(d => candles[p].high > candles[p - 1 - d].high && candles[p].high > candles[p + 1 + d].high);
    const isLow = [...Array(L).keys()].every(d => candles[p].low < candles[p - 1 - d].low && candles[p].low < candles[p + 1 + d].low);
    if (isHigh) sh = { price: candles[p].high, id: p };
    if (isLow) sl = { price: candles[p].low, id: p };
    if (sh && !brokenH.has(sh.id) && candles[i].close > sh.price) { brokenH.add(sh.id); trend = 1; }
    if (sl && !brokenL.has(sl.id) && candles[i].close < sl.price) { brokenL.add(sl.id); trend = -1; }
  }
  return trend;
}
