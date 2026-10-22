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

/**
 * CLASSIFY LIQUIDITY TIERS (ĐỘC QUYỀN SMART MONEY CONCEPT & KANE H4)
 * Phân cấp 2 Tầng Thanh khoản để triệt tiêu xung đột tín hiệu:
 * 
 * - Tier 1: Inducement Zone (Cản con / Bẫy Thanh Khoản - Equal Highs/Lows)
 *   Là nơi giá quét râu nhiều lần nhưng không bứt phá mạnh, tạo cảm giác "cản cứng" cho Retail.
 *   Retail tập trung đặt Limit Short / Buy và gom Stop Loss tại đây.
 *   Cá mập (Smart Money) thường xuyên ĐẨY XUYÊN QUA để quét sạch SL (Liquidity Run).
 *   => NGUYÊN TẮC: TUYỆT ĐỐI KHÔNG BẮT ĐỈNH/ĐÁY TẠI ĐÂY KHI CHƯA CÓ SWEEP!
 * 
 * - Tier 2: Major Key Level (Cản Lớn Cấu Trúc / Institutional Zone)
 *   Là đỉnh/đáy lịch sử hoặc cấu trúc swing lớn của đa khung thời gian (H4 30-90 nến).
 *   Cá mập dùng cú đẩy xuyên qua Tier 1 để khớp lệnh khối lượng lớn tại Tier 2.
 *   => NGUYÊN TẮC: KHI GIÁ QUÉT QUA TIER 1, CHẠM TIER 2 VÀ ĐỂ LẠI RÂU NẾN H4 TỪ CHỐI (WICK >= 35%)
 *      THÌ ĐÂY MỚI LÀ ĐIỂM VÀO ĐẢO CHIỀU VIP CỦA SMART MONEY!
 * 
 * @param {Array<{high: number, low: number, close: number, open: number, ts: number}>} candlesH4
 * @param {number} curPrice
 * @param {object} options
 * @returns {object}
 */
