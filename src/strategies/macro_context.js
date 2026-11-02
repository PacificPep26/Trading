/**
 * MACRO_CONTEXT.JS - Bức tranh lớn từ TOÀN BỘ lịch sử nến ngày: ATH/ATL, xu hướng tháng/tuần/ngày,
 * pha thị trường, thống kê theo năm, các mốc tuần/tháng/năm. Hàm thuần: chỉ nhận nến ngày ĐÃ ĐÓNG
 * (nếu dùng cho backtest, cắt nến tới thời điểm đang xét để không nhìn trước tương lai).
 */
import { computeStructTrend } from './regime.js';

const DAY = 86400000;
const weekStart = (ts) => { const d = Math.floor(ts / DAY) * DAY; return d - ((new Date(d).getUTCDay() + 6) % 7) * DAY; }; // thứ Hai UTC
const monthStart = (ts) => { const d = new Date(ts); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

/** Gộp nến ngày (tăng dần theo thời gian) thành tuần ('W') hoặc tháng ('M'). Kỳ cuối coi là chưa đóng (confirm 0). */
export function resample(d1, unit) {
  const key = unit === 'W' ? weekStart : monthStart, out = [];
  for (const c of d1) {
    const k = key(c.ts), last = out[out.length - 1];
    if (last && last.ts === k) {
      last.high = Math.max(last.high, c.high); last.low = Math.min(last.low, c.low); last.close = c.close; last.vol += c.vol;
    } else out.push({ ts: k, open: c.open, high: c.high, low: c.low, close: c.close, vol: c.vol, confirm: 1 });
  }
  if (out.length) out[out.length - 1].confirm = 0;
  return out;
}

const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0);
const f = (v) => (v >= 1000 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4));
const PHASE = { BULL: 'TĂNG', LEAN_BULL: 'thiên tăng', RANGE: 'đi ngang/chuyển pha', LEAN_BEAR: 'thiên giảm', BEAR: 'GIẢM' };

export function buildMacroContext(d1) {
  if (!d1 || d1.length < 200) return { phase: 'UNKNOWN', summary: 'Chưa đủ lịch sử (<200 ngày) để đánh giá bối cảnh lớn.' };
  const last = d1[d1.length - 1], price = last.close;
  const w1 = resample(d1, 'W'), m1 = resample(d1, 'M');
  const closedW = w1.filter(c => c.confirm === 1), closedM = m1.filter(c => c.confirm === 1);

  let ath = d1[0], atl = d1[0];
  for (const c of d1) { if (c.high > ath.high) ath = c; if (c.low < atl.low) atl = c; }
  const sma200 = d1.slice(-200).reduce((s, c) => s + c.close, 0) / 200;
  const trends = { m: computeStructTrend(closedM, 2), w: computeStructTrend(closedW, 3), d: computeStructTrend(d1.slice(-250), 3) };
  const score = trends.m + trends.w + trends.d + (price > sma200 ? 1 : -1);
  const phase = score >= 3 ? 'BULL' : score >= 1 ? 'LEAN_BULL' : score <= -3 ? 'BEAR' : score <= -1 ? 'LEAN_BEAR' : 'RANGE';

  const byYear = new Map();
  for (const c of d1) { const y = new Date(c.ts).getUTCFullYear(); (byYear.get(y) || byYear.set(y, []).get(y)).push(c); }
  const years = [...byYear.entries()].slice(-6).map(([year, cs]) => {
    let peak = cs[0].high, dd = 0;
    for (const c of cs) { peak = Math.max(peak, c.high); dd = Math.max(dd, (peak - c.low) / peak * 100); }
    return { year, returnPct: pct(cs[cs.length - 1].close, cs[0].open), maxDrawdownPct: dd };
  });

  const curW = w1[w1.length - 1], curM = m1[m1.length - 1], pW = w1[w1.length - 2], pM = m1[m1.length - 2];
  const yearOpen = byYear.get(new Date(last.ts).getUTCFullYear())[0].open;
  const levels = { ath: ath.high, atl: atl.low, yearOpen, monthOpen: curM.open, weekOpen: curW.open, prevMonthHigh: pM?.high ?? null, prevMonthLow: pM?.low ?? null, prevWeekHigh: pW?.high ?? null, prevWeekLow: pW?.low ?? null };

  const tname = (t) => (t > 0 ? 'tăng' : t < 0 ? 'giảm' : 'trung tính');
  const ddTrue = ((ath.high - price) / ath.high) * 100; // % sụt so với đỉnh lịch sử
  const summary = `Bối cảnh lớn: pha ${PHASE[phase]} | Tháng ${tname(trends.m)}, Tuần ${tname(trends.w)}, Ngày ${tname(trends.d)} | ${price > sma200 ? 'trên' : 'dưới'} MA200 ngày (${f(sma200)}) | cách đỉnh lịch sử ${f(ath.high)} là -${ddTrue.toFixed(0)}% (${years.length ? 'năm nay ' + (years[years.length - 1].returnPct >= 0 ? '+' : '') + years[years.length - 1].returnPct.toFixed(0) + '%' : ''}).`;
  return {
    phase, score, trends, price, sma200, firstTs: d1[0].ts, days: d1.length,
    ath: { price: ath.high, ts: ath.ts }, atl: { price: atl.low, ts: atl.ts },
    drawdownPct: ddTrue, fromAtlPct: pct(price, atl.low), rangePos: ath.high > atl.low ? (price - atl.low) / (ath.high - atl.low) : 0,
    years, levels, summary
  };
}
