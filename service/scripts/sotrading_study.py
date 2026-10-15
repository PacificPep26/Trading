"""Owner (2026-10-15): SO Trading TikTok videos — rules taken from the full spoken transcripts
(docs/research/tiktok-sotrading01-full-transcripts.md). First pass used captions only (see the research log).

Usage: python -m service.scripts.sotrading_study

"Khung lớn hơn một bậc" (videos 4, 14, 22, 21): 1H uses the 4H swing structure, 4H uses the daily structure (trend = HH+HL / LH+LL).
A. Breakout (videos 4, 7): >= 2 swing highs within 0.3 ATR (zone), the last 2 swing lows rise and the last one is within 2 ATR of
   the zone (higher lows squeezing the top); a bar closes above the zone → next open. SL under the last higher low − 0.1 ATR,
   TP 2R, skip if an older swing high sits between entry and TP ("vùng cản bên trái"); SL then trails under each new higher low.
B. Pullback to the broken high (videos 14, 17, 22, 23, 24): trend structure up, old high S = the swing high broken by the newest
   one; within the last 8 bars >= 2 bars dipped to S + 0.2 ATR and closed above S (sellers failed); the current bar is a strong
   bull bar (body >= 60% of range, close above those bars' highs) → next open. SL under the lowest test − 0.1 ATR. TP 2R / 3R.
C. Head & shoulders (video 21): 3 swings, head beyond both shoulders by >= 0.5 ATR, the two necklines troughs within 0.3 ATR
   (flat neckline), right shoulder no higher than the left (closer to the neck); close through the neckline → next open, but if
   the breakout bar body > 1.5 ATR wait for a limit back at the neckline (12 bars). SL beyond the right shoulder + 0.1 ATR;
   TP = measured move, skip if < 1.5R ("chỉ chạy được 1R thì bỏ").
D. Candles at a zone (video 25): D1 "chòm râu" = 3 bars in a row with the rejection wick >= 50% of range, their extremes within
   0.3 ATR and at the 24-bar low/high; D2 "nhấn chìm lần hai" = engulfing bar whose extreme retests a confirmed swing low/high
   (2nd touch) within 0.3 ATR. Next open, SL beyond the wick(s) − 0.1 ATR, TP 2R.
All mirrored for shorts. 21 bot coins, 1H and 4H, 2025–2026, fee 0, slippage 0.04%, 2.5$/trade, stop first, no TP on a limit
fill bar, max 48 bars. Each variant reported with and without the higher-timeframe filter; random control on 1H.
"""
import bisect

from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import build, confirmed, trend
from service.scripts import fee0_shootout as X
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import resample, year_of

COST, MAXB = 0.0004, 48


def exit_r(cs, x, f, side, entry, stop, tp, limit_fill=False, trail=False):
    """Gross return. trail: stop moves to each newer confirmed swing low (long) / high (short) − 0.1 ATR."""
    last = min(f + MAXB - 1, len(cs) - 1)
    for j in range(f, last + 1):
        b = cs[j]
        if (b.l <= stop) if side > 0 else (b.h >= stop):
            px = b.o if ((b.o < stop) if side > 0 else (b.o > stop)) else stop
            return side * (px / entry - 1)
        if (j > f or not limit_fill) and ((b.h >= tp) if side > 0 else (b.l <= tp)):
            return side * (tp / entry - 1)
        if trail:
            sw = confirmed(x.lows if side > 0 else x.highs, j, 1)
            if sw and sw[0] > f:
                lvl = cs[sw[0]].l - 0.1 * x.atr[j] if side > 0 else cs[sw[0]].h + 0.1 * x.atr[j]
                stop = max(stop, lvl) if side > 0 else min(stop, lvl)
    return side * (cs[last].c / entry - 1)