export function classifyLiquidityTiers(candlesH4, curPrice, options = {}) {
  const {
    clusterTolerance = 0.008, // 0.8% biên độ xem là Equal Highs / Equal Lows
    macroLookback = 60,
    wickRejectionThreshold = 0.35
  } = options;

  if (!candlesH4 || candlesH4.length < 15) {
    return {
      tier1Highs: [],
      tier1Lows: [],
      tier2MajorHigh: null,
      tier2MajorLow: null,
      isInducementTrapRisk: false,
      sweepState: 'NONE',
      details: null
    };
  }

  const recentCandles = candlesH4.slice(-macroLookback);
  const pivots = findFractalPivots(recentCandles, 2, 2);

  const pivotHighs = pivots.filter(p => p.type === 'HIGH').map(p => p.price);
  const pivotLows = pivots.filter(p => p.type === 'LOW').map(p => p.price);

  // 1. Phân cụm các đỉnh (Highs) để tìm Equal Highs (Tier 1 Inducement)
  const tier1Highs = [];
  const sortedHighs = [...pivotHighs].sort((a, b) => a - b);
  const usedHighIdx = new Set();

  for (let i = 0; i < sortedHighs.length; i++) {
    if (usedHighIdx.has(i)) continue;
    const base = sortedHighs[i];
    const cluster = [base];
    usedHighIdx.add(i);

    for (let j = i + 1; j < sortedHighs.length; j++) {
      if (usedHighIdx.has(j)) continue;
      if (Math.abs(sortedHighs[j] - base) / base <= clusterTolerance) {
        cluster.push(sortedHighs[j]);
        usedHighIdx.add(j);
      }
    }

    if (cluster.length >= 2) {
      const avgPrice = cluster.reduce((a, b) => a + b, 0) / cluster.length;
      const maxPrice = Math.max(...cluster);
      const minPrice = Math.min(...cluster);
      tier1Highs.push({ avgPrice, minPrice, maxPrice, touchCount: cluster.length });
    }
  }

  // 2. Phân cụm các đáy (Lows) để tìm Equal Lows (Tier 1 Inducement Floor)
  const tier1Lows = [];
  const sortedLows = [...pivotLows].sort((a, b) => a - b);
  const usedLowIdx = new Set();

  for (let i = 0; i < sortedLows.length; i++) {
    if (usedLowIdx.has(i)) continue;
    const base = sortedLows[i];
    const cluster = [base];
    usedLowIdx.add(i);

    for (let j = i + 1; j < sortedLows.length; j++) {
      if (usedLowIdx.has(j)) continue;
      if (Math.abs(sortedLows[j] - base) / base <= clusterTolerance) {
        cluster.push(sortedLows[j]);
        usedLowIdx.add(j);
      }
    }

    if (cluster.length >= 2) {
      const avgPrice = cluster.reduce((a, b) => a + b, 0) / cluster.length;
      const maxPrice = Math.max(...cluster);
      const minPrice = Math.min(...cluster);
      tier1Lows.push({ avgPrice, minPrice, maxPrice, touchCount: cluster.length });
    }
  }

  // 3. Xác định Tier 2 Major Structural Levels
  const maxHigh = Math.max(...recentCandles.map(c => c.high));
  const minLow = Math.min(...recentCandles.map(c => c.low));

  const tier2MajorHigh = maxHigh > curPrice ? maxHigh : null;
  const tier2MajorLow = minLow < curPrice ? minLow : null;

  // 4. Đánh giá trạng thái Sweep & Bẫy Inducement đối với nến H4 gần nhất
  const lastH4 = candlesH4[candlesH4.length - 1];
  const lastAnatomy = analyzeCandle(lastH4);

  let isInducementTrapRisk = false;
  let sweepState = 'NONE';
  let details = null;

  // Kiểm tra cản trên (Resistances & Bearish Sweep)
  const nearestTier1High = tier1Highs
    .filter(c => c.maxPrice >= curPrice * 0.985 && c.minPrice <= curPrice * 1.025)
    .sort((a, b) => Math.abs(a.avgPrice - curPrice) - Math.abs(b.avgPrice - curPrice))[0];

  if (nearestTier1High) {
    const hasSweptAbove = lastH4.high > nearestTier1High.maxPrice;
    if (!hasSweptAbove && curPrice <= nearestTier1High.maxPrice && curPrice >= nearestTier1High.minPrice * 0.995) {
      isInducementTrapRisk = true;
      sweepState = 'INDUCEMENT_TRAP_HIGH';
      details = {
        levelType: 'TIER_1_EQH',
        zonePrice: nearestTier1High.avgPrice,
        touchCount: nearestTier1High.touchCount,
        warning: 'Giá đang nén tại cản con (Equal Highs). Nguy cơ cao Smart Money quét đỉnh trước khi xả!'
      };
    } else if (hasSweptAbove) {
      const sweptNearMajor = tier2MajorHigh ? (lastH4.high >= tier2MajorHigh * 0.995) : false;
      const isRejection = lastAnatomy.upperWickRatio >= wickRejectionThreshold || lastH4.close < nearestTier1High.maxPrice;

      if (isRejection || sweptNearMajor) {
        sweepState = 'BEARISH_SWEEP_CONFIRMED';
        details = {
          levelType: 'TIER_2_SWEEP_SUCCESS',
          sweptInducement: nearestTier1High.maxPrice,
          majorHigh: tier2MajorHigh,
          upperWickRatio: lastAnatomy.upperWickRatio,
          note: 'Smart Money đã quét sạch SL đội Short Inducement và chạm cản lớn Tier 2. Vùng Short an toàn!'
        };
      }
    }
  }

  // Symmetrically Kiểm tra cản dưới (Supports & Bullish Sweep)
  const nearestTier1Low = tier1Lows
    .filter(c => c.minPrice <= curPrice * 1.015 && c.maxPrice >= curPrice * 0.975)
    .sort((a, b) => Math.abs(a.avgPrice - curPrice) - Math.abs(b.avgPrice - curPrice))[0];

  if (nearestTier1Low) {
    const hasSweptBelow = lastH4.low < nearestTier1Low.minPrice;
    if (!hasSweptBelow && curPrice >= nearestTier1Low.minPrice && curPrice <= nearestTier1Low.maxPrice * 1.005) {
      isInducementTrapRisk = true;
      sweepState = 'INDUCEMENT_TRAP_LOW';
      details = {
        levelType: 'TIER_1_EQL',
        zonePrice: nearestTier1Low.avgPrice,
        touchCount: nearestTier1Low.touchCount,
        warning: 'Giá đang nén tại đáy con (Equal Lows). Nguy cơ cao Smart Money quét đáy trước khi hồi!'
      };
    } else if (hasSweptBelow) {
      const sweptNearMajor = tier2MajorLow ? (lastH4.low <= tier2MajorLow * 1.005) : false;
      const isRejection = lastAnatomy.lowerWickRatio >= wickRejectionThreshold || lastH4.close > nearestTier1Low.minPrice;

      if (isRejection || sweptNearMajor) {
        sweepState = 'BULLISH_SWEEP_CONFIRMED';
        details = {
          levelType: 'TIER_2_SWEEP_SUCCESS',
          sweptInducement: nearestTier1Low.minPrice,
          majorLow: tier2MajorLow,
          lowerWickRatio: lastAnatomy.lowerWickRatio,
          note: 'Smart Money đã quét sạch SL đội Long Inducement và chạm hỗ trợ lớn Tier 2. Vùng Long an toàn!'
        };
      }
    }
  }

  // 5. Kiểm tra Quét râu Đỉnh/Đáy nến H4 liền kề trước (Previous Bar High / Low Sweep - PBH / PBL)
  const prevH4 = candlesH4.length >= 2 ? candlesH4[candlesH4.length - 2] : null;
  if (prevH4 && sweepState === 'NONE') {
    // Quét đỉnh nến trước (PBH Sweep: Cần râu trên >= 40% để xác nhận từ chối giá quyết liệt)
    if (lastH4.high > prevH4.high && lastAnatomy.upperWickRatio >= 0.40 && lastH4.close <= prevH4.high) {
      sweepState = 'BEARISH_SWEEP_CONFIRMED';
      details = {
        levelType: 'PREVIOUS_BAR_HIGH_SWEEP',
        sweptPrice: prevH4.high,
        upperWickRatio: lastAnatomy.upperWickRatio,
        note: `Smart Money quét đỉnh nến H4 trước (${prevH4.high}) tạo râu trên từ chối ${(lastAnatomy.upperWickRatio * 100).toFixed(1)}%!`
      };
    }
    // Quét đáy nến trước (PBL Sweep: Cần râu dưới >= 40% để xác nhận rút chân quyết liệt)
    else if (lastH4.low < prevH4.low && lastAnatomy.lowerWickRatio >= 0.40 && lastH4.close >= prevH4.low) {
      sweepState = 'BULLISH_SWEEP_CONFIRMED';
      details = {
        levelType: 'PREVIOUS_BAR_LOW_SWEEP',
        sweptPrice: prevH4.low,
        lowerWickRatio: lastAnatomy.lowerWickRatio,
        note: `Smart Money quét đáy nến H4 trước (${prevH4.low}) tạo râu dưới rút chân ${(lastAnatomy.lowerWickRatio * 100).toFixed(1)}%!`
      };
    }
  }

  return {
    tier1Highs,
    tier1Lows,
    tier2MajorHigh,
    tier2MajorLow,
    isInducementTrapRisk,
    sweepState,
    details
  };
}

