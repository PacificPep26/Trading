// Mirror of the parts of service/backtest/patterns.py used by the watchlist (swings, trend, BOS, double top/bottom).
// Keep the definitions identical to the Python version that was backtested.
import type { Candle } from "@/lib/okx";

const W = 3;

export type Setup = {
  style: "bos" | "double_top_bottom" | "pinbar_reversal" | "daily_trend_donchian";
  state: "triggered" | "pending";
  side: 1 | -1;
  entry: number; // triggered: next-bar reference (last close); pending: price that triggers the setup
  stop: number;
  tp15: number;
  tp2: number;
  target?: number; // structural target (double top/bottom measured move)
  level: number; // broken level (swing / neckline): a 4h close back through it = failed setup, exit early
  distancePct: number; // pending: how far price must move to trigger (signed toward the trade)
  volumeRatio?: number; // Volume nến / SMA(20) Volume
  isCleanBody?: boolean; // Thân nến dứt khoát chống râu quét giả
};

function atrSeries(cs: Candle[]) {
  const out: number[] = [];
  cs.forEach((c, i) => {
    const p = cs[i - 1] ?? c;
    const tr = Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
    out.push(i === 0 ? tr : (out[i - 1] * 13 + tr) / 14);
  });
  return out;
}

export function swings(cs: Candle[]) {
  const highs: number[] = [], lows: number[] = [];
  for (let k = W; k < cs.length - W; k++) {
    let hi = true, lo = true;
    for (let j = k - W; j <= k + W; j++) {
      if (j === k) continue;
      if (cs[k].h <= cs[j].h) hi = false;
      if (cs[k].l >= cs[j].l) lo = false;
    }
    if (hi) highs.push(k);
    if (lo) lows.push(k);
  }
  return { highs, lows }; // only bars with W closed bars on both sides, i.e. confirmed at the last bar
}

export function trendOf(cs: Candle[], highs: number[], lows: number[]): -1 | 0 | 1 {
  if (highs.length < 2 || lows.length < 2) return 0;
  const [h0, h1] = highs.slice(-2), [l0, l1] = lows.slice(-2);
  if (cs[h1].h < cs[h0].h && cs[l1].l < cs[l0].l) return -1;
  if (cs[h1].h > cs[h0].h && cs[l1].l > cs[l0].l) return 1;
  return 0;
}

function levels(side: 1 | -1, entry: number, stop: number) {
  const r = Math.abs(entry - stop);
  return { tp15: entry + side * 1.5 * r, tp2: entry + side * 2 * r };
}

