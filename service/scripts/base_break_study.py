"""Base breakdown / breakout + retest (owner + chat read 2026-10-13), 15m, 21 bot coins.

Usage: python -m service.scripts.base_break_study

Base: the 12 15m bars (3h) before bar i span at most 3 x ATR14(15m). Break: bar i closes below the base low
(short) / above the base high (long) and the previous close was inside. Entry: limit back at the broken edge
within 8 bars (retest); skip if the stop is hit first. Stop: other side of the base + 0.1 ATR.
Exits compared: TP 2R fixed; TP at the next 1h swing (only if >= 1R); trailing 3 x ATR(15m), no TP. Max 48 bars.
Filters: all / coin daily trend agrees / coin + BTC daily trend agree. Costs as trailing_study. 2023-24 vs 2025+.
"""
import bisect

from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import W, build
from service.backtest.structure import atr_series
from service.scripts import trailing_study as T
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import year_of

BASE, WAIT, HOLD = 12, 8, 48


def run():
    btc_d = daily_trend(load("BTCUSDT-PERP", "1h", include_holdout=True))
    res = {e: [] for e in ("tp2R", "swing", "trail")}
    for fp in sorted(DATA_DIR.glob("*-PERP_15m.csv")):
        name = fp.name.split("_")[0]
        coin = name.replace("USDT-PERP", "")
        if coin not in LIVE_COINS or not (DATA_DIR / f"{name}_1h.csv").exists():
            continue
        cs = load(name, "15m", include_holdout=True)
        c1 = load(name, "1h", include_holdout=True)
        own = daily_trend(c1)
        x1, t1 = build(c1), [c.t for c in c1]
        atr = atr_series(cs)
        busy = {e: 0 for e in res}
        i = BASE + 20
        while i < len(cs) - WAIT - 2:
            base = cs[i - BASE : i]
            hi, lo, a = max(b.h for b in base), min(b.l for b in base), atr[i - 1]
            c, p = cs[i], cs[i - 1]
            side = -1 if (c.c < lo <= p.c) else 1 if (c.c > hi >= p.c) else 0
            if not side or hi - lo > 3 * a:
                i += 1
                continue
            edge = lo if side < 0 else hi
            stop = hi + 0.1 * a if side < 0 else lo - 0.1 * a
            fill = None
            for j in range(i + 1, i + 1 + WAIT):
                b = cs[j]
                if (b.h >= stop) if side < 0 else (b.l <= stop):
                    break
                if (b.h >= edge) if side < 0 else (b.l <= edge):
                    fill = j
                    break
            if fill is None:
                i += 1
                continue
            entry = edge
            risk = abs(entry - stop) / entry
            if not 0.002 <= risk <= 0.06:
                i += 1
                continue
            h = bisect.bisect_right(t1, cs[i].t - 3_600_000) - 1
            sw = x1.lows if side < 0 else x1.highs
            n = bisect.bisect_right(sw, h - W)
            swing_tp = None
            for k in reversed(sw[max(0, n - 20) : n]):
                px = c1[k].l if side < 0 else c1[k].h
                if (px < entry) if side < 0 else (px > entry):
                    swing_tp = px + 0.1 * a if side < 0 else px - 0.1 * a
                    break
            tps = {"tp2R": entry + side * 2 * abs(entry - stop),
                   "swing": swing_tp if swing_tp and side * (swing_tp - entry) >= abs(entry - stop) else None,
                   "trail": None}
            t = cs[i].t
            info = {"year": year_of(t), "coin_ok": trend_at(own, t) == side, "btc_ok": trend_at(btc_d, t) == side}
            for e, tp in tps.items():
                if fill <= busy[e] or (e == "swing" and tp is None):
                    continue
                st, best, g, last = stop, entry, None, min(fill + HOLD - 1, len(cs) - 1)
                for k in range(fill, last + 1):
                    b = cs[k]
                    if (b.h >= st) if side < 0 else (b.l <= st):
                        px = b.o if ((b.o > st) if side < 0 else (b.o < st)) and k > fill else st
                        g = side * (px / entry - 1); break
                    if tp is not None and ((b.l <= tp) if side < 0 else (b.h >= tp)):
                        g = side * (tp / entry - 1); break
                    if e == "trail":
                        best = min(best, b.c) if side < 0 else max(best, b.c)
                        trail = best - side * 3 * atr[k]
                        st = min(st, trail) if side < 0 else max(st, trail)
                if g is None:
                    g, k = side * (cs[last].c / entry - 1), last
                res[e].append({**info, "side": side, "r": (g - T.COST) / risk})
                busy[e] = k
            i += 1
    return res


def main():
    res = run()
    for e, tr in res.items():
        print(f"== thoát: {e}")
        for label, sel in (("tất cả", lambda r: True), ("thuận coin", lambda r: r["coin_ok"]),
                           ("thuận coin+BTC", lambda r: r["coin_ok"] and r["btc_ok"]),
                           ("SHORT thuận coin", lambda r: r["side"] < 0 and r["coin_ok"])):
            a = [r["r"] for r in tr if sel(r) and r["year"] <= 2024]
            b = [r["r"] for r in tr if sel(r) and r["year"] >= 2025]
            print(f"  {label:17s} 23–24 {T.stats(a)}\n  {'':17s} 25–26 {T.stats(b)}")


if __name__ == "__main__":
    main()