/**
 * Phát hiện Khối Lượng Hấp Thụ (Volume Absorption / VSA Climax)
 * @param {Array<{high: number, low: number, close: number, open: number, vol: number}>} candles
 * @param {number} targetIndex - Mặc định nến cuối cùng
 * @param {number} volMultiplier - Mặc định 1.5 (Volume >= 1.5x SMA20)
 * @param {number} wickThreshold - Mặc định 0.35 (Râu >= 35%)
 * @returns {{ isAbsorption: boolean, type: 'BULLISH'|'BEARISH'|null, volRatio: number, currentVol: number, avgVol: number, details: string|null }}
 */
export function detectVolumeAbsorption(candles, targetIndex = -1, volMultiplier = 1.5, wickThreshold = 0.35) {
  if (!candles || candles.length < 15) {
    return { isAbsorption: false, type: null, volRatio: 1, currentVol: 0, avgVol: 0, details: null };
  }
  const idx = targetIndex === -1 || targetIndex >= candles.length ? candles.length - 1 : targetIndex;
  const candle = candles[idx];
  const anatomy = analyzeCandle(candle);

  // Tính Volume SMA20
  const slice = candles.slice(Math.max(0, idx - 20), idx);
  if (slice.length < 5) {
    return { isAbsorption: false, type: null, volRatio: 1, currentVol: candle.vol || 0, avgVol: 0, details: null };
  }
  const avgVol = slice.reduce((sum, c) => sum + (c.vol || 0), 0) / slice.length;
  const currentVol = candle.vol || 0;
  const volRatio = avgVol > 0 ? currentVol / avgVol : 1;

  if (volRatio >= volMultiplier) {
    if (anatomy.lowerWickRatio >= wickThreshold) {
      return {
        isAbsorption: true,
        type: 'BULLISH',
        volRatio: parseFloat(volRatio.toFixed(2)),
        currentVol,
        avgVol,
        details: `Selling Climax: Khối lượng bán đột biến (${volRatio.toFixed(1)}x SMA20) bị hấp thụ hoàn toàn, nến rút chân ${(anatomy.lowerWickRatio * 100).toFixed(1)}%`
      };
    }
    if (anatomy.upperWickRatio >= wickThreshold) {
      return {
        isAbsorption: true,
        type: 'BEARISH',
        volRatio: parseFloat(volRatio.toFixed(2)),
        currentVol,
        avgVol,
        details: `Buying Climax: Khối lượng mua đột biến (${volRatio.toFixed(1)}x SMA20) bị chặn lại, nến xả râu trên ${(anatomy.upperWickRatio * 100).toFixed(1)}%`
      };
    }
  }

  return { isAbsorption: false, type: null, volRatio: parseFloat(volRatio.toFixed(2)), currentVol, avgVol, details: null };
}

