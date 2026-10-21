/**
 * INDICATORS.JS
 * Module toán học và chỉ báo thuần túy (Pure Functions).
 * Không phụ thuộc bên ngoài, không có state, đảm bảo tính tất định 100%.
 */

/**
 * Tính Simple Moving Average (SMA)
 * @param {number[]} values - Mảng giá trị
 * @param {number} period - Chu kỳ
 * @returns {number[]} Mảng SMA cùng độ dài (các phần tử đầu không đủ nến là null)
 */
export function calculateSMA(values, period) {
  if (!values || values.length < period) return [];
  const result = new Array(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }
  return result;
}

/**
 * Tính Exponential Moving Average (EMA)
 * @param {number[]} values - Mảng giá trị
 * @param {number} period - Chu kỳ
 * @returns {number[]} Mảng EMA cùng độ dài
 */
export function calculateEMA(values, period) {
  if (!values || values.length < period) return [];
  const result = new Array(values.length).fill(null);
  const k = 2 / (period + 1);

  // Khởi tạo bằng SMA của period phần tử đầu
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let prevEma = sum / period;
  result[period - 1] = prevEma;

  for (let i = period; i < values.length; i++) {
    const currentEma = values[i] * k + prevEma * (1 - k);
    result[i] = currentEma;
    prevEma = currentEma;
  }
  return result;
}

/**
 * Tính True Range (TR) cho một cây nến
 * @param {number} high 
 * @param {number} low 
 * @param {number|null} prevClose 
 * @returns {number}
 */
export function calculateTR(high, low, prevClose) {
  if (prevClose === null || prevClose === undefined) {
    return high - low;
  }
  return Math.max(
    high - low,
    Math.abs(high - prevClose),
    Math.abs(low - prevClose)
  );
}

/**
 * Tính Average True Range (ATR) chuẩn Wilder/EMA
 * @param {Array<{high: number, low: number, close: number}>} candles
 * @param {number} period - Mặc định 14
 * @returns {number[]} Mảng ATR cùng độ dài
 */
export function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return [];
  const trs = new Array(candles.length).fill(0);
  trs[0] = candles[0].high - candles[0].low;

  for (let i = 1; i < candles.length; i++) {
    trs[i] = calculateTR(candles[i].high, candles[i].low, candles[i - 1].close);
  }

  const result = new Array(candles.length).fill(null);
  let trSum = 0;
  for (let i = 0; i < period; i++) {
    trSum += trs[i];
  }
  let prevAtr = trSum / period;
  result[period - 1] = prevAtr;

  for (let i = period; i < candles.length; i++) {
    const currentAtr = (prevAtr * (period - 1) + trs[i]) / period;
    result[i] = currentAtr;
    prevAtr = currentAtr;
  }
  return result;
}

/**
 * Phân tích cấu trúc giải phẫu nến (Thân nến, Râu trên, Râu dưới)
 * @param {{open: number, high: number, low: number, close: number}} candle
 * @returns {object} Chi tiết tỷ lệ % râu và thân
 */
export function analyzeCandle(candle) {
  const range = candle.high - candle.low;
  if (range <= 0) {
    return {
      range: 0,
      body: 0,
      bodyRatio: 0,
      upperWick: 0,
      upperWickRatio: 0,
      lowerWick: 0,
      lowerWickRatio: 0,
      isGreen: false,
      isRed: false
    };
  }

  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;

  return {
    range,
    body,
    bodyRatio: body / range,
    upperWick,
    upperWickRatio: upperWick / range,
    lowerWick,
    lowerWickRatio: lowerWick / range,
    isGreen: candle.close > candle.open,
    isRed: candle.close < candle.open
  };
}

/**
 * Kiểm tra nến Marubozu (dùng cho Khiên BTC Macro 1H)
 * @param {{open: number, high: number, low: number, close: number}} candle
 * @param {number} atr - ATR tại thời điểm nến
 * @param {number} minBodyAtrRatio - Thân nến >= minBodyAtrRatio * ATR (mặc định 0.8)
 * @param {number} minBodyRatio - Thân nến chiếm >= minBodyRatio biên độ nến (mặc định 0.65)
 * @returns {{isBullishMarubozu: boolean, isBearishMarubozu: boolean}}
 */
