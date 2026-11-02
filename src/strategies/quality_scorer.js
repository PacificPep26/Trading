/**
 * QUALITY_SCORER.JS
 * Chấm điểm chất lượng Setup (0 - 100 điểm) & Tuyển chọn Setup Tinh hoa (Hạng A >= 80 pts).
 * Phạt nặng các setup cạn kiệt Volume hoặc nghịch hướng VSA.
 */

import { analyzeCandle, detectVolumeAbsorption } from '../indicators.js';
import { BOT_CONFIG } from '../config.js';

export function calculateSetupQualityScore({ signal, candlesH4, candlesH1, candlesM15, btcH1Candles = null }) {
  let score = 0;
  const reasons = [];

  const lastM15 = candlesM15 && candlesM15.length > 0 ? candlesM15[candlesM15.length - 1] : null;
  const lastH4 = candlesH4 && candlesH4.length > 0 ? candlesH4[candlesH4.length - 1] : null;
  const anatomyM15 = lastM15 ? analyzeCandle(lastM15) : { lowerWickRatio: 0, upperWickRatio: 0 };
  const anatomyH4 = lastH4 ? analyzeCandle(lastH4) : { lowerWickRatio: 0, upperWickRatio: 0 };
  const isLong = signal ? signal.direction === 'LONG' : true;

  // 1. ĐỘ SẠCH VÀ CHIỀU DÀI RÂU NẾN (WICK PURITY) - Tối đa 25đ
  const wickRatio = isLong 
    ? Math.max(anatomyM15.lowerWickRatio, anatomyH4.lowerWickRatio)
    : Math.max(anatomyM15.upperWickRatio, anatomyH4.upperWickRatio);

  if (wickRatio >= 0.50) {
    score += 25;
    reasons.push(`Râu nến ${(wickRatio * 100).toFixed(0)}% (Xuất sắc)`);
  } else if (wickRatio >= 0.40) {
    score += 20;
    reasons.push(`Râu nến ${(wickRatio * 100).toFixed(0)}% (Tốt)`);
  } else if (wickRatio >= 0.30) {
    score += 15;
    reasons.push(`Râu nến ${(wickRatio * 100).toFixed(0)}% (Chuẩn)`);
  }

  // 2. KHỐI LƯỢNG HẤP THỤ VSA (ĐỒNG PHA HƯỚNG LỆNH) - Tối đa 25đ
  const volM15 = (candlesM15 && candlesM15.length > 0) ? detectVolumeAbsorption(candlesM15, candlesM15.length - 1) : { isAbsorption: false };
  const volH4 = (candlesH4 && candlesH4.length > 0) ? detectVolumeAbsorption(candlesH4, candlesH4.length - 1) : { isAbsorption: false };

  const isBullAbsorption = (volM15.isAbsorption && volM15.type === 'BULLISH') || (volH4.isAbsorption && volH4.type === 'BULLISH');
  const isBearAbsorption = (volM15.isAbsorption && volM15.type === 'BEARISH') || (volH4.isAbsorption && volH4.type === 'BEARISH');

  if (isLong) {
    if (isBullAbsorption) {
      score += 25;
      reasons.push('VSA Selling Climax Absorbed (Lực bán bị triệt tiêu)');
    } else if (isBearAbsorption) {
      score -= 20; // Phạt nặng nếu Long vào nến bị xả đè bẹp
      reasons.push('Cảnh báo: VSA Bearish Rejection đối nghịch lệnh Long');
    }
  } else {
    if (isBearAbsorption) {
      score += 25;
      reasons.push('VSA Buying Climax Absorbed (Lực mua bị chặn đứng)');
    } else if (isBullAbsorption) {
      score -= 20; // Phạt nặng nếu Short vào nến rút chân
      reasons.push('Cảnh báo: VSA Bullish Reversal đối nghịch lệnh Short');
    }
  }

  // Khối lượng M15 tương đối
  if (candlesM15 && candlesM15.length >= 20) {
    const vols = candlesM15.map(c => c.vol);
    const avgVol = vols.slice(-20).reduce((a, b) => a + b, 0) / 20 || 1;
    const volRatio = (vols[vols.length - 1] || 1) / avgVol;
    if (volRatio >= 1.5 && (!isBullAbsorption && !isBearAbsorption)) {
      score += 15;
      reasons.push(`Vol M15 ${volRatio.toFixed(1)}x SMA20`);
    } else if (volRatio >= 1.0 && (!isBullAbsorption && !isBearAbsorption)) {
      score += 10;
    } else if (volRatio < 0.75) {
      score -= 20; // Phạt nặng nến cạn kiệt Volume (< 75% trung bình)
      reasons.push(`Vol M15 cạn kiệt (${volRatio.toFixed(2)}x SMA20)`);
    }
  }

  // 3. CẤP ĐỘ CẢN SMC & FVG (KEY LEVEL & MITIGATION) - Tối đa 25đ
  const sigReason = signal ? (signal.reason || '') : '';
  const sigStrat = signal ? (signal.strategy || '') : '';
  if (sigReason.includes('Major') || sigStrat.includes('ZONE_REACTION')) {
    score += 25;
    reasons.push('Cản Lớn Tier 2');
  } else if (sigReason.includes('FVG') || sigReason.includes('Order Block')) {
    score += 25;
    reasons.push('Retest FVG/OB');
  } else if (sigReason.includes('swept Support') || sigReason.includes('swept Resistance') || sigReason.includes('swept Inducement')) {
    score += 20;
    reasons.push('Liquidity Sweep Cản Thật');
  } else {
    score += 10;
  }

  // 4. SỨC MẠNH TƯƠNG ĐỐI SO VỚI ĐẦU TÀU BTC (RELATIVE STRENGTH) - Tối đa 25đ
  if (BOT_CONFIG.enable12hRS && btcH1Candles && btcH1Candles.length >= 3 && candlesH1 && candlesH1.length >= 3) {
    const lookback = Math.min(12, Math.min(btcH1Candles.length - 1, candlesH1.length - 1));
    const curBtc = btcH1Candles[btcH1Candles.length - 1].close;
    const refBtc = btcH1Candles[btcH1Candles.length - 1 - lookback].close;
    const btcPct = refBtc > 0 ? (curBtc - refBtc) / refBtc : 0;
    const curCoin = candlesH1[candlesH1.length - 1].close;
    const refCoin = candlesH1[candlesH1.length - 1 - lookback].close;
    const coinPct = refCoin > 0 ? (curCoin - refCoin) / refCoin : 0;
    const rsSpread = coinPct - btcPct;
    if (isLong) {
      if (rsSpread >= 0.005) { score += 25; reasons.push(`Khỏe hơn BTC 12H (+${(rsSpread * 100).toFixed(1)}%)`); }
      else if (coinPct > -0.01 || rsSpread >= -0.02) { score += 15; reasons.push('Đồng pha/thoái lui lành mạnh'); }
      else { score += 10; }
    } else {
      if (rsSpread <= -0.005) { score += 25; reasons.push(`Yếu hơn BTC 12H (${(rsSpread * 100).toFixed(1)}%)`); }
      else if (coinPct < 0.01 || rsSpread <= 0.02) { score += 15; reasons.push('Đồng pha/hồi phục lành mạnh'); }
      else { score += 10; }
    }
  } else if (btcH1Candles && btcH1Candles.length >= 2 && candlesH1 && candlesH1.length >= 2) {
    const btcPct = (btcH1Candles[btcH1Candles.length - 1].close - btcH1Candles[btcH1Candles.length - 2].close) / btcH1Candles[btcH1Candles.length - 2].close;
    const coinPct = (candlesH1[candlesH1.length - 1].close - candlesH1[candlesH1.length - 2].close) / candlesH1[candlesH1.length - 2].close;
    if (isLong) {
      if (coinPct > btcPct + 0.003) { score += 25; reasons.push('Khỏe hơn BTC (RS Outperforming)'); }
      else if (coinPct > 0) { score += 15; }
    } else {
      if (coinPct < btcPct - 0.003) { score += 25; reasons.push('Yếu hơn BTC (RS Underperforming)'); }
      else if (coinPct < 0) { score += 15; }
    }
  } else {
    score += 15;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons
  };
}

