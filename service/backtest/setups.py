"""Setup detectors shared by the playbook study (Python) and mirrored in lib/setups.ts (web).

Each detector looks at bar i (closed) and earlier only, and returns None or
(side, stop_price): side +1 long / -1 short, stop just beyond the setup's extreme.
Keep the definitions identical to lib/setups.ts.
"""
from dataclasses import dataclass

from .data import Candle

LOOKBACK = 48  # bars used for swing high/low


@dataclass
class Indicators:
    atr: list[float]
    ema200: list[float]
    rsi: list[float]
    vol_avg: list[float]  # mean volume of the previous 20 bars (excludes bar i)
    lo: list[float]  # lowest low of the previous LOOKBACK bars (excludes bar i)
    hi: list[float]  # highest high of the previous LOOKBACK bars


def indicators(cs: list[Candle]) -> Indicators:
    n = len(cs)
    atr, ema, rsi, vavg, lo, hi = [0.0] * n, [0.0] * n, [50.0] * n, [0.0] * n, [0.0] * n, [0.0] * n
    k = 2 / 201
    gain = loss = 0.0
    for i, c in enumerate(cs):
        tr = c.h - c.l if i == 0 else max(c.h - c.l, abs(c.h - cs[i - 1].c), abs(c.l - cs[i - 1].c))
        atr[i] = tr if i == 0 else (atr[i - 1] * 13 + tr) / 14
        ema[i] = c.c if i == 0 else ema[i - 1] + k * (c.c - ema[i - 1])
        if i > 0:
            d = c.c - cs[i - 1].c
            gain = (gain * 13 + max(d, 0)) / 14
            loss = (loss * 13 + max(-d, 0)) / 14
            rsi[i] = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
    vsum = 0.0
    for i in range(n):
        if i >= 20:
            vavg[i] = vsum / 20
            vsum -= cs[i - 20].v
        vsum += cs[i].v
    for i in range(LOOKBACK, n):
        window = cs[i - LOOKBACK : i]
        lo[i] = min(c.l for c in window)
        hi[i] = max(c.h for c in window)
    return Indicators(atr, ema, rsi, vavg, lo, hi)


def sweep_reclaim(cs, ind, i):
    """User's setup: wick through the 48-bar low/high on >=2.5x volume, close back inside."""
    c = cs[i]
    if i < LOOKBACK or ind.vol_avg[i] <= 0 or c.v < 2.5 * ind.vol_avg[i]:
        return None
    if c.l < ind.lo[i] and c.c > ind.lo[i]:
        return 1, c.l - 0.1 * ind.atr[i]
    if c.h > ind.hi[i] and c.c < ind.hi[i]:
        return -1, c.h + 0.1 * ind.atr[i]
    return None


def breakout_volume(cs, ind, i):
    """Close beyond the 48-bar high/low on >=2x volume."""
    c = cs[i]
    if i < LOOKBACK or ind.vol_avg[i] <= 0 or c.v < 2 * ind.vol_avg[i]:
        return None
    if c.c > ind.hi[i]:
        return 1, c.l - 0.1 * ind.atr[i]
    if c.c < ind.lo[i]:
        return -1, c.h + 0.1 * ind.atr[i]
    return None


def trend_pullback(cs, ind, i):
    """Above EMA200 with RSI(14) crossing back above 35 -> long; mirror for short."""
    if i < 200:
        return None
    c = cs[i]
    swing_lo = min(x.l for x in cs[i - 5 : i + 1])
    swing_hi = max(x.h for x in cs[i - 5 : i + 1])
    if c.c > ind.ema200[i] and ind.rsi[i - 1] < 35 <= ind.rsi[i]:
        return 1, swing_lo - 0.1 * ind.atr[i]
    if c.c < ind.ema200[i] and ind.rsi[i - 1] > 65 >= ind.rsi[i]:
        return -1, swing_hi + 0.1 * ind.atr[i]
    return None


def engulfing_extreme(cs, ind, i):
    """Engulfing candle that formed at the 48-bar low/high."""
    if i < LOOKBACK + 1:
        return None
    p, c = cs[i - 1], cs[i]
    low, high = min(p.l, c.l), max(p.h, c.h)
    if p.c < p.o and c.c > c.o and c.c >= p.o and c.o <= p.c and low <= ind.lo[i - 1]:
        return 1, low - 0.1 * ind.atr[i]
    if p.c > p.o and c.c < c.o and c.c <= p.o and c.o >= p.c and high >= ind.hi[i - 1]:
        return -1, high + 0.1 * ind.atr[i]
    return None


SETUPS = {
    "sweep_reclaim": sweep_reclaim,
    "breakout_volume": breakout_volume,
    "trend_pullback": trend_pullback,
    "engulfing_extreme": engulfing_extreme,
}