export function isMarubozu(candle, atr, minBodyAtrRatio = 0.8, minBodyRatio = 0.65) {
  const { body, bodyRatio, isGreen, isRed } = analyzeCandle(candle);
  const isLargeBody = body >= minBodyAtrRatio * atr;
  const isDominantBody = bodyRatio >= minBodyRatio;

  return {
    isBullishMarubozu: isGreen && isLargeBody && isDominantBody,
    isBearishMarubozu: isRed && isLargeBody && isDominantBody
  };
}

/**
 * Tìm các đỉnh đáy cấu trúc (Fractal Pivot High / Low)
 * @param {Array<{high: number, low: number, close: number, ts: number}>} candles
 * @param {number} left - Số nến bên trái (mặc định 2)
 * @param {number} right - Số nến bên phải (mặc định 2)
 * @returns {Array<{index: number, type: 'HIGH'|'LOW', price: number, time: number}>}
 */
export function findFractalPivots(candles, left = 2, right = 2) {
  if (!candles || candles.length < left + right + 1) return [];
  const pivots = [];

  for (let i = left; i < candles.length - right; i++) {
    const currentHigh = candles[i].high;
    const currentLow = candles[i].low;

    let isPivotHigh = true;
    let isPivotLow = true;

    for (let j = 1; j <= left; j++) {
      if (candles[i - j].high >= currentHigh) isPivotHigh = false;
      if (candles[i - j].low <= currentLow) isPivotLow = false;
    }

    for (let j = 1; j <= right; j++) {
      if (candles[i + j].high > currentHigh) isPivotHigh = false;
      if (candles[i + j].low < currentLow) isPivotLow = false;
    }

    if (isPivotHigh) {
      pivots.push({ index: i, type: 'HIGH', price: currentHigh, time: candles[i].ts });
    }
    if (isPivotLow) {
      pivots.push({ index: i, type: 'LOW', price: currentLow, time: candles[i].ts });
    }
  }

  return pivots;
}

/**
 * Tìm các vùng Kháng cự và Hỗ trợ gần nhất từ Fractal Pivots
 * @param {Array} candles
 * @param {number} currentPrice
 * @param {number} left
 * @param {number} right
 * @returns {{nearestResistance: number|null, nearestSupport: number|null, allResistances: number[], allSupports: number[]}}
 */
export function getNearestKeyLevels(candles, currentPrice, left = 2, right = 2) {
  const pivots = findFractalPivots(candles, left, right);
  const resistances = pivots
    .filter(p => p.type === 'HIGH' && p.price > currentPrice)
    .map(p => p.price)
    .sort((a, b) => a - b); // Tăng dần (gần currentPrice nhất lên đầu)

  const supports = pivots
    .filter(p => p.type === 'LOW' && p.price < currentPrice)
    .map(p => p.price)
    .sort((a, b) => b - a); // Giảm dần (gần currentPrice nhất lên đầu)

  return {
    nearestResistance: resistances.length > 0 ? resistances[0] : null,
    nearestSupport: supports.length > 0 ? supports[0] : null,
    allResistances: resistances,
    allSupports: supports
  };
}

/**
 * Tìm các vùng Fair Value Gap (FVG)
 * Bullish FVG: Low của nến [i+1] > High của nến [i-1] (tạo khoảng trống tăng)
 * Bearish FVG: High của nến [i+1] < Low của nến [i-1] (tạo khoảng trống giảm)
 * @param {Array<{open: number, high: number, low: number, close: number, ts: number}>} candles
 * @returns {Array<{type: 'BULLISH'|'BEARISH', startIndex: number, candleIndex: number, endIndex: number, top: number, bottom: number, size: number, time: number, isMitigated: boolean}>}
 */
export function findFairValueGaps(candles) {
  if (!candles || candles.length < 3) return [];
  const fvgs = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const next = candles[i + 1];

    // Bullish FVG
    if (next.low > prev.high) {
      const top = next.low;
      const bottom = prev.high;
      const size = top - bottom;

      // Kiểm tra xem các nến tương lai đã lấp gap chưa
      let isMitigated = false;
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].low <= bottom) {
          isMitigated = true;
          break;
        }
      }

      fvgs.push({
        type: 'BULLISH',
        startIndex: i - 1,
        candleIndex: i,
        endIndex: i + 1,
        top,
        bottom,
        size,
        time: curr.ts,
        isMitigated
      });
    }

    // Bearish FVG
    if (next.high < prev.low) {
      const top = prev.low;
      const bottom = next.high;
      const size = top - bottom;

      let isMitigated = false;
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].high >= top) {
          isMitigated = true;
          break;
        }
      }

      fvgs.push({
        type: 'BEARISH',
        startIndex: i - 1,
        candleIndex: i,
        endIndex: i + 1,
        top,
        bottom,
        size,
        time: curr.ts,
        isMitigated
      });
    }
  }

  return fvgs;
}