/** Analyse closed bars only. */
export function analyse(all: Candle[]) {
  const cs = all.filter((c) => c.closed);
  const i = cs.length - 1;
  const atr = atrSeries(cs)[i];
  const { highs, lows } = swings(cs);
  const trend = trendOf(cs, highs, lows);
  const c = cs[i], prev = cs[i - 1];
  const setups: Setup[] = [];

  // Tính Volume SMA20 & tỷ lệ khối lượng
  // Compare the signal candle with the previous 20 closed candles. Including
  // the signal candle in its own baseline weakens the volume filter.
  const recentVols = cs.slice(-21, -1).map((x) => x.v || 0);
  const avgVol = recentVols.length > 0 ? recentVols.reduce((a, b) => a + b, 0) / recentVols.length : 0;
  const rawVolumeRatio = avgVol > 0 && (c.v || 0) > 0 ? (c.v || 0) / avgVol : 1.0;
  const volumeRatio = Math.round(rawVolumeRatio * 100) / 100;
  // Khối lượng được xác nhận: nếu có data volume thì phải >= 0.75x trung bình (chặn nến kiệt volume)
  const isVolumeSupported = avgVol === 0 || (c.v || 0) === 0 || rawVolumeRatio >= 0.75;

  // BOS: close beyond the last swing in the trend direction; stop beyond the opposite swing
  if (trend !== 0 && highs.length && lows.length) {
    const lastHigh = cs[highs.at(-1)!].h, lastLow = cs[lows.at(-1)!].l;
    const candleRange = c.h - c.l;
    if (trend > 0) {
      const stop = lastLow - 0.1 * atr;
      const isCleanBody = c.c > c.o && (candleRange === 0 || (c.c - c.o) >= 0.25 * candleRange);
      if (c.c > lastHigh && lastHigh >= prev.c && isCleanBody && isVolumeSupported) {
        setups.push({ style: "bos", state: "triggered", side: 1, entry: c.c, stop, ...levels(1, c.c, stop), level: lastHigh, distancePct: 0, volumeRatio, isCleanBody: true });
      } else if (c.c <= lastHigh) {
        setups.push({ style: "bos", state: "pending", side: 1, entry: lastHigh, stop, ...levels(1, lastHigh, stop), level: lastHigh, distancePct: lastHigh / c.c - 1, volumeRatio });
      }
    } else {
      const stop = lastHigh + 0.1 * atr;
      const isCleanBody = c.c < c.o && (candleRange === 0 || (c.o - c.c) >= 0.25 * candleRange);
      if (c.c < lastLow && lastLow <= prev.c && isCleanBody && isVolumeSupported) {
        setups.push({ style: "bos", state: "triggered", side: -1, entry: c.c, stop, ...levels(-1, c.c, stop), level: lastLow, distancePct: 0, volumeRatio, isCleanBody: true });
      } else if (c.c >= lastLow) {
        setups.push({ style: "bos", state: "pending", side: -1, entry: lastLow, stop, ...levels(-1, lastLow, stop), level: lastLow, distancePct: c.c / lastLow - 1, volumeRatio });
      }
    }
  }

  // Double top / bottom: two swings within 0.3 ATR, at least 5 bars apart; triggers on a close through the neckline
  if (highs.length >= 2) {
    const [a, b] = highs.slice(-2);
    if (Math.abs(cs[a].h - cs[b].h) <= 0.3 * atr && b - a >= 5) {
      const neck = Math.min(...cs.slice(a, b + 1).map((x) => x.l));
      const top = Math.max(cs[a].h, cs[b].h), stop = top + 0.1 * atr, target = neck - (top - neck);
      if (c.c < neck && neck <= prev.c && isVolumeSupported) {
        setups.push({ style: "double_top_bottom", state: "triggered", side: -1, entry: c.c, stop, ...levels(-1, c.c, stop), target, level: neck, distancePct: 0, volumeRatio });
      } else if (c.c >= neck && c.c < stop) {
        setups.push({ style: "double_top_bottom", state: "pending", side: -1, entry: neck, stop, ...levels(-1, neck, stop), target, level: neck, distancePct: c.c / neck - 1, volumeRatio });
      }
    }
  }
  if (lows.length >= 2) {
    const [a, b] = lows.slice(-2);
    if (Math.abs(cs[a].l - cs[b].l) <= 0.3 * atr && b - a >= 5) {
      const neck = Math.max(...cs.slice(a, b + 1).map((x) => x.h));
      const bot = Math.min(cs[a].l, cs[b].l), stop = bot - 0.1 * atr, target = neck + (neck - bot);
      if (c.c > neck && neck >= prev.c && isVolumeSupported) {
        setups.push({ style: "double_top_bottom", state: "triggered", side: 1, entry: c.c, stop, ...levels(1, c.c, stop), target, level: neck, distancePct: 0, volumeRatio });
      } else if (c.c <= neck && c.c > stop) {
        setups.push({ style: "double_top_bottom", state: "pending", side: 1, entry: neck, stop, ...levels(1, neck, stop), target, level: neck, distancePct: neck / c.c - 1, volumeRatio });
      }
    }
  }

  // Pinbar / Râu nến đảo chiều tại vùng cản Swing (Liquidity Sweep)
  if (highs.length && lows.length && isVolumeSupported) {
    const lastHigh = cs[highs.at(-1)!].h;
    const lastLow = cs[lows.at(-1)!].l;
    const range = c.h - c.l;
    if (range > 0.4 * atr) {
      // Bearish Pinbar: Râu trên dài >= 50% quét sát đỉnh cũ -> SHORT
      const upperWick = c.h - Math.max(c.o, c.c);
      const body = Math.abs(c.c - c.o);
      if (upperWick >= 0.5 * range && body <= 0.4 * range && c.h >= lastHigh * 0.995) {
        const stop = c.h + 0.05 * atr;
        setups.push({
          style: "pinbar_reversal",
          state: "triggered",
          side: -1,
          entry: c.c,
          stop,
          ...levels(-1, c.c, stop),
          level: c.h,
          distancePct: 0,
          volumeRatio,
        });
      }

      // Bullish Pinbar: Râu dưới dài >= 50% quét sát đáy cũ rồi rút chân -> LONG
      const lowerWick = Math.min(c.o, c.c) - c.l;
      if (lowerWick >= 0.5 * range && body <= 0.4 * range && c.l <= lastLow * 1.005) {
        const stop = c.l - 0.05 * atr;
        setups.push({
          style: "pinbar_reversal",
          state: "triggered",
          side: 1,
          entry: c.c,
          stop,
          ...levels(1, c.c, stop),
          level: c.l,
          distancePct: 0,
          volumeRatio,
        });
      }
    }
  }

  return { trend, close: c.c, atrPct: atr / c.c, lastBarTime: c.t, setups };
}

