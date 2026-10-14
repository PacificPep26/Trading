"""Same 4h live signals, different exits: does letting winners run beat the fixed 1.5R target?

Usage: python -m service.scripts.trailing_study

Signals (live rule, 2026-10-11): 4h double top/bottom and 4h BOS, coin and BTC daily trend (close vs EMA50)
both with the trade, signal bar volume >= 2x SMA20. Market entry at the next 4h open.
Exits compared (stop first inside a bar, same initial stop for all):
  fixed   : target 1.5R, max hold 12 bars (live today)
  half    : 50% at 1R then stop to entry, rest trails 2.5 ATR14 behind the best close, max 30 bars
  trail   : no target, trails 2.5 ATR14 behind the best close, max 60 bars
Costs: MEXC taker 0.08%/side + slippage 0.02%/side + funding 0.01% per 8h held. Money: fixed 2.5$ risk/trade.
"""
import math
from collections import defaultdict

from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import STYLES, build
from service.backtest.structure import atr_series
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import resample, year_of

COST = 0.0016 + 0.0004
FUNDING_8H = 0.0001
RISK_USD = 2.5
TRAIL_ATR = 2.5


def exit_fixed(cs, atr, f, side, entry, stop):
    R = abs(entry - stop)
    tgt = entry + side * 1.5 * R
    last = min(f + 11, len(cs) - 1)
    for k in range(f, last + 1):
        c = cs[k]
        if (c.l <= stop) if side > 0 else (c.h >= stop):
            px = c.o if ((c.o < stop) if side > 0 else (c.o > stop)) else stop
            return side * (px / entry - 1), k
        if (c.h >= tgt) if side > 0 else (c.l <= tgt):
            return side * (tgt / entry - 1), k
    return side * (cs[last].c / entry - 1), last


def exit_trail(cs, atr, f, side, entry, stop, half_at=None, max_bars=60, mult=TRAIL_ATR):
    """Trailing stop updated on each bar close; optional half take-profit at `half_at` R then stop to entry."""
    R = abs(entry - stop)
    booked, size = 0.0, 1.0
    best = entry
    last = min(f + max_bars - 1, len(cs) - 1)
    for k in range(f, last + 1):
        c = cs[k]
        if (c.l <= stop) if side > 0 else (c.h >= stop):
            px = c.o if ((c.o < stop) if side > 0 else (c.o > stop)) else stop
            return booked + size * side * (px / entry - 1), k
        if half_at and size == 1.0:
            tp = entry + side * half_at * R
            if (c.h >= tp) if side > 0 else (c.l <= tp):
                booked, size = 0.5 * side * (tp / entry - 1), 0.5
                stop = entry if side > 0 and stop < entry or side < 0 and stop > entry else stop
        best = max(best, c.c) if side > 0 else min(best, c.c)
        trail = best - side * mult * atr[k]
        stop = max(stop, trail) if side > 0 else min(stop, trail)
    return booked + size * side * (cs[last].c / entry - 1), last


EXITS = {
    "fixed": exit_fixed,
    "half": lambda cs, atr, f, s, e, st: exit_trail(cs, atr, f, s, e, st, half_at=1.0, max_bars=30),
    "trail": lambda cs, atr, f, s, e, st: exit_trail(cs, atr, f, s, e, st, max_bars=60),
}


def trades(exit_name, entry_mode="open", exit_fn=None):
    """entry_mode: "open" = market at next open; "stop" = stop order at the signal bar extreme, next bar only."""
    exit_fn = exit_fn or EXITS[exit_name]
    btc = daily_trend(load("BTCUSDT-PERP", "1h", include_holdout=True))
    out = []
    for fp in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        sym = fp.name.split("-PERP")[0]
        c1 = load(fp.name.split("_")[0], "1h", include_holdout=True)
        own = daily_trend(c1)
        cs = resample(c1, 4)
        x, atr = build(cs), atr_series(cs)
        busy = 0
        for i in range(260, len(cs) - 2):
            if i <= busy:
                continue
            for key in ("double_top_bottom", "bos"):
                s = STYLES[key][1](x, i)
                if not s:
                    continue
                side, t = s["side"], cs[i].t + 4 * 3_600_000
                if not (trend_at(btc, t) == side and trend_at(own, t) == side):
                    continue
                if not x.vol_avg[i] or cs[i].v / x.vol_avg[i] < 2.0:
                    continue
                f, entry = i + 1, cs[i + 1].o
                if entry_mode == "stop":
                    lvl = cs[i].h if side > 0 else cs[i].l
                    nb = cs[f]
                    if not ((nb.h >= lvl) if side > 0 else (nb.l <= lvl)):
                        continue
                    entry = max(lvl, nb.o) if side > 0 else min(lvl, nb.o)  # gap through the trigger fills at the open
                risk = side * (entry - s["stop"]) / entry
                if not 0.004 <= risk <= 0.08:
                    continue
                gross, k = exit_fn(cs, atr, f, side, entry, s["stop"])
                net = gross - COST - FUNDING_8H * (k - i) * 4 / 8
                out.append({"style": key, "year": year_of(cs[f].t), "r": net / risk, "t_out": cs[k].t, "sym": sym, "side": side, "risk": risk})
                busy = k
                break
    return out


def stats(rs):
    n = len(rs)
    if n < 2:
        return f"n={n}"
    m = sum(rs) / n
    sd = math.sqrt(sum((v - m) ** 2 for v in rs) / (n - 1))
    big = sum(v >= 3 for v in rs)
    return f"n={n:4d} thắng {sum(v > 0 for v in rs) / n:.0%} TB {m:+.3f}R t={m / (sd / math.sqrt(n)):+.1f} | ≥3R: {big} lệnh | ròng {m * n * RISK_USD:+.0f}$"


def main():
    for name in EXITS:
        tr = trades(name)
        print(f"== thoát '{name}'")
        for style in ("double_top_bottom", "bos"):
            g = [t for t in tr if t["style"] == style]
            old = [t["r"] for t in g if t["year"] <= 2024]
            new = [t["r"] for t in g if t["year"] >= 2025]
            print(f"  {style:18s} 2023–24: {stats(old)}")
            print(f"  {'':18s} 2025–26: {stats(new)}")
        by_year = defaultdict(float)
        for t in tr:
            by_year[t["year"]] += t["r"] * RISK_USD
        print("  theo năm (2.5$/lệnh): " + " ".join(f"{y}:{v:+.0f}$" for y, v in sorted(by_year.items())))
        print()


if __name__ == "__main__":
    main()
