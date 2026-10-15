"""Owner's video hub (docs/research/MASTER_VIDEO_HUB.md, 2026-10-15): the two new rules that can be written down.

Usage: python -m service.scripts.video_hub_study

1. Rayner Teo "T.A.E" (candlestick course, ch. 6–12): Trend = close vs SMA200 (long only above, short only below);
   Area of value = (a) SMA50 touched (low <= MA50 + 0.2 ATR, close above; mirror) or (b) previous resistance turned support
   (the swing high broken by the newest swing high, low within 0.2 ATR, close above; mirror); Entry trigger on that bar =
   bullish engulfing, hammer / dragonfly doji (rejection wick >= 2x body and >= 60% of range, close in the top third),
   morning star (big red, small body, green closing above the first bar's middle) or tweezer bottom (two lows within 0.1 ATR,
   red then green). Next open; SL = pattern extreme − 0.3 ATR ("give it some buffer"); TP before the opposite swing
   (last swing high − 0.1 ATR, >= 1R) or fixed 2R.
2. VN Rebates #2 Asia → London sweep: Asia range = 00:00–07:00 UTC; between 07:00 and 11:00 UTC a 15m bar takes out one side,
   then a 15m bar closes beyond the open of the bar that made the sweep extreme (CISD) → next open; SL beyond the sweep
   extreme + 0.1 ATR; TP = the other side of the Asia range (>= 1R). One trade per coin per day.
21 bot coins, 1H/4H for (1), 15m for (2); 2025–2026; fee 0; slippage 0.04%; stop first; max 48 bars; random control.
"""
from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import build, confirmed
from service.scripts import fee0_shootout as X
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import resample, year_of

COST, MAXB, H = 0.0004, 48, 3_600_000


def exit_r(cs, f, side, entry, stop, tp):
    last = min(f + MAXB - 1, len(cs) - 1)
    for j in range(f, last + 1):
        b = cs[j]
        if (b.l <= stop) if side > 0 else (b.h >= stop):
            return side * ((b.o if ((b.o < stop) if side > 0 else (b.o > stop)) else stop) / entry - 1)
        if (b.h >= tp) if side > 0 else (b.l <= tp):
            return side * (tp / entry - 1)
    return side * (cs[last].c / entry - 1)


def row(cs, f, side, entry, stop, tp, name, tf, sym, own):
    risk = side * (entry - stop) / entry
    if not 0.003 <= risk <= 0.06 or side * (tp - entry) < side * (entry - stop):
        return None
    return {"name": name, "tf": tf, "sym": sym, "year": year_of(cs[f].t), "side": side, "risk": risk,
            "tp": abs(tp / entry - 1), "trend": trend_at(own, cs[f].t), "r": (exit_r(cs, f, side, entry, stop, tp) - COST) / risk}


def sma(cs, n):
    out, s = [None] * len(cs), 0.0
    for i, c in enumerate(cs):
        s += c.c
        if i >= n:
            s -= cs[i - n].c
        if i >= n - 1:
            out[i] = s / n
    return out


def trigger(cs, i, a, side):
    """Bullish (side 1) / bearish (side -1) reversal candle at bar i. Returns the pattern extreme or None."""
    c, p, q = cs[i], cs[i - 1], cs[i - 2]
    up = lambda b: (b.c - b.o) * side  # >0 = candle in the trade direction
    rng = c.h - c.l
    body = abs(c.c - c.o)
    wick = (min(c.o, c.c) - c.l) if side > 0 else (c.h - max(c.o, c.c))
    ext = (lambda *bs: min(b.l for b in bs)) if side > 0 else (lambda *bs: max(b.h for b in bs))
    if up(c) > 0 and up(p) < 0 and side * (c.c - p.o) >= 0 and side * (p.c - c.o) >= 0:
        return ext(c, p)  # engulfing
    if rng > 0 and wick >= 2 * body and wick >= 0.6 * rng and (((c.c - c.l) if side > 0 else (c.h - c.c)) >= 2 / 3 * rng):
        return ext(c)  # hammer / dragonfly doji (mirror: shooting star / gravestone)
    if up(q) < 0 and abs(q.c - q.o) >= 0.5 * a and abs(p.c - p.o) <= 0.3 * abs(q.c - q.o) and up(c) > 0 and side * (c.c - (q.o + q.c) / 2) > 0:
        return ext(q, p, c)  # morning / evening star
    if up(p) < 0 and up(c) > 0 and abs(ext(p) - ext(c)) <= 0.1 * a:
        return ext(p, c)  # tweezer
    return None


