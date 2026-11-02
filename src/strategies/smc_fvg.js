/**
 * SMC_FVG.JS - Setup mua/bán theo video SMC: BOS + FVG + thanh khoản (đáy/đỉnh cục bộ).
 * Chỉ có FVG đơn thuần thì BỎ. Vào bằng lệnh LIMIT tại mép FVG, SL ngoài mép kia, TP 1:3.
 * Backtest M15 2020-26 (6 coin, SL >= 0.8%): PF 1.21 chưa trừ phí, ~1.07 sau phí Maker -> chỉ dùng làm CẢNH BÁO.
 * Phía bán = phía mua chạy trên chuỗi đảo dấu giá (gương).
 */

const flip = (a) => a.map(c => ({ ...c, open: -c.open, high: -c.low, low: -c.high, close: -c.close }));

/** Tất cả tín hiệu LONG (chạm FVG sau khi quét đáy cục bộ) trong chuỗi nến đã đóng. */
function findLongSignals(c, { minRisk, maxRisk, rr }) {
  const out = [];
  const isSwingHigh = (p) => p >= 2 && p + 2 < c.length && [1, 2].every(d => c[p].high >= c[p - d].high && c[p].high >= c[p + d].high);
  let lastSH = null;
  for (let k = 4; k < c.length - 2; k++) {
    if (isSwingHigh(k - 2)) lastSH = c[k - 2].high;
    if (lastSH === null || !(c[k].close > lastSH && c[k - 1].close <= lastSH)) continue; // BOS lần đầu
    let fvg = null;
    for (let i = k; i >= k - 2; i--) if (c[i].low > c[i - 2].high) { fvg = { bot: c[i - 2].high, top: c[i].low }; break; }
    if (!fvg) continue;
    for (let m = k + 1; m < Math.min(c.length, k + 60); m++) {
      if (c[m].close < fvg.bot) break; // FVG bị xuyên thủng
      if (c[m].low > fvg.top) continue;
      let pool = null;
      for (let j = k + 2; j <= m - 2; j++) {
        if (c[j].low < c[j - 1].low && c[j].low < c[j + 1].low && c[j].low > fvg.top) pool = c[j].low;
      }
      if (pool === null) break; // chỉ có FVG đơn thuần
      const entry = fvg.top, sl = fvg.bot - 0.0005 * Math.abs(fvg.bot), risk = entry - sl;
      const ratio = risk / Math.abs(entry);
      if (ratio < minRisk || ratio > maxRisk || c[m].low <= sl) break;
      out.push({ k, m, entry, sl, tp: entry + rr * risk, fvg, pool });
      break;
    }
  }
  return out;
}

/**
 * Tín hiệu SMC xuất hiện ĐÚNG ở nến đã đóng cuối cùng (không báo lại các nến sau).
 * @param {Array} candles nến đã đóng (confirm=1), tăng dần
 */
export function latestSmcFvgSignal(candles, { minRisk = 0.008, maxRisk = 0.05, rr = 3 } = {}) {
  const c = (candles || []).slice(-150);
  if (c.length < 10) return null;
  const last = c.length - 1;
  const opts = { minRisk, maxRisk, rr };
  const triggerTime = c[last].ts;
  const L = findLongSignals(c, opts).find(s => s.m === last);
  if (L) return { direction: 'LONG', entry: L.entry, stopLoss: L.sl, takeProfit: L.tp, fvg: L.fvg, pool: L.pool, rr, triggerTime };
  const S = findLongSignals(flip(c), opts).find(s => s.m === last);
  if (S) {
    return {
      direction: 'SHORT', entry: -S.entry, stopLoss: -S.sl, takeProfit: -S.tp,
      fvg: { bot: -S.fvg.top, top: -S.fvg.bot }, pool: -S.pool, rr, triggerTime
    };
  }
  return null;
}
