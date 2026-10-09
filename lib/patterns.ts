// Mirror of the parts of service/backtest/patterns.py used by the watchlist (swings, trend, BOS, double top/bottom).
// Keep the definitions identical to the Python version that was backtested.
import type { Candle } from "@/lib/okx";

const W = 3;

export type Setup = {
  style: "bos" | "double_top_bottom" | "pinbar_reversal";
  state: "triggered" | "pending";
  side: 1 | -1;
  entry: number; // triggered: next-bar reference (last close); pending: price that triggers the setup
  stop: number;
  tp15: number;
  tp2: number;
  target?: number; // structural target (double top/bottom measured move)
  level: number; // broken level (swing / neckline): a 4h close back through it = failed setup, exit early
  distancePct: number; // pending: how far price must move to trigger (signed toward the trade)
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

  // BOS: close beyond the last swing in the trend direction; stop beyond the opposite swing
  if (trend !== 0 && highs.length && lows.length) {
    const lastHigh = cs[highs.at(-1)!].h, lastLow = cs[lows.at(-1)!].l;
    if (trend > 0) {
      const stop = lastLow - 0.1 * atr;
      if (c.c > lastHigh && lastHigh >= prev.c) setups.push({ style: "bos", state: "triggered", side: 1, entry: c.c, stop, ...levels(1, c.c, stop), level: lastHigh, distancePct: 0 });
      else if (c.c <= lastHigh) setups.push({ style: "bos", state: "pending", side: 1, entry: lastHigh, stop, ...levels(1, lastHigh, stop), level: lastHigh, distancePct: lastHigh / c.c - 1 });
    } else {
      const stop = lastHigh + 0.1 * atr;
      if (c.c < lastLow && lastLow <= prev.c) setups.push({ style: "bos", state: "triggered", side: -1, entry: c.c, stop, ...levels(-1, c.c, stop), level: lastLow, distancePct: 0 });
      else if (c.c >= lastLow) setups.push({ style: "bos", state: "pending", side: -1, entry: lastLow, stop, ...levels(-1, lastLow, stop), level: lastLow, distancePct: c.c / lastLow - 1 });
    }
  }

  // Double top / bottom: two swings within 0.3 ATR, at least 5 bars apart; triggers on a close through the neckline
  if (highs.length >= 2) {
    const [a, b] = highs.slice(-2);
    if (Math.abs(cs[a].h - cs[b].h) <= 0.3 * atr && b - a >= 5) {
      const neck = Math.min(...cs.slice(a, b + 1).map((x) => x.l));
      const top = Math.max(cs[a].h, cs[b].h), stop = top + 0.1 * atr, target = neck - (top - neck);
      if (c.c < neck && neck <= prev.c) setups.push({ style: "double_top_bottom", state: "triggered", side: -1, entry: c.c, stop, ...levels(-1, c.c, stop), target, level: neck, distancePct: 0 });
      else if (c.c >= neck && c.c < stop) setups.push({ style: "double_top_bottom", state: "pending", side: -1, entry: neck, stop, ...levels(-1, neck, stop), target, level: neck, distancePct: c.c / neck - 1 });
    }
  }
  if (lows.length >= 2) {
    const [a, b] = lows.slice(-2);
    if (Math.abs(cs[a].l - cs[b].l) <= 0.3 * atr && b - a >= 5) {
      const neck = Math.max(...cs.slice(a, b + 1).map((x) => x.h));
      const bot = Math.min(cs[a].l, cs[b].l), stop = bot - 0.1 * atr, target = neck + (neck - bot);
      if (c.c > neck && neck >= prev.c) setups.push({ style: "double_top_bottom", state: "triggered", side: 1, entry: c.c, stop, ...levels(1, c.c, stop), target, level: neck, distancePct: 0 });
      else if (c.c <= neck && c.c > stop) setups.push({ style: "double_top_bottom", state: "pending", side: 1, entry: neck, stop, ...levels(1, neck, stop), target, level: neck, distancePct: neck / c.c - 1 });
    }
  }

  // Pinbar / Râu nến đảo chiều tại vùng cản Swing (Liquidity Sweep)
  if (highs.length && lows.length) {
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
        });
      }
    }
  }

  return { trend, close: c.c, atrPct: atr / c.c, lastBarTime: c.t, setups };
}
