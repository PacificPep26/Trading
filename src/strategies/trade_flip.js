/**
 * TRADE_FLIP.JS
 * Module Giao Dịch Đảo Chiều Hai Chiều (Bi-directional Trade Flip Engine).
 * 
 * Logic thông minh của Pro Trader:
 * - Khi vị thế Long vừa chạm Take Profit tại Cản Lớn $\rightarrow$ Chốt lời bỏ túi $2R$ - $3R$.
 * - NGAY TẠI CẢN ĐÓ: Lập tức kích hoạt radar rình Short đảo chiều (Trade Flip).
 * - Khi nến M15 xác nhận từ chối tại cản vừa chốt $\rightarrow$ Mở lệnh Short ngay tại đỉnh, ăn con sóng rơi ngược lại!
 */

import { analyzeCandle } from '../indicators.js';

// Bộ nhớ theo dõi các mốc cản vừa chốt lời thành công
const activeFlipWatches = new Map();

/**
 * Đăng ký mốc cản vừa chốt lời thành công để rình đảo chiều
 * @param {string} symbol 
 * @param {string} closedDirection - 'LONG' hoặc 'SHORT'
 * @param {number} exitPrice 
 * @param {number} exitTime 
 */
export function registerTakeProfitHit(symbol, closedDirection, exitPrice, exitTime = Date.now()) {
  const flipDirection = closedDirection === 'LONG' ? 'SHORT' : 'LONG';
  activeFlipWatches.set(symbol, {
    symbol,
    closedDirection,
    flipDirection,
    keyLevelPrice: exitPrice,
    hitTime: exitTime,
    expiryTime: exitTime + (8 * 15 * 60 * 1000) // Theo dõi trong 8 nến M15 (2 tiếng)
  });
}

/**
 * Kiểm tra xem có cơ hội vào lệnh đảo chiều (Trade Flip) tại cản vừa chốt lời không
 */
export function evaluateTradeFlipOpportunity({
  symbol,
  candles15m,
  candlesH1,
  atrH1,
  config = {}
}) {
  const watch = activeFlipWatches.get(symbol);
  if (!watch) return null;

  if (!candles15m || candles15m.length < 5) return null;
  const curM15 = candles15m[candles15m.length - 1];
  const prevM15 = candles15m[candles15m.length - 2];
  const curPrice = curM15.close;

  // Hết hạn theo dõi (quá 2 tiếng)
  if (curM15.ts > watch.expiryTime) {
    activeFlipWatches.delete(symbol);
    return null;
  }

  const atr = atrH1 || (curPrice * 0.01);
  const keyLevel = watch.keyLevelPrice;
  const distToKeyLevel = Math.abs(curPrice - keyLevel) / keyLevel;

  // Giá phải nằm trong vùng cản (+- 1.2%)
  if (distToKeyLevel > 0.015) return null;

  const m15Anatomy = analyzeCandle(curM15);

  // ==============================================================
  // KỊCH BẢN 1: FLIP SANG SHORT (Vừa chốt lời Long tại Kháng cự xong)
  // ==============================================================
  if (watch.flipDirection === 'SHORT') {
    // Từ chối thật sự: râu trên + thân đỏ, hoặc nến đỏ phá đáy nến trước
    const hasUpperWick = m15Anatomy.upperWickRatio >= 0.35 && curM15.close < curM15.open;
    const isM15Red = curM15.close < curM15.open && curM15.close < prevM15.low;

    if (hasUpperWick || isM15Red) {
      const entry = curPrice;
      const stopLoss = Math.max(curM15.high, keyLevel) + (atr * 0.5);
      const riskDist = stopLoss - entry;

      if (riskDist > 0 && (riskDist / entry) <= 0.03) {
        // TP nhắm về nhịp hồi tối thiểu 2R
        const takeProfit = entry - (riskDist * 2.2);
        const riskReward = 2.2;

        activeFlipWatches.delete(symbol); // Đã kích hoạt xong -> Xóa watch
        return {
          strategy: 'TRADE_FLIP_SHORT',
          direction: 'SHORT',
          symbol,
          entry,
          stopLoss: parseFloat(stopLoss.toFixed(4)),
          takeProfit: parseFloat(takeProfit.toFixed(4)),
          riskReward,
          reason: `TRADE_FLIP_SHORT: Chốt lời Long xong bắt ngay đảo chiều Short tại cản ${keyLevel.toFixed(2)}$ (M15 rút râu ${(m15Anatomy.upperWickRatio * 100).toFixed(1)}%), TP hướng về ${takeProfit.toFixed(2)}$ (RR 1:${riskReward})`,
          qualityScore: 92,
          qualityReasons: ['Đảo chiều thông minh ngay tại cản vừa Take Profit', 'Từ chối giá rút râu nến M15', 'Khai thác tối đa nhịp sóng 2 chiều'],
          triggerTime: curM15.ts
        };
      }
    }
  }

  // ==============================================================
  // KỊCH BẢN 2: FLIP SANG LONG (Vừa chốt lời Short tại Hỗ trợ xong)
  // ==============================================================
  if (watch.flipDirection === 'LONG') {
    const hasLowerWick = m15Anatomy.lowerWickRatio >= 0.35 && curM15.close > curM15.open;
    const isM15Green = curM15.close > curM15.open && curM15.close > prevM15.high;

    if (hasLowerWick || isM15Green) {
      const entry = curPrice;
      const stopLoss = Math.min(curM15.low, keyLevel) - (atr * 0.5);
      const riskDist = entry - stopLoss;

      if (riskDist > 0 && (riskDist / entry) <= 0.03) {
        const takeProfit = entry + (riskDist * 2.2);
        const riskReward = 2.2;

        activeFlipWatches.delete(symbol);
        return {
          strategy: 'TRADE_FLIP_LONG',
          direction: 'LONG',
          symbol,
          entry,
          stopLoss: parseFloat(stopLoss.toFixed(4)),
          takeProfit: parseFloat(takeProfit.toFixed(4)),
          riskReward,
          reason: `TRADE_FLIP_LONG: Chốt lời Short xong bắt ngay hồi phục Long tại hỗ trợ ${keyLevel.toFixed(2)}$ (M15 rút chân ${(m15Anatomy.lowerWickRatio * 100).toFixed(1)}%), TP hướng về ${takeProfit.toFixed(2)}$ (RR 1:${riskReward})`,
          qualityScore: 92,
          qualityReasons: ['Đảo chiều thông minh ngay tại hỗ trợ vừa Take Profit', 'Rút chân từ chối giá sâu', 'Khai thác tối đa nhịp sóng 2 chiều'],
          triggerTime: curM15.ts
        };
      }
    }
  }

  return null;
}

