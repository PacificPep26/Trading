/**
 * MACRO_RANGE.JS
 * Module Nhận Diện Hộp Vĩ Mô (300 Nến H4/D1) và Giao Dịch Phản Ứng Biên Hộp (Macro Range Fade).
 * 
 * Khắc phục tư duy máy móc:
 * - Khi giá tiếp cận Trần Hộp (Range High): Cho phép SHORT đảo chiều ăn sóng lớn, gỡ bỏ lệnh cấm cản tàu của EMA.
 * - Khi giá tiếp cận Sàn Hộp (Range Low): Cho phép LONG bắt đáy rút râu, ăn trọn sóng kéo lên trục giữa (Equilibrium).
 */

import { findFractalPivots, analyzeCandle } from '../indicators.js';

/**
 * Tự động phát hiện chiếc hộp vĩ mô từ dữ liệu tối đa 300 nến
 * @param {Array} candlesH4 - Mảng nến 4H (lên tới 300 nến)
 * @param {Array} candlesD1 - Mảng nến 1D (nếu có)
 * @param {number} lookback - Số nến quét (mặc định 300 nến H4 ~ 50 ngày)
 * @returns {object|null}
 */
export function detectMacroRangeBox(candlesH4, candlesD1 = [], lookback = 300) {
  if (!candlesH4 || candlesH4.length < 30) return null;

  const windowH4 = candlesH4.slice(-lookback);
  const curPrice = windowH4[windowH4.length - 1].close;

  // 1. Tìm các đỉnh đáy Fractal lớn (L=3, R=3) trên H4
  const pivots = findFractalPivots(windowH4, 3, 3);
  const highs = pivots.filter(p => p.type === 'HIGH').map(p => p.price);
  const lows = pivots.filter(p => p.type === 'LOW').map(p => p.price);

  if (highs.length < 2 || lows.length < 2) {
    // Fallback nếu ít pivot: lấy min/max 80% biên độ
    const allHighs = windowH4.map(c => c.high);
    const allLows = windowH4.map(c => c.low);
    const maxHigh = Math.max(...allHighs);
    const minLow = Math.min(...allLows);
    return {
      rangeHigh: maxHigh,
      rangeLow: minLow,
      equilibrium: (maxHigh + minLow) / 2,
      rangeSpanPct: (maxHigh - minLow) / minLow,
      touchesHigh: 1,
      touchesLow: 1,
      isEstablishedRange: true
    };
  }

  // 2. Gom cụm đỉnh Range High và cụm đáy Range Low
  // Range High là mức trần được tôn trọng nhất ở phần trên
  const sortedHighs = [...highs].sort((a, b) => b - a);
  const topHigh = sortedHighs[0];
  // Gom các đỉnh nằm trong vòng 2.5% của đỉnh cao nhất
  const rangeHighCluster = sortedHighs.filter(h => Math.abs(topHigh - h) / topHigh <= 0.025);
  const rangeHigh = rangeHighCluster.reduce((s, h) => s + h, 0) / rangeHighCluster.length;

  const sortedLows = [...lows].sort((a, b) => a - b);
  const bottomLow = sortedLows[0];
  // Gom các đáy nằm trong vòng 2.5% của đáy thấp nhất
  const rangeLowCluster = sortedLows.filter(l => Math.abs(bottomLow - l) / bottomLow <= 0.025);
  const rangeLow = rangeLowCluster.reduce((s, l) => s + l, 0) / rangeLowCluster.length;

  const rangeHeight = rangeHigh - rangeLow;
  const rangeSpanPct = rangeHeight / rangeLow;

  // Nếu hộp quá hẹp (< 8%) thì không phải Macro Range
  if (rangeSpanPct < 0.08) return null;

  const equilibrium = (rangeHigh + rangeLow) / 2;

  // Đếm số lần giá chạm trần/sàn trong quá khứ
  let touchesHigh = 0;
  let touchesLow = 0;
  for (const c of windowH4) {
    if (c.high >= rangeHigh * 0.985) touchesHigh++;
    if (c.low <= rangeLow * 1.015) touchesLow++;
  }

  return {
    rangeHigh: parseFloat(rangeHigh.toFixed(4)),
    rangeLow: parseFloat(rangeLow.toFixed(4)),
    equilibrium: parseFloat(equilibrium.toFixed(4)),
    rangeHeight: parseFloat(rangeHeight.toFixed(4)),
    rangeSpanPct: parseFloat((rangeSpanPct * 100).toFixed(2)),
    touchesHigh,
    touchesLow,
    isEstablishedRange: (touchesHigh >= 2 || touchesLow >= 2)
  };
}

/**
 * Đánh giá phản ứng tại 2 biên hộp Macro Range (Bi-directional Fade)
 */