/**
 * Phân tích Donchian Breakout 20/10 trên nến Ngày (1D):
 * - Backtest: train +0.80R (t=3.35, chọn sau khi xem kết quả nên bị phóng đại); 2025–2026 chỉ ~+0.01–0.03R.
 */
export function analyseDaily(all: Candle[]) {
  const cs = all.filter((c) => c.closed);
  if (cs.length < 25) {
    return { close: cs.at(-1)?.c ?? 0, lastBarTime: cs.at(-1)?.t ?? 0, pastLow10d: 0, pastHigh20d: 0, setups: [] };
  }

  const i = cs.length - 1;
  const c = cs[i];
  const prev = cs[i - 1];

  // ATR 20 Ngày
  let atr = 0;
  for (let k = 1; k < cs.length; k++) {
    const tr = Math.max(cs[k].h - cs[k].l, Math.abs(cs[k].h - cs[k - 1].c), Math.abs(cs[k].l - cs[k - 1].c));
    atr = k >= 20 ? (atr * 19 + tr) / 20 : tr;
  }

  // Đỉnh 20 ngày trước (không tính nến hiện tại)
  const prev20 = cs.slice(Math.max(0, i - 20), i);
  const pastHigh20d = Math.max(...prev20.map((x) => x.h));

  // Đáy 10 ngày trước (để làm mốc Trailing Stop)
  const prev10 = cs.slice(Math.max(0, i - 10), i);
  const pastLow10d = Math.min(...prev10.map((x) => x.l));

  const setups: Setup[] = [];

  // Breakout 20-Day High (Donchian Trend Following)
  if (c.c > pastHigh20d && pastHigh20d >= prev.c) {
    const stop = c.c - 2.0 * atr;
    setups.push({
      style: "daily_trend_donchian",
      state: "triggered",
      side: 1,
      entry: c.c,
      stop,
      ...levels(1, c.c, stop),
      target: pastLow10d,
      level: pastHigh20d,
      distancePct: 0,
      isCleanBody: true,
    });
  } else if (c.c <= pastHigh20d) {
    const stop = pastHigh20d - 2.0 * atr;
    setups.push({
      style: "daily_trend_donchian",
      state: "pending",
      side: 1,
      entry: pastHigh20d,
      stop,
      ...levels(1, pastHigh20d, stop),
      target: pastLow10d,
      level: pastHigh20d,
      distancePct: pastHigh20d / c.c - 1,
    });
  }

  return { close: c.c, atrPct: atr / c.c, lastBarTime: c.t, pastLow10d, pastHigh20d, setups };
}

/**
 * Nến k quét swing đáy/đỉnh gần nhất (hoặc đáy/đỉnh 24 nến): râu thủng mức rồi đóng lại bên trong, hoặc râu dài hơn thân.
 * Trả chiều lệnh và mức bị quét; null nếu không quét.
 */
function sweepAt(cs: Candle[], k: number): { side: 1 | -1; level: number } | null {
  if (k < 25) return null;
  const p = cs[k];
  const { highs, lows } = swings(cs.slice(0, k)); // swing đã xác nhận trước nến quét
  const prior = cs.slice(k - 24, k);
  const loLevels = [lows.length ? cs[lows[lows.length - 1]].l : NaN, Math.min(...prior.map((x) => x.l))];
  const hiLevels = [highs.length ? cs[highs[highs.length - 1]].h : NaN, Math.max(...prior.map((x) => x.h))];
  const body = Math.abs(p.c - p.o);
  const lo = loLevels.find((L) => p.l < L && L < p.h && (p.c > L || Math.min(p.o, p.c) - p.l >= body));
  if (lo !== undefined) return { side: 1, level: lo };
  const hi = hiLevels.find((L) => p.h > L && L > p.l && (p.c < L || p.h - Math.max(p.o, p.c) >= body));
  return hi !== undefined ? { side: -1, level: hi } : null;
}

