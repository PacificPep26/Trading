"""Entry method for the manual 1H/4H reversal alert (lib/patterns.ts sweepAt + wickReversal), 21 bot coins.

Usage: python -m service.scripts.sweep_entry_study

Signal (same as the Telegram alert): bar p sweeps the last confirmed swing low (or the 24-bar low) — wick below,
close back above or lower wick >= body — then bar c closes strong (body >= 60% of range) above p's high. Mirror for shorts.
Stop beyond p's wick + 0.1 ATR. TP 1.8R from the actual fill. Max hold 24 bars, stop first inside a bar.
Entries compared:
  market : next bar open (what the alert says today)
  level  : limit at the swept level, waits up to 3 bars
  half   : limit at 50% of the confirmation candle body, waits up to 3 bars
  early  : no confirmation — market at the open right after the sweep candle (the ⏳ alert), stop beyond its wick
Costs as trailing_study (taker both sides, conservative for limits). Split 2023–24 / 2025+, all vs with daily trend (coin + BTC).
"""
import bisect

from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import W, build
from service.scripts import trailing_study as T
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import resample, year_of

WAIT, HOLD, TP_R = 3, 24, 1.8


def sweep_at(x, k):
    """lib/patterns.ts sweepAt: side and swept level for bar k, or None."""
    cs = x.cs
    if k < 25:
        return None
    p = cs[k]
    lows = x.lows[: bisect.bisect_right(x.lows, k - 1 - W)]
    highs = x.highs[: bisect.bisect_right(x.highs, k - 1 - W)]
    prior = cs[k - 24 : k]
    body = abs(p.c - p.o)
    for L in ([cs[lows[-1]].l] if lows else []) + [min(b.l for b in prior)]:
        if p.l < L < p.h and (p.c > L or min(p.o, p.c) - p.l >= body):
            return 1, L
    for L in ([cs[highs[-1]].h] if highs else []) + [max(b.h for b in prior)]:
        if p.l < L < p.h and (p.c < L or p.h - max(p.o, p.c) >= body):
            return -1, L
    return None


def fill_limit(cs, start, side, price, stop):
    """First bar in [start, start+WAIT) touching the limit; gap through fills at the open. None if stop hit first or no fill."""
    for j in range(start, min(start + WAIT, len(cs))):
        b = cs[j]
        if (b.o <= stop) if side > 0 else (b.o >= stop):
            return None
        if (b.l <= price) if side > 0 else (b.h >= price):
            return j, (min(price, b.o) if side > 0 else max(price, b.o))
    return None


def run_out(cs, f, side, entry, stop):
    tp = entry + side * TP_R * abs(entry - stop)
    last = min(f + HOLD - 1, len(cs) - 1)
    for k in range(f, last + 1):
        b = cs[k]
        if (b.l <= stop) if side > 0 else (b.h >= stop):
            px = b.o if ((b.o < stop) if side > 0 else (b.o > stop)) else stop
            return side * (px / entry - 1), k
        if (b.h >= tp) if side > 0 else (b.l <= tp):
            return side * (tp / entry - 1), k
    return side * (cs[last].c / entry - 1), last


def trades(hours):
    btc = daily_trend(load("BTCUSDT-PERP", "1h", include_holdout=True))
    out = {m: [] for m in ("early", "market", "level", "half")}
    for fp in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        name = fp.name.split("_")[0]
        if name.replace("USDT-PERP", "") not in LIVE_COINS:
            continue
        c1 = load(name, "1h", include_holdout=True)
        own = daily_trend(c1)
        cs = c1 if hours == 1 else resample(c1, hours)
        x = build(cs)
        busy = {m: 0 for m in out}
        for i in range(30, len(cs) - 2):
            # early: sweep candle i-1 just closed, enter at bar i open
            sw = sweep_at(x, i - 1)
            if sw and i > busy["early"]:
                side, p = sw[0], cs[i - 1]
                stop = p.l - 0.1 * x.atr[i - 1] if side > 0 else p.h + 0.1 * x.atr[i - 1]
                entry, t = cs[i].o, cs[i].t
                risk = side * (entry - stop) / entry
                if 0.002 <= risk <= 0.08:
                    g, k = run_out(cs, i, side, entry, stop)
                    net = g - T.COST - T.FUNDING_8H * (k - i + 1) * hours / 8
                    aligned = trend_at(btc, t) == side and trend_at(own, t) == side
                    vr = p.v / x.vol_avg[i - 1] if x.vol_avg[i - 1] else 0
                    out["early"].append({"year": year_of(t), "r": net / risk, "aligned": aligned, "own": trend_at(own, t) == side, "vr": vr})
                    busy["early"] = k
            if not sw:
                continue
            side, level = sw
            p, c, a = cs[i - 1], cs[i], x.atr[i]
            if abs(c.c - c.o) < 0.6 * (c.h - c.l) or not ((c.c > c.o and c.c > p.h) if side > 0 else (c.c < c.o and c.c < p.l)):
                continue
            stop = p.l - 0.1 * a if side > 0 else p.h + 0.1 * a
            t = c.t + hours * 3_600_000
            aligned = trend_at(btc, t) == side and trend_at(own, t) == side
            plans = {"market": (i + 1, cs[i + 1].o), "level": fill_limit(cs, i + 1, side, level, stop),
                     "half": fill_limit(cs, i + 1, side, (c.o + c.c) / 2, stop)}
            for m, fill in plans.items():
                if not fill or i <= busy[m]:
                    continue
                f, entry = fill
                risk = side * (entry - stop) / entry
                if not 0.002 <= risk <= 0.08:
                    continue
                g, k = run_out(cs, f, side, entry, stop)
                net = g - T.COST - T.FUNDING_8H * (k - i) * hours / 8
                vr = p.v / x.vol_avg[i - 1] if x.vol_avg[i - 1] else 0
                out[m].append({"year": year_of(cs[f].t), "r": net / risk, "aligned": aligned, "own": trend_at(own, t) == side, "vr": vr})
                busy[m] = k
    return out


def main():
    for hours in (1, 4):
        res = trades(hours)
        print(f"== {hours}H")
        for m, tr in res.items():
            for label, sel in (("tất cả", lambda t: True), ("thuận trend", lambda t: t["aligned"]),
                               ("thuận coin", lambda t: t["own"]), ("coin+vol≥1.5x", lambda t: t["own"] and t["vr"] >= 1.5),
                               ("coin+vol≥2x", lambda t: t["own"] and t["vr"] >= 2.0), ("tất cả vol≥2x", lambda t: t["vr"] >= 2.0)):
                a = [t["r"] for t in tr if sel(t) and t["year"] <= 2024]
                b = [t["r"] for t in tr if sel(t) and t["year"] >= 2025]
                print(f"  {m:6s} {label:14s} 23–24 {T.stats(a)}")
                print(f"  {'':6s} {'':14s} 25–26 {T.stats(b)}")


if __name__ == "__main__":
    main()
