"""Bar-by-bar simulator.

Rules:
- A strategy sees only candles[: i + 1] (bar i is closed) and returns +1 (long), -1 (short) or 0.
- Entry happens at the open of bar i + 1, never at the close the signal saw.
- Stop-loss / take-profit are multiples of ATR at signal time. If both are touched inside the
  same bar, the stop-loss is assumed to hit first (conservative).
- One position at a time. A trade also exits at the close of bar entry + max_hold - 1.
- Costs: `fee` per side (fraction of notional) plus `slippage` per side applied to fill prices.
"""
from dataclasses import dataclass, field
from typing import Callable

from .data import Candle

Strategy = Callable[[list[Candle], int], int]


@dataclass
class Params:
    sl_atr: float = 1.5
    tp_atr: float = 3.0
    max_hold: int = 24
    atr_len: int = 14
    fee: float = 0.001
    slippage: float = 0.0002


@dataclass
class Trade:
    side: int
    entry_i: int
    exit_i: int
    entry: float
    exit: float
    reason: str
    ret: float  # net return as fraction of notional, after costs


@dataclass
class Result:
    trades: list[Trade] = field(default_factory=list)


def atr(candles: list[Candle], i: int, n: int) -> float | None:
    if i < n:
        return None
    s = 0.0
    for k in range(i - n + 1, i + 1):
        c, p = candles[k], candles[k - 1]
        s += max(c.h - c.l, abs(c.h - p.c), abs(c.l - p.c))
    return s / n


def simulate_trade(candles: list[Candle], signal_i: int, side: int, p: Params, end: int | None = None) -> Trade | None:
    end = len(candles) if end is None else end
    a = atr(candles, signal_i, p.atr_len)
    entry_i = signal_i + 1
    if a is None or entry_i >= end:
        return None
    entry = candles[entry_i].o * (1 + side * p.slippage)
    sl = entry - side * p.sl_atr * a
    tp = entry + side * p.tp_atr * a
    last = min(entry_i + p.max_hold - 1, end - 1)
    exit_i, exit_px, reason = last, candles[last].c, "time"
    for k in range(entry_i, last + 1):
        c = candles[k]
        hit_sl = c.l <= sl if side > 0 else c.h >= sl
        hit_tp = c.h >= tp if side > 0 else c.l <= tp
        if hit_sl:
            # an open already past the stop fills at the open, not the stop price
            gap = c.o < sl if side > 0 else c.o > sl
            exit_i, exit_px, reason = k, (c.o if gap else sl), "sl"
            break
        if hit_tp:
            exit_i, exit_px, reason = k, tp, "tp"
            break
    exit_px *= 1 - side * p.slippage
    ret = side * (exit_px / entry - 1) - 2 * p.fee
    return Trade(side, entry_i, exit_i, entry, exit_px, reason, ret)


def run(candles: list[Candle], strategy: Strategy, p: Params = Params(), start: int = 0, end: int | None = None) -> Result:
    end = len(candles) if end is None else end
    res = Result()
    i = max(start, p.atr_len)
    while i < end - 1:
        side = strategy(candles, i)
        if side:
            tr = simulate_trade(candles, i, side, p, end)
            if tr:
                res.trades.append(tr)
                i = tr.exit_i  # the exit bar may itself produce the next signal
        i += 1
    return res