/**
 * Nhận diện Quét Thanh Khoản Đỉnh/Đáy nến H4 Liền Kề (Previous Bar High / Low Sweep)
 * @param {Array<{high: number, low: number, close: number, open: number}>} candles
 * @param {number} wickThreshold - Mặc định 0.35
 * @returns {{ isSweep: boolean, type: 'BULLISH'|'BEARISH'|null, sweptPrice: number|null, wickRatio: number }}
 */
export function detectPreviousBarSweep(candles, wickThreshold = 0.35) {
  if (!candles || candles.length < 2) {
    return { isSweep: false, type: null, sweptPrice: null, wickRatio: 0 };
  }
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const anatomy = analyzeCandle(last);

  // Bullish Sweep of Previous Low (Quét râu đáy nến trước)
  if (last.low < prev.low && (anatomy.lowerWickRatio >= wickThreshold || last.close >= prev.low)) {
    return {
      isSweep: true,
      type: 'BULLISH',
      sweptPrice: prev.low,
      wickRatio: anatomy.lowerWickRatio
    };
  }

  // Bearish Sweep of Previous High (Quét râu đỉnh nến trước)
  if (last.high > prev.high && (anatomy.upperWickRatio >= wickThreshold || last.close <= prev.high)) {
    return {
      isSweep: true,
      type: 'BEARISH',
      sweptPrice: prev.high,
      wickRatio: anatomy.upperWickRatio
    };
  }

  return { isSweep: false, type: null, sweptPrice: null, wickRatio: 0 };
}




