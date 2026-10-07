// Mirror of service/backtest/setups.py. Keep the definitions identical.
export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
export type Signal = { setup: SetupName; side: 1 | -1; stop: number };
export type SetupName = "sweep_reclaim" | "breakout_volume" | "trend_pullback" | "engulfing_extreme";

const LOOKBACK = 48;

export const SETUP_INFO: Record<SetupName, { title: string; desc: string }> = {
  sweep_reclaim: {
    title: "Quét đáy/đỉnh rồi rút lại",
    desc: "Râu nến xuyên đáy (đỉnh) 48 nến với khối lượng ≥2,5× trung bình, nhưng đóng cửa quay lại bên trong.",
  },
  breakout_volume: {
    title: "Phá vỡ kèm khối lượng",
    desc: "Đóng cửa vượt đỉnh (thủng đáy) 48 nến với khối lượng ≥2× trung bình.",
  },
  trend_pullback: {
    title: "Hồi trong xu hướng",
    desc: "Giá trên EMA200 và RSI14 vừa bật lên lại trên 35 (short: dưới EMA200, RSI rơi lại dưới 65).",
  },
  engulfing_extreme: {
    title: "Nến nhấn chìm tại vùng cực",
    desc: "Nến nhấn chìm hình thành ngay tại đáy (đỉnh) 48 nến.",
  },
};

function indicators(cs: Bar[]) {
  const n = cs.length;
  const atr = new Array(n).fill(0), ema = new Array(n).fill(0), rsi = new Array(n).fill(50);
  const vavg = new Array(n).fill(0), lo = new Array(n).fill(0), hi = new Array(n).fill(0);
  const k = 2 / 201;
  let gain = 0, loss = 0, vsum = 0;
  cs.forEach((c, i) => {
    const p = cs[i - 1];
    const tr = i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
    atr[i] = i === 0 ? tr : (atr[i - 1] * 13 + tr) / 14;
    ema[i] = i === 0 ? c.c : ema[i - 1] + k * (c.c - ema[i - 1]);
    if (i > 0) {
      const d = c.c - p.c;
      gain = (gain * 13 + Math.max(d, 0)) / 14;
      loss = (loss * 13 + Math.max(-d, 0)) / 14;
      rsi[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    if (i >= 20) {
      vavg[i] = vsum / 20;
      vsum -= cs[i - 20].v;
    }
    vsum += c.v;
    if (i >= LOOKBACK) {
      const w = cs.slice(i - LOOKBACK, i);
      lo[i] = Math.min(...w.map((x) => x.l));
      hi[i] = Math.max(...w.map((x) => x.h));
    }
  });
  return { atr, ema, rsi, vavg, lo, hi };
}

type Ind = ReturnType<typeof indicators>;
type Detector = (cs: Bar[], ind: Ind, i: number) => [1 | -1, number] | null;

const DETECTORS: Record<SetupName, Detector> = {
  sweep_reclaim(cs, ind, i) {
    const c = cs[i];
    if (i < LOOKBACK || ind.vavg[i] <= 0 || c.v < 2.5 * ind.vavg[i]) return null;
    if (c.l < ind.lo[i] && c.c > ind.lo[i]) return [1, c.l - 0.1 * ind.atr[i]];
    if (c.h > ind.hi[i] && c.c < ind.hi[i]) return [-1, c.h + 0.1 * ind.atr[i]];
    return null;
  },
  breakout_volume(cs, ind, i) {
    const c = cs[i];
    if (i < LOOKBACK || ind.vavg[i] <= 0 || c.v < 2 * ind.vavg[i]) return null;
    if (c.c > ind.hi[i]) return [1, c.l - 0.1 * ind.atr[i]];
    if (c.c < ind.lo[i]) return [-1, c.h + 0.1 * ind.atr[i]];
    return null;
  },
  trend_pullback(cs, ind, i) {
    if (i < 200) return null;
    const c = cs[i];
    const w = cs.slice(i - 5, i + 1);
    const swingLo = Math.min(...w.map((x) => x.l)), swingHi = Math.max(...w.map((x) => x.h));
    if (c.c > ind.ema[i] && ind.rsi[i - 1] < 35 && ind.rsi[i] >= 35) return [1, swingLo - 0.1 * ind.atr[i]];
    if (c.c < ind.ema[i] && ind.rsi[i - 1] > 65 && ind.rsi[i] <= 65) return [-1, swingHi + 0.1 * ind.atr[i]];
    return null;
  },
  engulfing_extreme(cs, ind, i) {
    if (i < LOOKBACK + 1) return null;
    const p = cs[i - 1], c = cs[i];
    const low = Math.min(p.l, c.l), high = Math.max(p.h, c.h);
    if (p.c < p.o && c.c > c.o && c.c >= p.o && c.o <= p.c && low <= ind.lo[i - 1]) return [1, low - 0.1 * ind.atr[i]];
    if (p.c > p.o && c.c < c.o && c.c <= p.o && c.o >= p.c && high >= ind.hi[i - 1]) return [-1, high + 0.1 * ind.atr[i]];
    return null;
  },
};

/** Setups firing on any of the last `recent` closed bars (most recent first). */
export function detect(closed: Bar[], recent = 3): (Signal & { barsAgo: number; barTime: number })[] {
  const ind = indicators(closed);
  const out: (Signal & { barsAgo: number; barTime: number })[] = [];
  for (let ago = 0; ago < recent; ago++) {
    const i = closed.length - 1 - ago;
    for (const name of Object.keys(DETECTORS) as SetupName[]) {
      const r = DETECTORS[name](closed, ind, i);
      if (r) out.push({ setup: name, side: r[0], stop: r[1], barsAgo: ago, barTime: closed[i].t });
    }
  }
  return out;
}

export function context(closed: Bar[]) {
  const ind = indicators(closed);
  const i = closed.length - 1;
  return {
    aboveEma200: closed[i].c > ind.ema[i],
    ema200: ind.ema[i],
    rsi: ind.rsi[i],
    atrPct: ind.atr[i] / closed[i].c,
    volRatio: ind.vavg[i] > 0 ? closed[i].v / ind.vavg[i] : null,
    low48: ind.lo[i],
    high48: ind.hi[i],
  };
}