/** Báo sớm: nến 1H vừa đóng là nến quét (chưa có nến xác nhận). */
export function freshSweep(all: Candle[]): {
  side: 1 | -1; level: number; wick: number; close: number; barTime: number;
  stop: number; tp: number; confirmAbove: number; // confirmAbove: nến kế phải đóng vượt mức này (đỉnh/đáy nến quét)
  vr: number; // volume nến quét / TB 20 nến trước
} | null {
  const cs = all.filter((c) => c.closed !== false);
  const k = cs.length - 1, sw = sweepAt(cs, k);
  if (!sw) return null;
  const p = cs[k], atr = atrSeries(cs)[k];
  const stop = sw.side > 0 ? p.l - 0.1 * atr : p.h + 0.1 * atr; // giống wickReversal
  const vr = volRatio(cs, k);
  return {
    ...sw, wick: sw.side > 0 ? p.l : p.h, close: p.c, barTime: p.t,
    stop, tp: p.c + sw.side * 1.8 * Math.abs(p.c - stop), confirmAbove: sw.side > 0 ? p.h : p.l, vr,
  };
}

/**
 * Cảnh báo tay (KHÔNG tự vào lệnh; backtest kiểu này ≈ −0.13R/lệnh): nến trước quét (sweepAt),
 * nến vừa đóng thân lớn vượt nến quét theo chiều lệnh. SL ngoài râu + 0.1 ATR, TP 1.8R.
 */
/** Volume nến k / trung bình 20 nến trước (0 nếu thiếu dữ liệu). */
function volRatio(cs: Candle[], k: number) {
  const prev = cs.slice(Math.max(0, k - 20), k);
  const avg = prev.reduce((s, x) => s + (x.v || 0), 0) / (prev.length || 1);
  return avg > 0 ? (cs[k].v || 0) / avg : 0;
}

export function wickReversal(all: Candle[]): { side: 1 | -1; entry: number; stop: number; tp: number; level: number; barTime: number; vr: number } | null {
  const cs = all.filter((c) => c.closed !== false);
  if (cs.length < 30) return null;
  const i = cs.length - 1, p = cs[i - 1], c = cs[i];
  const sw = sweepAt(cs, i - 1);
  if (!sw || Math.abs(c.c - c.o) < 0.6 * (c.h - c.l)) return null;
  const atr = atrSeries(cs)[i];
  if (sw.side > 0 && c.c > c.o && c.c > p.h) {
    const stop = p.l - 0.1 * atr;
    return { side: 1, entry: c.c, stop, tp: c.c + 1.8 * (c.c - stop), level: sw.level, barTime: c.t, vr: volRatio(cs, i - 1) };
  }
  if (sw.side < 0 && c.c < c.o && c.c < p.l) {
    const stop = p.h + 0.1 * atr;
    return { side: -1, entry: c.c, stop, tp: c.c - 1.8 * (stop - c.c), level: sw.level, barTime: c.t, vr: volRatio(cs, i - 1) };
  }
  return null;
}

/**
 * Đặt sẵn Limit bắt râu quét (sweep_limit_study 2026-10-14, phí 0%: +0.02R / +0.07R mỗi lệnh):
 * swing đáy 1H vừa xác nhận ở nến đóng cuối → Limit mua dưới đáy 0.5 ATR, SL dưới Limit 1.5 ATR,
 * TP = đỉnh swing trước đáy đó (bỏ nếu < 1R). Mirror cho SHORT trên swing đỉnh. Hiệu lực 24 nến.
 */