export function evaluateMacroRangeFade({
  symbol,
  candlesH4,
  candlesH1,
  candlesM15,
  macroRange,
  atrH1,
  config = {}
}) {
  if (!macroRange || !macroRange.isEstablishedRange) return null;
  if (!candlesM15 || candlesM15.length < 5) return null;

  const curM15 = candlesM15[candlesM15.length - 1];
  const prevM15 = candlesM15[candlesM15.length - 2];
  const curPrice = curM15.close;
  const lastH1 = candlesH1 && candlesH1.length > 0 ? candlesH1[candlesH1.length - 1] : null;
  const lastH4 = candlesH4 && candlesH4.length > 0 ? candlesH4[candlesH4.length - 1] : null;

  const h1Anatomy = lastH1 ? analyzeCandle(lastH1) : null;
  const m15Anatomy = analyzeCandle(curM15);

  const atr = atrH1 || (curPrice * 0.01);

  // ==============================================================
  // KỊCH BẢN 1: SHORT TẠI TRẦN HỘP VĨ MÔ (RANGE HIGH SHORT)
  // Ví dụ HYPE khi chạm vùng kháng cự hộp tím 92.5 - 97$
  // Chỉ Short khi trần hộp đã được xác lập ít nhất 2 lần (chống short đỉnh ATH)
  // ==============================================================
  const rangeHighZone = macroRange.rangeHigh - (macroRange.rangeHeight * 0.18);
  const isNearRangeHigh = curPrice >= rangeHighZone;
  const didSweepRangeHigh = (lastH4 && lastH4.high >= macroRange.rangeHigh) || (lastH1 && lastH1.high >= macroRange.rangeHigh) || (curM15.high >= macroRange.rangeHigh);

  if ((isNearRangeHigh || didSweepRangeHigh) && macroRange.touchesHigh >= 2) {
    // Tín hiệu từ chối: Nến rút râu trên hoặc M15 đóng đỏ phá vỡ đáy nến trước
    const hasUpperWickRejection = (h1Anatomy && h1Anatomy.upperWickRatio >= 0.30) || (m15Anatomy.upperWickRatio >= 0.35);
    const isM15Bearish = curM15.close < curM15.open && curM15.close < prevM15.low;

    // Giá đã từng chọc lên trên hoặc sát trần hộp nhưng đóng cửa thụt lùi lại
    const closedBackInside = curPrice <= macroRange.rangeHigh * 1.01;

    if ((hasUpperWickRejection || isM15Bearish) && closedBackInside) {
      const entry = curPrice;
      const recentHighH1 = lastH1 ? Math.max(lastH1.high, curM15.high) : curM15.high;
      const stopLoss = Math.max(recentHighH1, macroRange.rangeHigh) + (atr * 0.4);
      const riskDist = stopLoss - entry;

      if (riskDist > 0 && (riskDist / entry) <= 0.065) {
        // Target tối thượng hướng về Sàn Hộp Vĩ Mô (ăn trọn con sóng 8R - 13R), TP1 là Trục Giữa
        const takeProfit = macroRange.rangeLow + (macroRange.rangeHeight * 0.05);
        const profitDist = entry - takeProfit;
        const riskReward = parseFloat((profitDist / riskDist).toFixed(2));

        if (riskReward >= 1.5) {
          return {
            strategy: 'MACRO_RANGE_HIGH_SHORT',
            direction: 'SHORT',
            symbol,
            entry,
            stopLoss: parseFloat(stopLoss.toFixed(4)),
            takeProfit: parseFloat(takeProfit.toFixed(4)),
            tp1: parseFloat((macroRange.equilibrium * 1.005).toFixed(4)),
            riskReward,
            reason: `MACRO_RANGE_HIGH_SHORT: Phản ứng từ chối tại Vùng Cung Hộp Vĩ Mô ${rangeHighZone.toFixed(2)}$ - ${macroRange.rangeHigh}$ (Râu trên: ${(m15Anatomy.upperWickRatio * 100).toFixed(1)}%), TP1 Trục Giữa ${macroRange.equilibrium}$, TP2 Sàn Hộp ${takeProfit.toFixed(2)}$ (RR 1:${riskReward})`,
            qualityScore: 90,
            qualityReasons: ['Chạm Vùng Cung Hộp Đa Tháng (Range High Zone)', 'Từ chối giá rút râu trên', 'Target rộng về Sàn Hộp'],
            triggerTime: curM15.ts
          };
        }
      }
    }
  }

  // ==============================================================
  // KỊCH BẢN 2: LONG TẠI SÀN HỘP VĨ MÔ (RANGE LOW LONG)
  // Ví dụ HYPE khi chạm vùng cầu 74 - 79.4$
  // Chỉ Long khi sàn hộp đã được xác lập ít nhất 2 lần
  // ==============================================================
  const rangeLowZone = macroRange.rangeLow + (macroRange.rangeHeight * 0.18);
  const isNearRangeLow = curPrice <= rangeLowZone;
  const didSweepRangeLow = (lastH4 && lastH4.low <= macroRange.rangeLow) || (lastH1 && lastH1.low <= macroRange.rangeLow) || (curM15.low <= macroRange.rangeLow);

  if ((isNearRangeLow || didSweepRangeLow) && macroRange.touchesLow >= 2) {
    // Tín hiệu đảo chiều tăng: Nến rút râu dưới hoặc M15 đóng xanh vượt đỉnh nến trước
    const hasLowerWickRejection = (h1Anatomy && h1Anatomy.lowerWickRatio >= 0.30) || (m15Anatomy.lowerWickRatio >= 0.35);
    const isM15Bullish = curM15.close > curM15.open && curM15.close > prevM15.high;

    // Giá đã từng đâm xuống dưới hoặc sát sàn hộp nhưng đóng cửa rút ngược vào trong
    const closedBackInside = curPrice >= macroRange.rangeLow * 0.99;

    if ((hasLowerWickRejection || isM15Bullish) && closedBackInside) {
      const entry = curPrice;
      const recentLowH1 = lastH1 ? Math.min(lastH1.low, curM15.low) : curM15.low;
      const stopLoss = Math.min(recentLowH1, macroRange.rangeLow) - (atr * 0.4);
      const riskDist = entry - stopLoss;

      if (riskDist > 0 && (riskDist / entry) <= 0.065) {
        // Target tối thượng hướng về Trần Hộp Vĩ Mô (ăn trọn con sóng 8R - 13R), TP1 là Trục Giữa
        const takeProfit = macroRange.rangeHigh - (macroRange.rangeHeight * 0.05);
        const profitDist = takeProfit - entry;
        const riskReward = parseFloat((profitDist / riskDist).toFixed(2));

        if (riskReward >= 1.5) {
          return {
            strategy: 'MACRO_RANGE_LOW_LONG',
            direction: 'LONG',
            symbol,
            entry,
            stopLoss: parseFloat(stopLoss.toFixed(4)),
            takeProfit: parseFloat(takeProfit.toFixed(4)),
            tp1: parseFloat((macroRange.equilibrium * 0.995).toFixed(4)),
            riskReward,
            reason: `MACRO_RANGE_LOW_LONG: Phản ứng rút chân tại Vùng Cầu Hộp Vĩ Mô ${macroRange.rangeLow}$ - ${rangeLowZone.toFixed(2)}$ (Râu dưới: ${(m15Anatomy.lowerWickRatio * 100).toFixed(1)}%), TP1 Trục Giữa ${macroRange.equilibrium}$, TP2 Trần Hộp ${takeProfit.toFixed(2)}$ (RR 1:${riskReward})`,
            qualityScore: 90,
            qualityReasons: ['Chạm Vùng Cầu Hộp Đa Tháng (Range Low Zone)', 'Rút chân từ chối giá thấp', 'Target rộng về Trần Hộp'],
            triggerTime: curM15.ts
          };
        }
      }
    }
  }

  return null;
}

