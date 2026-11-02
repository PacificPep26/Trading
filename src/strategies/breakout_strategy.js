/**
 * BREAKOUT_STRATEGY.JS
 * Module Bắt Sóng Phá Nền Tích Lũy / Hộp Giá (M15 Volume Breakout & Breakdown).
 * 
 * Khắc phục tư duy trễ sóng:
 * - Khi giá nén trong hộp 12 - 24 giờ rồi bùng nổ: Vào lệnh NGAY LẬP TỨC tại nến M15 phá vỡ kèm Volume >= 2.0x.
 * - Bắt trọn chân sóng (ví dụ HYPE tại 81.5$) thay vì đợi nến H4 đóng cửa lên tận 89.6$.
 */

import { calculateSMA } from '../indicators.js';

/**
 * Đánh giá cơ hội phá vỡ nền tích lũy M15 (Volume Breakout / Breakdown)
 */
export function evaluateVolumeBreakout({
  symbol,
  candles15m,
  candlesH1,
  candlesH4,
  atrH1,
  resistances = [],
  supports = [],
  config = {}
}) {
  if (!candles15m || candles15m.length < 30) return null;

  const curM15 = candles15m[candles15m.length - 1];
  const curPrice = curM15.close;

  // 1. Kiểm tra Volume đột biến của nến M15 hiện tại
  const lookbackVol = 20;
  const volSlice = candles15m.slice(-lookbackVol - 1, -1).map(c => c.vol);
  const avgVol = volSlice.reduce((s, v) => s + v, 0) / volSlice.length;
  if (!avgVol || avgVol <= 0) return null;

  const volRatio = curM15.vol / avgVol;
  const minVolRatio = config.breakoutMinVolRatio || 2.5;
  if (volRatio < minVolRatio) return null;

  // 2. Xác định Chiếc Hộp Nén Tích Lũy (Consolidation Box) trong 32 đến 48 nến M15 trước đó (8 - 12 tiếng)
  const boxBars = config.breakoutBoxBars || 36;
  const boxCandles = candles15m.slice(-boxBars - 1, -1);
  const boxHigh = Math.max(...boxCandles.map(c => c.high));
  const boxLow = Math.min(...boxCandles.map(c => c.low));
  const boxHeight = boxHigh - boxLow;
  const boxSpanPct = boxHeight / boxLow;

  // Hộp nén chuẩn phải có biên độ dao động chặt (thường <= 5.0%)
  if (boxSpanPct > 0.055 || boxSpanPct < 0.008) return null;

  const atr = atrH1 || (curPrice * 0.01);
  const isBearTrend = config.isBearTrend;
  const isBullTrend = config.isBullTrend;
  const marketPhase = config.marketPhase;

  // ==============================================================
  // KỊCH BẢN 1: BULLISH VOLUME BREAKOUT (Phá Vỡ Đỉnh Hộp Bay Lên)
  // Ví dụ HYPE nổ volume phá 81.5$ ngày 29/10
  // Cấm mua Breakout khi thị trường H4/D1 đang xả lũ Strong Downtrend
  // ==============================================================
  if (curM15.close > boxHigh && curM15.close > curM15.open && marketPhase !== 'STRONG_DOWNTREND' && !isBearTrend) {
    const entry = curPrice;
    // Stop Loss đặt dưới mép hộp vừa phá 0.3x ATR hoặc đáy nến breakout
    const stopLoss = Math.max(boxHigh - (atr * 0.3), curM15.low);
    const riskDist = entry - stopLoss;

    if (riskDist > 0 && (riskDist / entry) <= 0.065) {
      // Tìm cản kháng cự mục tiêu
      const validRes = resistances.filter(r => r > entry + (riskDist * 1.5));
      const targetRes = validRes.length > 0 ? validRes[0] : (entry + (riskDist * 2.5));
      const profitDist = targetRes - entry;
      const riskReward = parseFloat((profitDist / riskDist).toFixed(2));

      if (riskReward >= 1.5) {
        return {
          strategy: 'M15_VOLUME_BREAKOUT_LONG',
          direction: 'LONG',
          symbol,
          entry,
          stopLoss: parseFloat(stopLoss.toFixed(4)),
          takeProfit: parseFloat(targetRes.toFixed(4)),
          riskReward,
          reason: `M15_VOLUME_BREAKOUT: Phá vỡ đỉnh hộp tích lũy ${boxHigh.toFixed(2)}$ với Volume bùng nổ ${volRatio.toFixed(1)}x SMA20, TP hướng về Cản ${targetRes.toFixed(2)}$ (RR 1:${riskReward})`,
          qualityScore: 90,
          qualityReasons: ['Phá vỡ hộp tích lũy chặt', `Volume cá mập nổ mạnh ${volRatio.toFixed(1)}x`, 'Vào ngay chân sóng đẩy'],
          triggerTime: curM15.ts
        };
      }
    }
  }

  // ==============================================================
  // KỊCH BẢN 2: BEARISH VOLUME BREAKDOWN (Thủng Sàn Hộp Xả Hàng)
  // Ví dụ HYPE thủng đáy 80$ xả về 74.4$ ngày 21/10
  // ==============================================================
  if (curM15.close < boxLow && curM15.close < curM15.open && marketPhase !== 'STRONG_UPTREND' && !isBullTrend) {
    const entry = curPrice;
    // Stop Loss đặt trên mép sàn hộp vừa thủng 0.3x ATR
    const stopLoss = Math.min(boxLow + (atr * 0.3), curM15.high);
    const riskDist = stopLoss - entry;

    if (riskDist > 0 && (riskDist / entry) <= 0.065) {
      const validSup = supports.filter(s => s < entry - (riskDist * 1.5));
      const targetSup = validSup.length > 0 ? validSup[0] : (entry - (riskDist * 2.5));
      const profitDist = entry - targetSup;
      const riskReward = parseFloat((profitDist / riskDist).toFixed(2));

      if (riskReward >= 1.5) {
        return {
          strategy: 'M15_VOLUME_BREAKDOWN_SHORT',
          direction: 'SHORT',
          symbol,
          entry,
          stopLoss: parseFloat(stopLoss.toFixed(4)),
          takeProfit: parseFloat(targetSup.toFixed(4)),
          riskReward,
          reason: `M15_VOLUME_BREAKDOWN: Xả hàng thủng sàn hộp ${boxLow.toFixed(2)}$ với Volume đột biến ${volRatio.toFixed(1)}x SMA20, TP hướng về Hỗ trợ ${targetSup.toFixed(2)}$ (RR 1:${riskReward})`,
          qualityScore: 90,
          qualityReasons: ['Thủng sàn tích lũy dứt khoát', `Volume xả mạnh ${volRatio.toFixed(1)}x`, 'Bắt đà rơi tự do'],
          triggerTime: curM15.ts
        };
      }
    }
  }

  return null;
}
