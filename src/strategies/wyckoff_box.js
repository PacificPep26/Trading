/**
 * WYCKOFF_BOX.JS
 * Hai họ setup trên hộp đa tháng (macroRange), dựng theo docs/strategies (Wyckoff 09/10, Mô hình giá 22):
 *  - Spring / UTAD: giá thò ra ngoài sàn/trần rồi đóng lại bên trong, chờ nến test volume thấp, mới vào.
 *  - Phá hộp + retest (LPS/LPSY): chờ phá thật (đóng cửa ngoài biên + volume) rồi giá quay lại giữ biên mới vào.
 * Không vào giữa hộp (Phase B), không đuổi nến phá đầu tiên. Mặc định TẮT trong config cho tới khi backtest đạt.
 */

import { calculatePositionSize } from './sizing.js';

const H1_MS = 60 * 60 * 1000;
const TP_BUFFER = 0.0025;

const avgVol = (candles, n) => {
  const s = candles.slice(-n);
  return s.length ? s.reduce((t, c) => t + c.vol, 0) / s.length : 0;
};

function boxOf(mr) {
  if (!mr || !mr.isEstablishedRange || mr.touchesHigh < 2 || mr.touchesLow < 2) return null;
  const height = mr.rangeHeight ?? (mr.rangeHigh - mr.rangeLow);
  return height > 0 ? { ...mr, height } : null;
}

// Chọn mục tiêu gần nhất đạt minRR; candidates đã xếp theo thứ tự gần -> xa.
function buildSignal({ symbol, strategy, direction, entry, stopLoss, targets, cur, config, reason }) {
  const risk = Math.abs(entry - stopLoss);
  if (!(risk > 0)) return null;
  const maxSl = config.maxSlDistanceRate || 0.06;
  if (risk / entry > maxSl) return null;
  const minRR = config.minRR || 2.0;
  const long = direction === 'LONG';
  const takeProfit = targets.find(t => (long ? t - entry : entry - t) / risk >= minRR);
  if (takeProfit === undefined) return null;
  const rr = (long ? takeProfit - entry : entry - takeProfit) / risk;
  return {
    strategy, direction, symbol, entry, stopLoss, takeProfit,
    riskReward: parseFloat(rr.toFixed(2)),
    triggerTime: cur.ts,
    sizing: calculatePositionSize(entry, stopLoss, config.riskUsd, config.leverage),
    reason
  };
}

/**
 * Spring (LONG dưới sàn) / UTAD (SHORT trên trần).
 */
export function evaluateWyckoffSpring({ symbol, candlesH1, candlesM15, macroRange, atrH1, d1Phase, config = {} }) {
  const box = boxOf(macroRange);
  if (!box || !candlesH1 || candlesH1.length < 22 || !candlesM15 || candlesM15.length < 22) return null;

  const cur = candlesM15[candlesM15.length - 1];
  const prev = candlesM15[candlesM15.length - 2];
  const atr = atrH1 || cur.close * 0.01;
  const recentH1 = candlesH1.slice(-24);
  const priorM15 = candlesM15.slice(0, -1);
  const lowVol = avgVol(priorM15, 20);

  // Spring: tích lũy lại. Trong downtrend mạnh D1 hộp là phân phối lại -> bỏ.
  if (d1Phase !== 'STRONG_DOWNTREND') {
    const spring = [...recentH1].reverse().find(c => c.low < box.rangeLow * 0.999 && c.close >= box.rangeLow);
    if (spring) {
      const afterM15 = priorM15.filter(c => c.ts >= spring.ts + H1_MS);
      const held = candlesH1.filter(c => c.ts > spring.ts).every(c => c.low > spring.low) && afterM15.every(c => c.low > spring.low);
      const test = afterM15.find(c => c.low <= box.rangeLow * 1.01 && c.vol <= lowVol);
      if (held && test && cur.close > cur.open && cur.close > prev.high && cur.close > box.rangeLow) {
        const sig = buildSignal({
          symbol, strategy: 'WYCKOFF_SPRING_LONG', direction: 'LONG', entry: cur.close,
          stopLoss: spring.low - 0.3 * atr, cur, config,
          targets: [box.equilibrium, box.rangeHigh * (1 - TP_BUFFER)].filter(t => t > cur.close),
          reason: `WYCKOFF_SPRING_LONG: thò dưới sàn hộp ${box.rangeLow} (đáy ${spring.low}) rồi đóng lại, test volume thấp, M15 xác nhận`
        });
        if (sig) return sig;
      }
    }
  }

  // UTAD: phân phối lại. Trong uptrend mạnh D1 hộp là tích lũy lại -> bỏ.
  if (d1Phase !== 'STRONG_UPTREND') {
    const utad = [...recentH1].reverse().find(c => c.high > box.rangeHigh * 1.001 && c.close <= box.rangeHigh);
    if (utad) {
      const afterM15 = priorM15.filter(c => c.ts >= utad.ts + H1_MS);
      const held = candlesH1.filter(c => c.ts > utad.ts).every(c => c.high < utad.high) && afterM15.every(c => c.high < utad.high);
      const test = afterM15.find(c => c.high >= box.rangeHigh * 0.99 && c.vol <= lowVol);
      if (held && test && cur.close < cur.open && cur.close < prev.low && cur.close < box.rangeHigh) {
        const sig = buildSignal({
          symbol, strategy: 'WYCKOFF_UTAD_SHORT', direction: 'SHORT', entry: cur.close,
          stopLoss: utad.high + 0.3 * atr, cur, config,
          targets: [box.equilibrium, box.rangeLow * (1 + TP_BUFFER)].filter(t => t < cur.close),
          reason: `WYCKOFF_UTAD_SHORT: thò trên trần hộp ${box.rangeHigh} (đỉnh ${utad.high}) rồi rơi lại, test volume thấp, M15 xác nhận`
        });
        if (sig) return sig;
      }
    }
  }
  return null;
}