def scan(cs, x, htf, own, tf, sym):
    """htf(t) -> higher-timeframe structure trend at time t."""
    out, busy = [], {}
    step = 3_600_000 if tf == "1h" else 14_400_000

    def rec(name, f, side, entry, stop, tp, **kw):
        risk = side * (entry - stop) / entry
        if not 0.003 <= risk <= 0.06 or side * (tp - entry) <= 0:
            return
        g = exit_r(cs, x, f, side, entry, stop, tp, **kw)
        out.append({"name": name, "tf": tf, "year": year_of(cs[f].t), "side": side, "risk": risk, "tp": abs(tp / entry - 1),
                    "trend": trend_at(own, cs[f].t), "htf": htf(cs[f].t), "sym": sym, "r": (g - COST) / risk})
        busy[(name[0], side)] = f + 6

    for i in range(80, len(cs) - MAXB - 14):
        if year_of(cs[i].t) < 2025 or not x.atr[i]:
            continue
        a, c, p = x.atr[i], cs[i], cs[i - 1]
        for side in (1, -1):
            top = (lambda k: cs[k].h) if side > 0 else (lambda k: cs[k].l)  # extreme toward the trade
            bot = (lambda k: cs[k].l) if side > 0 else (lambda k: cs[k].h)  # extreme against the trade
            hs = confirmed(x.highs if side > 0 else x.lows, i, 8)  # swings in the trade direction
            ls = confirmed(x.lows if side > 0 else x.highs, i, 8)  # swings against it

            # A. breakout after higher lows squeeze a flat top
            if busy.get(("A", side), 0) < i:
                tops = [k for k in hs if k >= i - 60]
                if len(tops) >= 2:
                    zone = max(top(k) for k in tops) if side > 0 else min(top(k) for k in tops)
                    flat = all(abs(top(k) - zone) <= 0.3 * a for k in tops[-2:])
                    lows = [k for k in ls if k > tops[-2]]
                    squeeze = len(lows) >= 2 and side * (bot(lows[-1]) - bot(lows[-2])) > 0 and side * (zone - bot(lows[-1])) <= 2 * a
                    broke = (c.c > zone >= p.c) if side > 0 else (c.c < zone <= p.c)
                    if flat and squeeze and broke:
                        e = cs[i + 1].o
                        stop = bot(lows[-1]) - side * 0.1 * a
                        tp = e + 2 * (e - stop)
                        older = [top(k) for k in confirmed(x.highs if side > 0 else x.lows, i, 40) if k < i - 60]
                        if not any(side * (lvl - e) > 0 and side * (tp - lvl) > 0 for lvl in older):
                            rec("A phá vỡ sau nén (đáy cao dần)", i + 1, side, e, stop, tp, trail=True)

            # B. pullback to the broken old high, sellers fail >= 2 times, strong bull bar
            if busy.get(("B", side), 0) < i and trend(x, i) == side and len(hs) >= 2 and side * (top(hs[-1]) - top(hs[-2])) > 0:
                S = top(hs[-2])
                win = cs[i - 8 : i]
                tests = [b for b in win if ((b.l <= S + 0.2 * a and b.c > S) if side > 0 else (b.h >= S - 0.2 * a and b.c < S))]
                rng = c.h - c.l
                strong = rng > 0 and side * (c.c - c.o) >= 0.6 * rng
                clear = (c.c > max(b.h for b in tests)) if side > 0 and tests else (c.c < min(b.l for b in tests)) if tests else False
                if len(tests) >= 2 and strong and clear:
                    e = cs[i + 1].o
                    stop = (min(b.l for b in tests) - 0.1 * a) if side > 0 else (max(b.h for b in tests) + 0.1 * a)
                    for R in (2, 3):
                        rec(f"B{R} hồi về đỉnh cũ, TP {R}R", i + 1, side, e, stop, e + R * (e - stop))

            # C. head & shoulders (top → short uses swing highs; inverse → long uses swing lows)
            sh = confirmed(x.highs if side < 0 else x.lows, i, 3)
            pk = (lambda k: cs[k].h) if side < 0 else (lambda k: cs[k].l)
            if busy.get(("C", side), 0) < i and len(sh) == 3 and sh[0] >= i - 80:
                l_, h_, r_ = sh
                head_ok = (pk(h_) - max(pk(l_), pk(r_)) >= 0.5 * a) if side < 0 else (min(pk(l_), pk(r_)) - pk(h_) >= 0.5 * a)
                t1 = cs[l_ : h_ + 1]
                t2 = cs[h_ : r_ + 1]
                n1 = min(b.l for b in t1) if side < 0 else max(b.h for b in t1)
                n2 = min(b.l for b in t2) if side < 0 else max(b.h for b in t2)
                right_low = (pk(r_) <= pk(l_)) if side < 0 else (pk(r_) >= pk(l_))
                if head_ok and abs(n1 - n2) <= 0.3 * a and right_low:
                    neck = min(n1, n2) if side < 0 else max(n1, n2)
                    if (c.c < neck <= p.c) if side < 0 else (c.c > neck >= p.c):
                        stop = pk(r_) - side * 0.1 * a
                        tp = neck + side * abs(pk(h_) - neck)
                        if abs(c.c - c.o) <= 1.5 * a:
                            e = cs[i + 1].o
                            if side * (tp - e) >= 1.5 * side * (e - stop):
                                rec("C vai-đầu-vai", i + 1, side, e, stop, tp)
                        else:  # breakout bar too long: wait for the retest
                            for j in range(i + 1, i + 13):
                                if (cs[j].h >= neck) if side < 0 else (cs[j].l <= neck):
                                    e = max(neck, cs[j].o) if side < 0 else min(neck, cs[j].o)
                                    if side * (tp - e) >= 1.5 * side * (e - stop):
                                        rec("C vai-đầu-vai", j, side, e, stop, tp, limit_fill=True)
                                    break

            # D1. wick cluster at the 24-bar extreme
            if busy.get(("D", side), 0) < i:
                trio = cs[i - 2 : i + 1]
                wick = lambda b: (min(b.o, b.c) - b.l) if side > 0 else (b.h - max(b.o, b.c))
                ext = [b.l if side > 0 else b.h for b in trio]
                prior = cs[i - 26 : i - 2]
                at_edge = (min(ext) <= min(b.l for b in prior) + 0.3 * a) if side > 0 else (max(ext) >= max(b.h for b in prior) - 0.3 * a)
                if all(b.h > b.l and wick(b) >= 0.5 * (b.h - b.l) for b in trio) and max(ext) - min(ext) <= 0.3 * a and at_edge:
                    e = cs[i + 1].o
                    stop = (min(ext) - 0.1 * a) if side > 0 else (max(ext) + 0.1 * a)
                    rec("D1 chòm râu", i + 1, side, e, stop, e + 2 * (e - stop))
                # D2. engulfing on the second touch of a confirmed swing
                elif ls:
                    lvl = bot(ls[-1])
                    engulf = (c.c > c.o and p.c < p.o and c.c >= p.o and c.o <= p.c) if side > 0 else (c.c < c.o and p.c > p.o and c.c <= p.o and c.o >= p.c)
                    touch = (abs(min(c.l, p.l) - lvl) <= 0.3 * a) if side > 0 else (abs(max(c.h, p.h) - lvl) <= 0.3 * a)
                    if engulf and touch and ls[-1] < i - 3:
                        e = cs[i + 1].o
                        stop = (min(c.l, p.l) - 0.1 * a) if side > 0 else (max(c.h, p.h) + 0.1 * a)
                        rec("D2 nhấn chìm lần hai", i + 1, side, e, stop, e + 2 * (e - stop))
    return out


