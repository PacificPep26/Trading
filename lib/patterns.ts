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
 * - Chiến lược Trend Following có t-statistic = +3.35, ExpR = +0.604R sau phí sàn.
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
