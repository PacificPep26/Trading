"""Owner (2026-10-14): "just tune the R:R until it's perfect" — does a different TP make the 📌 resting limit better?

Usage: python -m service.scripts.limit_tp_study

Same entry as live (lib/patterns.ts restingLimit + lib/resting-limit.ts with replacePending): 1H swing low just
confirmed, coin daily trend up, buy limit 0.5 ATR below the low, SL 1.5 ATR below the limit, one order per coin and
a newer swing low replaces the unfilled one, 24 bars to fill, cancel if TP trades first, no TP on the fill bar,
max 48 bars, stop first. Entries are identical for every mode (cancel when price reaches the previous 1H swing high
before the fill); only the exit changes: TP at that swing high (live), fixed 0.5–3 R, or "half" = take 50% at 1R,
move the stop to entry, rest to the swing high.
Fee 0 (manual), slippage 0.04% round trip, 2.5$/trade, 2025 and 2026 reported separately.
"""
from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import W, build
from service.scripts import trailing_study as T
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import year_of

COST = 0.0004
MODES = ["swing", 0.5, 0.7, 1.0, 1.5, 2.0, 3.0, "half"]


def candidates(cs, own, x):
    out = []
    for sw in x.lows:
        start = sw + W
        if start + 2 >= len(cs) or year_of(cs[start].t) < 2025 or trend_at(own, cs[start].t) != 1:
            continue
        prev = cs[max(0, sw - 20) : sw]
        if sum(c.v for c in prev) and cs[sw].v >= 2.5 * sum(c.v for c in prev) / len(prev):
            continue  # live: skip lows printed on >= 2.5x volume
        a = x.atr[start]
        limit = cs[sw].l - 0.5 * a
        stop = limit - 1.5 * a
        opp = [j for j in x.highs if j < sw]
        if not opp:
            continue
        swing = cs[opp[-1]].h
        if swing - limit < limit - stop:  # entry filter unchanged across TP modes (live: swing TP >= 1R)
            continue
        out.append((start, limit, stop, swing))
    return out


def trades(cs, cands, mode):
    out, busy = [], 0
    for n, (start, limit, stop, swing) in enumerate(cands):
        if start <= busy:
            continue
        nxt = cands[n + 1][0] if n + 1 < len(cands) else len(cs)  # a newer swing low replaces the unfilled limit
        fill = None
        for j in range(start, min(start + 24, nxt, len(cs))):
            b = cs[j]
            if b.l <= limit:
                fill = j
                break
            if b.h >= swing:
                break  # ran to the target without us
        if fill is None:
            continue
        entry = min(limit, cs[fill].o)
        risk = (entry - stop) / entry
        if not 0.003 <= risk <= 0.06:
            continue
        g, kk = None, min(fill + 47, len(cs) - 1)
        if mode == "half":
            tp1, sl, booked = entry + (entry - stop), stop, 0.0
            for j in range(fill, kk + 1):
                b = cs[j]
                if b.l <= sl:
                    g, kk = booked + (0.5 if booked else 1.0) * (sl / entry - 1), j
                    break
                if j > fill and not booked and b.h >= tp1:
                    booked, sl = 0.5 * (tp1 / entry - 1), entry
                if j > fill and booked and b.h >= swing:
                    g, kk = booked + 0.5 * (swing / entry - 1), j
                    break
            if g is None:
                g = booked + (0.5 if booked else 1.0) * (cs[kk].c / entry - 1)
        else:
            tp = swing if mode == "swing" else entry + mode * (entry - stop)
            for j in range(fill, kk + 1):
                b = cs[j]
                if b.l <= stop:
                    g, kk = stop / entry - 1, j
                    break
                if j > fill and b.h >= tp:
                    g, kk = tp / entry - 1, j
                    break
            if g is None:
                g = cs[kk].c / entry - 1
        out.append({"year": year_of(cs[fill].t), "r": (g - COST) / risk, "start": start})
        busy = kk
    return out


def main():
    res = {m: {2025: [], 2026: []} for m in MODES}
    for fp in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        name = fp.name.split("_")[0]
        if name.replace("USDT-PERP", "") not in LIVE_COINS:
            continue
        cs = load(name, "1h", include_holdout=True)
        cands = candidates(cs, daily_trend(cs), build(cs))
        for m in MODES:
            for t in trades(cs, cands, m):
                res[m][t["year"]].append(t["r"])
    for m in MODES:
        print({"swing": "TP đỉnh 1H trước (live)", "half": "Chốt 50% ở 1R + dời SL hoà vốn, còn lại tới đỉnh 1H"}.get(m, f"TP cố định {m}R"))
        for y in (2025, 2026):
            print(f"  {y}: {T.stats(res[m][y])}")


if __name__ == "__main__":
    main()