/**
 * Cảnh báo khi giá vào dải 18% sát trần/sàn hộp vĩ mô. Chỉ để người đọc quyết định,
 * không phải tín hiệu vào lệnh (backtest 1 năm: fade biên hộp chưa có lợi thế ổn định).
 * @returns {{zone: 'HIGH'|'LOW', level: number, message: string} | null}
 */
export function buildBoxAlert(symbol, macroRange, price) {
  if (!macroRange || !macroRange.isEstablishedRange || !Number.isFinite(price)) return null;
  const { rangeHigh, rangeLow, equilibrium } = macroRange;
  const height = rangeHigh - rangeLow;
  if (!(height > 0)) return null;
  const f = (n) => Number(n).toFixed(price >= 1000 ? 1 : 2);
  const note = '<i>Chỉ cảnh báo quan sát — bot KHÔNG tự vào lệnh.</i>';
  if (price >= rangeHigh - height * 0.18) {
    return { zone: 'HIGH', level: rangeHigh, price, rangeLow, rangeHigh, equilibrium, message: `📦 <b>${symbol} sát TRẦN hộp vĩ mô</b>
Giá ${f(price)} | Trần ${f(rangeHigh)} | Giữa ${f(equilibrium)} | Sàn ${f(rangeLow)}
Kịch bản Short: chờ quét thủng trần rồi đóng cửa thụt lại; đóng nến trên trần thì bỏ kịch bản.
${note}` };
  }
  if (price <= rangeLow + height * 0.18) {
    return { zone: 'LOW', level: rangeLow, price, rangeLow, rangeHigh, equilibrium, message: `📦 <b>${symbol} sát SÀN hộp vĩ mô</b>
Giá ${f(price)} | Sàn ${f(rangeLow)} | Giữa ${f(equilibrium)} | Trần ${f(rangeHigh)}
Kịch bản Long: chờ quét thủng sàn rồi đóng cửa thụt lại; đóng nến dưới sàn thì bỏ kịch bản.
${note}` };
  }
  return null;
}
