"""Market-structure trade plans (mirrored in lib/structure.ts — keep identical).

Swings: bar k is a swing high if its high is the strict max of bars k-W..k+W (W=3),
confirmed only once bar k+W has closed. Same for lows.
Trend from the last two confirmed swing highs/lows:
  down = lower high and lower low, up = higher high and higher low, else range.
Plan (trend only, ranges are skipped):
  short: leg = last swing high -> lowest low since; entry = low + 0.5 * leg (limit, pullback);
         stop = swing high + 0.1 ATR; tp1 = entry - 1.8 R; tp2 = lowest low (next support).
  long mirrors it.
"""
from dataclasses import dataclass

from .data import Candle

W = 3
RR = 1.8
RETRACE = 0.5


@dataclass
class Plan:
    side: int  # +1 long, -1 short
    trend: str
    entry: float
    stop: float
    tp1: float
    tp2: float
    swing_hi: float
    swing_lo: float
    made_at: int  # index of the bar the plan was built on


def atr_series(cs: list[Candle], n: int = 14) -> list[float]:
    out = []
    for i, c in enumerate(cs):
        tr = c.h - c.l if i == 0 else max(c.h - c.l, abs(c.h - cs[i - 1].c), abs(c.l - cs[i - 1].c))
        out.append(tr if i == 0 else (out[-1] * (n - 1) + tr) / n)
    return out


def swings(cs: list[Candle], i: int) -> tuple[list[int], list[int]]:
    """Confirmed swing-high and swing-low indexes using bars up to i."""
    highs, lows = [], []
    for k in range(W, i - W + 1):
        win = cs[k - W : k + W + 1]
        if all(cs[k].h > x.h for j, x in enumerate(win) if j != W):
            highs.append(k)
        if all(cs[k].l < x.l for j, x in enumerate(win) if j != W):
            lows.append(k)
    return highs, lows


def trend_of(cs, highs, lows) -> str:
    if len(highs) < 2 or len(lows) < 2:
        return "range"
    h1, h2 = cs[highs[-2]].h, cs[highs[-1]].h
    l1, l2 = cs[lows[-2]].l, cs[lows[-1]].l
    if h2 < h1 and l2 < l1:
        return "down"
    if h2 > h1 and l2 > l1:
        return "up"
    return "range"


def plan_at(cs: list[Candle], atr: list[float], i: int, lookback: int = 120) -> Plan | None:
    start = max(0, i - lookback)
    sub = cs[start : i + 1]
    highs, lows = swings(sub, len(sub) - 1)
    trend = trend_of(sub, highs, lows)
    a = atr[i]
    if trend == "down":
        hi_k = highs[-1]
        lo = min(c.l for c in sub[hi_k:])
        hi = sub[hi_k].h
        entry = lo + RETRACE * (hi - lo)
        stop = hi + 0.1 * a
        risk = stop - entry
        return Plan(-1, trend, entry, stop, entry - RR * risk, lo, hi, lo, i)
    if trend == "up":
        lo_k = lows[-1]
        hi = max(c.h for c in sub[lo_k:])
        lo = sub[lo_k].l
        entry = hi - RETRACE * (hi - lo)
        stop = lo - 0.1 * a
        risk = entry - stop
        return Plan(1, trend, entry, stop, entry + RR * risk, hi, hi, lo, i)
    return None