def tae(cs, x, own, tf, sym):
    out, ma50, ma200 = [], sma(cs, 50), sma(cs, 200)
    busy = 0
    for i in range(210, len(cs) - MAXB - 2):
        if year_of(cs[i].t) < 2025 or i <= busy:
            continue
        c, a = cs[i], x.atr[i]
        side = 1 if c.c > ma200[i] else -1
        hs = confirmed(x.highs if side > 0 else x.lows, i, 4)
        top = (lambda k: cs[k].h) if side > 0 else (lambda k: cs[k].l)
        areas = []
        near = lambda lvl: ((c.l <= lvl + 0.2 * a and c.c > lvl) if side > 0 else (c.h >= lvl - 0.2 * a and c.c < lvl))
        if near(ma50[i]):
            areas.append("MA50")
        if len(hs) >= 2 and side * (top(hs[-1]) - top(hs[-2])) > 0 and near(top(hs[-2])):
            areas.append("cản cũ")
        if not areas:
            continue
        ext = trigger(cs, i, a, side)
        if ext is None:
            continue
        e = cs[i + 1].o
        stop = ext - side * 0.3 * a
        swing = top(hs[-1]) - side * 0.1 * a if hs else None
        for area in areas:
            for tp_name, tp in (("TP trước swing", swing), ("TP 2R", e + 2 * (e - stop))):
                if tp is None:
                    continue
                r = row(cs, i + 1, side, e, stop, tp, f"T.A.E · {area} · {tp_name}", tf, sym, own)
                if r:
                    out.append(r)
        busy = i + 3
    return out


def asia(cs, x, own, sym):
    out, days = [], {}
    for k, b in enumerate(cs):
        days.setdefault(b.t // 86_400_000, []).append(k)
    for d, idx in days.items():
        if year_of(d * 86_400_000) < 2025:
            continue
        a_idx = [k for k in idx if (cs[k].t // H) % 24 < 7]
        l_idx = [k for k in idx if 7 <= (cs[k].t // H) % 24 < 11]
        if len(a_idx) < 20 or not l_idx:
            continue
        hi, lo = max(cs[k].h for k in a_idx), min(cs[k].l for k in a_idx)
        done = False
        for k in l_idx:
            if done:
                break
            for side, swept in ((1, cs[k].l < lo), (-1, cs[k].h > hi)):
                if not swept:
                    continue
                # extreme of the sweep and the bar that made it, then the first close beyond that bar's open (CISD)
                seg = [j for j in l_idx if j >= k]
                ext_k = k
                for j in seg:
                    if (cs[j].l < cs[ext_k].l) if side > 0 else (cs[j].h > cs[ext_k].h):
                        ext_k = j
                    if j > ext_k and ((cs[j].c > cs[ext_k].o) if side > 0 else (cs[j].c < cs[ext_k].o)) and j + 1 < len(cs):
                        e = cs[j + 1].o
                        stop = (cs[ext_k].l - 0.1 * x.atr[j]) if side > 0 else (cs[ext_k].h + 0.1 * x.atr[j])
                        r = row(cs, j + 1, side, e, stop, hi if side > 0 else lo, "Phiên Á → Âu quét + CISD", "15m", sym, own)
                        if r:
                            out.append(r)
                        break
                done = True
                break
    return out


def main():
    rows = []
    for fp in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        sym = fp.name.split("_")[0]
        if sym.replace("USDT-PERP", "") not in LIVE_COINS:
            continue
        c1 = load(sym, "1h", include_holdout=True)
        own = daily_trend(c1)
        c4 = resample(c1, 4)
        rows += tae(c1, build(c1), own, "1h", sym) + tae(c4, build(c4), own, "4h", sym)
        if (DATA_DIR / f"{sym}_15m.csv").exists():
            m = load(sym, "15m", include_holdout=True)
            rows += asia(m, build(m), own, sym)
    for name in sorted({r["name"] for r in rows}):
        for tf in ("1h", "4h", "15m"):
            g = [r for r in rows if r["name"] == name and r["tf"] == tf]
            if len(g) < 20:
                continue
            X.show(f"{name} · {tf}", {y: [r["r"] for r in g if r["year"] == y] for y in X.YEARS})
            for side, nm in ((1, "LONG"), (-1, "SHORT")):
                print(f"    {nm}: " + " | ".join(f"{y} {X.T.stats([r['r'] for r in g if r['year'] == y and r['side'] == side])}" for y in X.YEARS))
            if tf in ("1h", "15m"):
                rc = X.fixed_control([r for r in g if r["trend"] != 0], tf, MAXB)
                X.show("  vào ngẫu nhiên", {y: [r["r"] for r in rc if r["year"] == y] for y in X.YEARS})
            print()


if __name__ == "__main__":
    main()