/**
 * Phát hiện vùng nén biên độ (Pre-Breakout Squeeze)
 * Điều kiện: ATR_H4 < 0.70 * SMA_20(ATR_H4) VÀ Volume_H4 <= 0.65 * SMA_20(Volume_H4)
 * @param {Array<{high: number, low: number, close: number, vol: number}>} candlesH4
 * @param {number} atrThreshold - Mặc định 0.70
 * @param {number} volThreshold - Mặc định 0.65
 * @returns {{isSqueeze: boolean, atrRatio: number, volRatio: number, currentAtr: number, avgAtr: number, currentVol: number, avgVol: number}}
 */
export function detectSqueeze(candlesH4, atrThreshold = 0.70, volThreshold = 0.65) {
  if (!candlesH4 || candlesH4.length < 25) {
    return { isSqueeze: false, atrRatio: 1, volRatio: 1, currentAtr: 0, avgAtr: 0, currentVol: 0, avgVol: 0 };
  }

  const atrs = calculateATR(candlesH4, 14);
  const validAtrs = atrs.filter(a => a !== null);
  if (validAtrs.length < 20) {
    return { isSqueeze: false, atrRatio: 1, volRatio: 1, currentAtr: 0, avgAtr: 0, currentVol: 0, avgVol: 0 };
  }

  // Lấy 20 giá trị ATR gần nhất trước nến hiện tại
  const recentAtrs = validAtrs.slice(-20);
  const avgAtr = recentAtrs.reduce((acc, v) => acc + v, 0) / recentAtrs.length;
  const currentAtr = validAtrs[validAtrs.length - 1];

  // Tính Volume SMA20
  const volumes = candlesH4.map(c => c.vol || 0);
  const recentVolumes = volumes.slice(-20);
  const avgVol = recentVolumes.reduce((acc, v) => acc + v, 0) / recentVolumes.length;
  const currentVol = volumes[volumes.length - 1];

  const atrRatio = avgAtr > 0 ? currentAtr / avgAtr : 1;
  const volRatio = avgVol > 0 ? currentVol / avgVol : 1;

  const isSqueeze = atrRatio < atrThreshold && volRatio <= volThreshold;

  return {
    isSqueeze,
    atrRatio,
    volRatio,
    currentAtr,
    avgAtr,
    currentVol,
    avgVol
  };
}

/**
 * Chuẩn hóa dữ liệu nến thành cấu trúc Data Contract thống nhất
 * @param {Array|object} raw - Mảng nến thô từ OKX REST API hoặc object nến từ cache/database
 * @returns {{ ts: number, open: number, high: number, low: number, close: number, vol: number, confirm: number }}
 */
export function normalizeCandle(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    // Định dạng OKX API: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
    return {
      ts: parseInt(raw[0], 10),
      open: parseFloat(raw[1]),
      high: parseFloat(raw[2]),
      low: parseFloat(raw[3]),
      close: parseFloat(raw[4]),
      vol: parseFloat(raw[5]),
      confirm: raw[8] !== undefined ? parseInt(raw[8], 10) : 1
    };
  }
  return {
    ts: parseInt(raw.ts, 10),
    open: parseFloat(raw.open),
    high: parseFloat(raw.high),
    low: parseFloat(raw.low),
    close: parseFloat(raw.close),
    vol: parseFloat(raw.vol || 0),
    confirm: raw.confirm !== undefined ? parseInt(raw.confirm, 10) : 1
  };
}

/**
 * Kiểm tra tính hợp lệ của nến theo Data Contract
 * @param {object} candle
 * @returns {boolean}
 */
export function validateCandleSchema(candle) {
  if (!candle || typeof candle !== 'object') return false;
  const fields = ['ts', 'open', 'high', 'low', 'close', 'vol', 'confirm'];
  for (const f of fields) {
    if (typeof candle[f] !== 'number' || Number.isNaN(candle[f])) {
      return false;
    }
  }
  if (candle.ts <= 0 || candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) {
    return false;
  }
  if (candle.confirm !== 0 && candle.confirm !== 1) {
    return false;
  }
  return true;
}


