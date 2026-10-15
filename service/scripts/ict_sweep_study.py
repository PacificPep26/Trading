"""Owner (2026-10-15, two trading videos): ICT liquidity sweep of the previous day's high/low.

Usage: python -m service.scripts.ict_sweep_study

Short (mirror for long), per UTC day, at most one setup per side per day:
  1. Sweep: a bar trades above PDH (previous UTC day's high).
  2. ChoCh: within 24 bars a bar CLOSES below the last confirmed swing low before the sweep (W=3 swings).
  3. FVG: the latest bearish gap between the sweep and the ChoCh bar (high[k] < low[k-2]).
     Sell limit at the gap's near edge ("mép") or its middle ("giữa"), valid 24 bars; cancel if TP trades first.
  4. SL = highest high from the sweep to the ChoCh + 0.1 ATR. TP = PDL. Skip if TP < 1.5R (video 2: target too close).
Exit: stop first, no TP on the fill bar, max 48 bars. Filter (video 2 "big picture first"): none / coin daily trend agrees.
21 bot coins, 15m and 1H, 2025–2026, fee 0, slippage 0.04% round trip, 2.5$/trade.
Pick on 2025, check 2026, vs random entries (same coin/year/daily trend/side, same SL% and TP%).
"""
from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import build, confirmed
from service.scripts import fee0_shootout as X
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import year_of

DAY, COST, MAXB = 86_400_000, 0.0004, 48


def day_levels(cs):
    lv = {}
    for c in cs:
        d = c.t // DAY
        h, l = lv.get(d, (c.h, c.l))
        lv[d] = (max(h, c.h), min(l, c.l))
    return lv


def setup(cs, x, i0, i1, side, pdh, pdl):
    """First sweep setup of one side inside bars [i0, i1). Returns (choch, limit_edge, limit_mid, stop, tp) or None."""
    for s in range(i0, i1):
        c = cs[s]
        if not ((c.h > pdh) if side < 0 else (c.l < pdl)):
            continue
        ref = confirmed(x.lows if side < 0 else x.highs, s, 1)
        if not ref:
            return None
        lvl = cs[ref[0]].l if side < 0 else cs[ref[0]].h
        ext = c.h if side < 0 else c.l
        for k in range(s + 1, min(s + 25, len(cs))):
            b = cs[k]
            ext = max(ext, b.h) if side < 0 else min(ext, b.l)
            if (b.c < lvl) if side < 0 else (b.c > lvl):
                gaps = [j for j in range(s + 2, k + 1)
                        if ((cs[j].h < cs[j - 2].l) if side < 0 else (cs[j].l > cs[j - 2].h))]
                if not gaps:
                    return None
                j = gaps[-1]
                near, far = (cs[j].h, cs[j - 2].l) if side < 0 else (cs[j].l, cs[j - 2].h)
                stop = ext - side * 0.1 * x.atr[k]
                return k, near, (near + far) / 2, stop, (pdl if side < 0 else pdh)
        return None
    return None


def trade(cs, k, side, limit, stop, tp):
    if side * (tp - limit) < 1.5 * abs(stop - limit):
        return None
    fill = None
    for j in range(k + 1, min(k + 25, len(cs))):
        b = cs[j]
        if (b.h >= limit) if side < 0 else (b.l <= limit):
            fill = j
            break
        if (b.l <= tp) if side < 0 else (b.h >= tp):
            return None
    if fill is None:
        return None
    entry = max(limit, cs[fill].o) if side < 0 else min(limit, cs[fill].o)
    risk = abs(stop - entry) / entry
    if not 0.002 <= risk <= 0.06 or side * (tp - entry) <= 0:
        return None
    g, last = None, min(fill + MAXB - 1, len(cs) - 1)
    for j in range(fill, last + 1):
        b = cs[j]
        if (b.h >= stop) if side < 0 else (b.l <= stop):
            g = side * (stop / entry - 1)
            break
        if j > fill and ((b.l <= tp) if side < 0 else (b.h >= tp)):
            g = side * (tp / entry - 1)
            break
    if g is None:
        g = side * (cs[last].c / entry - 1)
    return {"year": year_of(cs[fill].t), "side": side, "risk": risk, "tp": abs(tp / entry - 1), "r": (g - COST) / risk}


def run():
    res = {}
    for fp in sorted(DATA_DIR.glob("*-PERP_15m.csv")):
        sym = fp.name.split("_")[0]
        if sym.replace("USDT-PERP", "") not in LIVE_COINS:
            continue
        own = daily_trend(load(sym, "1h", include_holdout=True))
        for tf in ("15m", "1h"):
            cs = load(sym, tf, include_holdout=True)
            x, lv = build(cs), day_levels(cs)
            starts = {}
            for i, c in enumerate(cs):
                starts.setdefault(c.t // DAY, i)
            days = sorted(starts)
            for n, d in enumerate(days[1:-1], 1):
                if year_of(d * DAY) < 2025 or (d - 1) not in lv:
                    continue
                pdh, pdl = lv[d - 1]
                i0, i1 = starts[d], starts[days[n + 1]]
                tr = trend_at(own, d * DAY)
                for side in (1, -1):
                    st = setup(cs, x, i0, i1, side, pdh, pdl)
                    if not st:
                        continue
                    k, edge, mid, stop, tp = st
                    for entry_name, limit in (("mép FVG", edge), ("giữa FVG", mid)):
                        t = trade(cs, k, side, limit, stop, tp)
                        if not t:
                            continue
                        t.update(sym=sym, trend=tr)
                        for flt in ("không lọc", "thuận ngày"):
                            if flt == "thuận ngày" and tr != side:
                                continue
                            res.setdefault((tf, entry_name, flt), []).append(t)
    return res


def main():
    res = run()
    mean = lambda xs: sum(x["r"] for x in xs) / len(xs) if xs else float("-inf")
    keys = sorted(res, key=lambda k: -mean([x for x in res[k] if x["year"] == 2025]))
    print("Chọn bằng 2025 (xếp từ tốt nhất), kiểm 2026:\n")
    for key in keys:
        tf, entry_name, flt = key
        rows = res[key]
        print(f"{tf} · vào {entry_name} · {flt}")
        X.show("  thật", {y: [x["r"] for x in rows if x["year"] == y] for y in X.YEARS})
        for side, nm in ((1, "LONG"), (-1, "SHORT")):
            print(f"    {nm}: " + " | ".join(f"{y} {X.T.stats([x['r'] for x in rows if x['year'] == y and x['side'] == side])}" for y in X.YEARS))
        rc = X.fixed_control([x for x in rows if x["trend"] != 0], tf, MAXB)
        X.show("  vào ngẫu nhiên", {y: [x["r"] for x in rc if x["year"] == y] for y in X.YEARS})
        print()


if __name__ == "__main__":
    main()