export function restingLimit(all: Candle[], side: 1 | -1): { side: 1 | -1; level: number; limit: number; stop: number; tp: number; atr: number; barTime: number } | null {
  const cs = all.filter((c) => c.closed !== false);
  const n = cs.length;
  if (n < 40) return null;
  const { highs, lows } = swings(cs);
  const idx = side > 0 ? lows : highs;
  const k = idx[idx.length - 1];
  if (k !== n - 1 - W) return null; // chỉ swing vừa xác nhận ở nến cuối
  // Nến tạo đáy volume ≥ 2.5x TB 20 nến trước = lực bán thật, giá hay xuyên qua Limit xuống SL
  // (limit_tp_study 2026-10-14: 2025 −0.12R, 2026 −0.22R; các nhóm còn lại dương)
  const prev = cs.slice(Math.max(0, k - 20), k);
  const vAvg = prev.reduce((s, c) => s + c.v, 0) / prev.length;
  if (vAvg > 0 && cs[k].v >= 2.5 * vAvg) return null;
  const atr = atrSeries(cs)[n - 1];
  const level = side > 0 ? cs[k].l : cs[k].h;
  const limit = level - side * 0.5 * atr;
  const stop = limit - side * 1.5 * atr;
  const opp = (side > 0 ? highs : lows).filter((j) => j < k);
  if (!opp.length) return null;
  const tp = side > 0 ? cs[opp[opp.length - 1]].h : cs[opp[opp.length - 1]].l;
  if (side * (tp - limit) < Math.abs(limit - stop)) return null;
  return { side, level, limit, stop, tp, atr, barTime: cs[n - 1].t };
}

/**
 * SMC: FVG H1 → hồi về vùng → 15m quét + đóng quay lại (fvg_mtf_study 2026-10-14, phí 0%, chỉ lần vào đầu:
 * 2025 +0.09R, 2026 +0.27R; 2023–24 âm). Trả tín hiệu nếu NẾN 15m VỪA ĐÓNG là lần kích hoạt đầu tiên của FVG gần nhất.
 */
export function fvgSweepSignal(h1All: Candle[], m15All: Candle[], dailySide: number): { side: 1 | -1; entry: number; stop: number; tp: number; zoneTop: number; zoneBot: number; fvgTime: number } | null {
  const h1 = h1All.filter((c) => c.closed !== false), m15 = m15All.filter((c) => c.closed !== false);
  if (h1.length < 40 || m15.length < 30 || !dailySide) return null;
  const atr1 = atrSeries(h1), atr15 = atrSeries(m15);
  const H = 3_600_000, now15 = m15[m15.length - 1].t;
  for (let i = h1.length - 1; i >= Math.max(30, h1.length - 48); i--) {
    const c = h1[i], p2 = h1[i - 2], a = atr1[i];
    const side = c.l > p2.h && c.l - p2.h >= 0.3 * a ? 1 : c.h < p2.l && p2.l - c.h >= 0.3 * a ? -1 : 0;
    if (!side || side !== dailySide) continue;
    const sw = swings(h1.slice(0, i + 1));
    if (trendOf(h1.slice(0, i + 1), sw.highs, sw.lows) !== side) continue;
    const top = side > 0 ? c.l : p2.l, bot = side > 0 ? p2.h : c.h;
    let extreme = side > 0 ? Math.max(...h1.slice(i - 2, i + 1).map((b) => b.h)) : Math.min(...h1.slice(i - 2, i + 1).map((b) => b.l));
    let inZone = false;
    for (let j = 0; j < m15.length; j++) {
      const b = m15[j];
      if (b.t < c.t + H || j < 8) continue;
      if (b.t >= c.t + H + 48 * H) return null;
      if (!inZone) {
        extreme = side > 0 ? Math.max(extreme, b.h) : Math.min(extreme, b.l);
        if (side > 0 ? b.l <= top : b.h >= top) inZone = true;
        continue;
      }
      if (side > 0 ? b.c < bot - a : b.c > bot + a) return null; // vùng hỏng
      const prev = m15.slice(j - 8, j);
      const ref = side > 0 ? Math.min(...prev.map((q) => q.l)) : Math.max(...prev.map((q) => q.h));
      if (!(side > 0 ? b.l < ref && b.c > ref : b.h > ref && b.c < ref)) continue;
      const stop = side > 0 ? b.l - 0.1 * atr15[j] : b.h + 0.1 * atr15[j];
      const risk = Math.abs(b.c - stop) / b.c;
      if (risk < 0.002 || risk > 0.06 || side * (extreme - b.c) < 1.5 * Math.abs(b.c - stop)) continue;
      // lần kích hoạt đầu tiên của FVG này: chỉ báo nếu chính là nến vừa đóng
      return b.t === now15 ? { side, entry: b.c, stop, tp: extreme, zoneTop: top, zoneBot: bot, fvgTime: c.t } : null;
    }
    return null; // chỉ xét FVG gần nhất
  }
  return null;
}