def htf_fn(cs_htf, step):
    """Structure trend of the higher timeframe at time t (only closed higher bars)."""
    xh = build(cs_htf)
    ts = [b.t + step for b in cs_htf]
    return lambda t: (lambda k: trend(xh, k) if k >= 30 else 0)(bisect.bisect_right(ts, t) - 1)


def main():
    rows = []
    for fp in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        sym = fp.name.split("_")[0]
        if sym.replace("USDT-PERP", "") not in LIVE_COINS:
            continue
        c1 = load(sym, "1h", include_holdout=True)
        c4, cd = resample(c1, 4), resample(c1, 24)
        own = daily_trend(c1)
        rows += scan(c1, build(c1), htf_fn(c4, 14_400_000), own, "1h", sym)
        rows += scan(c4, build(c4), htf_fn(cd, 86_400_000), own, "4h", sym)
    names = sorted({r["name"] for r in rows})
    for name in names:
        for tf in ("1h", "4h"):
            for flt in ("mọi lúc", "khung lớn ủng hộ"):
                g = [t for t in rows if t["name"] == name and t["tf"] == tf and (flt == "mọi lúc" or t["htf"] == t["side"])]
                if len(g) < 10:
                    continue
                X.show(f"{name} · {tf} · {flt}", {y: [t["r"] for t in g if t["year"] == y] for y in X.YEARS})
                for side, nm in ((1, "LONG"), (-1, "SHORT")):
                    print(f"    {nm}: " + " | ".join(f"{y} {X.T.stats([t['r'] for t in g if t['year'] == y and t['side'] == side])}" for y in X.YEARS))
                if tf == "1h":
                    rc = X.fixed_control([t for t in g if t["trend"] != 0], "1h", MAXB)
                    X.show("  vào ngẫu nhiên", {y: [t["r"] for t in rc if t["year"] == y] for y in X.YEARS})
                print()


if __name__ == "__main__":
    main()
