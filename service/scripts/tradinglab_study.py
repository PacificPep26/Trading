"""TradingLab "You're Using Liquidity Wrong" (hub, 2026-10-15): inducement zone + FVG → limit at the extreme zone.

Usage: python -m service.scripts.tradinglab_study

SHORT (LONG mirrored): the last two confirmed swing highs A then B with B lower (a down leg with two supply zones).
Between them a bearish FVG (high[j] < low[j-2]) that sits ABOVE B's high and that price has not traded into since →
B is the inducement (its stops are the liquidity, the gap is the magnet). Sell Limit at the low of candle A ("wick to wick
of the candle that started the drop"), SL = A's high + 0.1 ATR, TP = the lowest low since A (the demand); skip if TP < 2R
(video shows 5R). Limit valid 24 bars (as the live paper), cancelled if TP trades first or a newer A/B replaces it; stop first, no TP on the
fill bar, max 48 bars. Controls: same Limit at A without the FVG ("no inducement"), selling at B when the FVG exists (the
trap the video says loses), random entry with the same SL/TP. The video's day-trading frames: 1H and 15m.
21 bot coins, 2025–2026, fee 0, slippage 0.04%.
"""
from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import build, confirmed
from service.scripts import fee0_shootout as X
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import year_of

COST, MAXB = 0.0004, 48


def fill_and_exit(cs, i, side, limit, stop, tp):
    """Limit from bar i+1: (r_gross, fill index) or None if never filled."""
    for j in range(i + 1, min(i + 25, len(cs))):  # live paper: pending 24 bars
        b = cs[j]
        if (b.h >= tp) if side > 0 else (b.l <= tp):
            return None  # ran to target first
        if (b.l <= limit) if side > 0 else (b.h >= limit):
            e = min(limit, b.o) if side > 0 else max(limit, b.o)
            if (b.l <= stop) if side > 0 else (b.h >= stop):
                return side * (stop / e - 1), j, e
            for k in range(j + 1, min(j + MAXB, len(cs))):
                c = cs[k]
                if (c.l <= stop) if side > 0 else (c.h >= stop):
                    return side * ((c.o if ((c.o < stop) if side > 0 else (c.o > stop)) else stop) / e - 1), j, e
                if (c.h >= tp) if side > 0 else (c.l <= tp):
                    return side * (tp / e - 1), j, e
            return side * (cs[min(j + MAXB - 1, len(cs) - 1)].c / e - 1), j, e
    return None


def setups(cs, x, own, tf, sym):
    out, seen = [], set()
    for i in range(60, len(cs) - 2 * MAXB):
        if year_of(cs[i].t) < 2025:
            continue
        a_atr = x.atr[i]
        for side, piv in ((-1, x.highs), (1, x.lows)):
            pts = confirmed(piv, i, 2)
            if len(pts) < 2 or (side, pts[0], pts[1]) in seen:
                continue
            A, B = pts
            ext = (lambda c: c.h) if side < 0 else (lambda c: c.l)
            if not (ext(cs[B]) < ext(cs[A]) if side < 0 else ext(cs[B]) > ext(cs[A])):
                continue
            seen.add((side, A, B))
            # FVG made by the leg away from A, beyond B, untouched up to bar i
            gap = False
            for j in range(A + 2, B + 1):
                if side < 0 and cs[j].h < cs[j - 2].l and cs[j].h > cs[B].h and max(c.h for c in cs[j + 1 : i + 1]) < cs[j].h:
                    gap = True
                if side > 0 and cs[j].l > cs[j - 2].h and cs[j].l < cs[B].l and min(c.l for c in cs[j + 1 : i + 1]) > cs[j].l:
                    gap = True
            tp = min(c.l for c in cs[A : i + 1]) if side < 0 else max(c.h for c in cs[A : i + 1])
            for name, zone in (("A + FVG trên B (đúng video)" if gap else "A không có FVG", cs[A]),
                               *((("bán/mua ở B (bẫy)", cs[B]),) if gap else ())):
                limit = zone.l if side < 0 else zone.h
                stop = zone.h + 0.1 * a_atr if side < 0 else zone.l - 0.1 * a_atr
                if (cs[i].c >= limit) if side < 0 else (cs[i].c <= limit):
                    continue  # price already in the zone
                risk = side * (limit - stop) / limit
                if not 0.003 <= risk <= 0.06 or side * (tp - limit) < 2 * side * (limit - stop):
                    continue
                res = fill_and_exit(cs, i, side, limit, stop, tp)
                if res:
                    g, f, e = res
                    rk = side * (e - stop) / e
                    out.append({"name": f"TradingLab · {name}", "tf": tf, "sym": sym, "year": year_of(cs[f].t), "side": side,
                                "risk": rk, "tp": abs(tp / e - 1), "trend": trend_at(own, cs[f].t), "r": (g - COST) / rk})
    return out


def main():
    rows = []
    for fp in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        sym = fp.name.split("_")[0]
        if sym.replace("USDT-PERP", "") not in LIVE_COINS:
            continue
        c1 = load(sym, "1h", include_holdout=True)
        own = daily_trend(c1)
        rows += setups(c1, build(c1), own, "1h", sym)
        if (DATA_DIR / f"{sym}_15m.csv").exists():
            m = load(sym, "15m", include_holdout=True)
            rows += setups(m, build(m), own, "15m", sym)
    for tf in ("1h", "15m"):
        for name in sorted({r["name"] for r in rows}):
            g = [r for r in rows if r["name"] == name and r["tf"] == tf]
            if len(g) < 20:
                continue
            X.show(f"{name} · {tf}", {y: [r["r"] for r in g if r["year"] == y] for y in X.YEARS})
            print("    " + " | ".join(f"{nm} {y} {X.T.stats([r['r'] for r in g if r['year'] == y and r['side'] == s])}"
                                    for s, nm in ((1, "LONG"), (-1, "SHORT")) for y in X.YEARS))
            if "đúng video" in name:
                rc = X.fixed_control([r for r in g if r["trend"] != 0], tf, MAXB)
                X.show("  vào ngẫu nhiên cùng SL/TP", {y: [r["r"] for r in rc if r["year"] == y] for y in X.YEARS})
            print()


if __name__ == "__main__":
    main()