/**
 * Phá hộp thật (đóng cửa ngoài biên + volume) rồi retest giữ vững (LPS/LPSY). TP = measured move.
 */
export function evaluateWyckoffBreakoutRetest({ symbol, candlesH1, candlesM15, macroRange, atrH1, d1Phase, config = {} }) {
  const box = boxOf(macroRange);
  if (!box || !candlesH1 || candlesH1.length < 22 || !candlesM15 || candlesM15.length < 22) return null;

  const cur = candlesM15[candlesM15.length - 1];
  const prev = candlesM15[candlesM15.length - 2];
  const atr = atrH1 || cur.close * 0.01;
  const win = candlesH1.slice(-48);
  const priorM15 = candlesM15.slice(0, -1);
  const minVolRatio = config.wyckoffBreakoutVolRatio || 1.5;

  const breakoutBar = (isUp) => win.findIndex((b, i) => {
    const prior = win.slice(Math.max(0, i - 20), i);
    if (prior.length < 10 || b.vol < minVolRatio * avgVol(prior, 20)) return false;
    return isUp ? b.close > box.rangeHigh * 1.002 : b.close < box.rangeLow * 0.998;
  });

  if (d1Phase !== 'STRONG_DOWNTREND') {
    const i = breakoutBar(true);
    if (i >= 0) {
      const b = win[i];
      const stayed = win.slice(i + 1).every(c => c.close >= box.rangeHigh * 0.998);
      const retest = priorM15.filter(c => c.ts >= b.ts + H1_MS).find(c => c.low <= box.rangeHigh * 1.003 && c.close >= box.rangeHigh);
      if (stayed && retest && cur.close > cur.open && cur.close > prev.high && cur.close >= box.rangeHigh
          && (cur.close - box.rangeHigh) / box.rangeHigh <= 0.02) {
        const sig = buildSignal({
          symbol, strategy: 'WYCKOFF_BREAKOUT_RETEST_LONG', direction: 'LONG', entry: cur.close,
          stopLoss: Math.min(retest.low, box.rangeHigh) - 0.4 * atr, cur, config,
          targets: [box.rangeHigh + box.height],
          reason: `WYCKOFF_BREAKOUT_RETEST_LONG: phá trần ${box.rangeHigh} kèm volume, retest giữ vững, TP measured move ${(box.rangeHigh + box.height).toFixed(2)}`
        });
        if (sig) return sig;
      }
    }
  }

  if (d1Phase !== 'STRONG_UPTREND') {
    const i = breakoutBar(false);
    if (i >= 0) {
      const b = win[i];
      const stayed = win.slice(i + 1).every(c => c.close <= box.rangeLow * 1.002);
      const retest = priorM15.filter(c => c.ts >= b.ts + H1_MS).find(c => c.high >= box.rangeLow * 0.997 && c.close <= box.rangeLow);
      if (stayed && retest && cur.close < cur.open && cur.close < prev.low && cur.close <= box.rangeLow
          && (box.rangeLow - cur.close) / box.rangeLow <= 0.02) {
        const sig = buildSignal({
          symbol, strategy: 'WYCKOFF_BREAKDOWN_RETEST_SHORT', direction: 'SHORT', entry: cur.close,
          stopLoss: Math.max(retest.high, box.rangeLow) + 0.4 * atr, cur, config,
          targets: [box.rangeLow - box.height],
          reason: `WYCKOFF_BREAKDOWN_RETEST_SHORT: phá sàn ${box.rangeLow} kèm volume, retest bị từ chối, TP measured move ${(box.rangeLow - box.height).toFixed(2)}`
        });
        if (sig) return sig;
      }
    }
  }
  return null;
}
