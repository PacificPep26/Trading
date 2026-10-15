"""Owner (2026-10-15): SO Trading TikTok videos (docs/research/tiktok-sotrading01-content.md) — test every rule that can be
written down. Only captions are available, so each rule is the plainest reading of the caption.

Usage: python -m service.scripts.sotrading_study

A. Breakout of a multi-top zone after compression (videos 4 "vào lệnh phá vỡ", 7 "độ nén của giá"):
   >= 3 swing highs within 0.3 ATR in the last 60 bars (zone = their max); the last 6 bars are tight (range <= 1.5 ATR)
   and press the zone (high within 0.5 ATR); buy stop at zone + 0.05 ATR valid 6 bars; SL under the 6-bar low; TP 2R.
B. Pullback exhaustion (videos 17 "chờ phe bán thất bại 2–3 lần", 14/22/23 "cấu trúc, khung lớn, vùng cản, tín hiệu", 25 "chòm râu"):
   structure in trend (higher highs/lows); support = the swing high that was broken; within the last 6 bars >= 2 bars wicked into
   the support (low <= S + 0.2 ATR) and closed above it; the current bar closes above the previous high (confirmation)
   → enter next open; SL under the lowest wick − 0.1 ATR; TP = last swing high (>= 1.5R).
C. Head & shoulders (video 21, 2 entries): 3 swing highs, head highest by >= 0.5 ATR, shoulders within 0.5 ATR; neckline = lowest
   low between the shoulders. C1 = close through the neckline → next open; C2 = limit back at the neckline within 12 bars.
   SL above the right shoulder + 0.1 ATR; TP = measured move (head − neckline), >= 1R.
All mirrored for the other side. 21 bot coins, 1H and 4H, 2025–2026, fee 0, slippage 0.04%, 2.5$/trade, stop first,
no TP on a fill bar, max 48 bars. Filter "thuận ngày" = coin daily trend agrees. Random control on 1H.
"""
from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import build, confirmed, trend
from service.scripts import fee0_shootout as X
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import resample, year_of

COST, MAXB = 0.0004, 48


def exit_r(cs, f, side, entry, stop, tp, limit_like):
    """Gross return; limit_like: no TP on the fill bar (fill happened inside it)."""
    last = min(f + MAXB - 1, len(cs) - 1)
    for j in range(f, last + 1):
        b = cs[j]
        if (b.l <= stop) if side > 0 else (b.h >= stop):
            px = b.o if ((b.o < stop) if side > 0 else (b.o > stop)) else stop
            return side * (px / entry - 1)
        if (j > f or not limit_like) and ((b.h >= tp) if side > 0 else (b.l <= tp)):
            return side * (tp / entry - 1)
    return side * (cs[last].c / entry - 1)


def rec(out, name, cs, f, side, entry, stop, tp, limit_like, tr, sym):
    risk = side * (entry - stop) / entry
    if not 0.003 <= risk <= 0.06 or side * (tp - entry) <= 0:
        return
    r = (exit_r(cs, f, side, entry, stop, tp, limit_like) - COST) / risk
    out.append({"name": name, "year": year_of(cs[f].t), "side": side, "risk": risk, "tp": abs(tp / entry - 1),
                "trend": tr, "sym": sym, "r": r})


def scan(cs, x, own, tf, sym):
    out, busy = [], {}
    step = 3_600_000 if tf == "1h" else 14_400_000
    for i in range(70, len(cs) - MAXB - 14):
        if year_of(cs[i].t) < 2025:
            continue
        a, c = x.atr[i], cs[i]
        if not a:
            continue
        tr = trend_at(own, c.t + step)
        for side in (1, -1):
            hs = confirmed(x.highs if side > 0 else x.lows, i, 6)
            ext = (lambda k: cs[k].h) if side > 0 else (lambda k: cs[k].l)

            # A. compression under a multi-top zone, stop order through it
            if busy.get(("A", side), 0) < i:
                tops = [k for k in hs if k >= i - 60]
                if len(tops) >= 3:
                    lvl = max(ext(k) for k in tops) if side > 0 else min(ext(k) for k in tops)
                    if all(abs(ext(k) - lvl) <= 0.3 * a for k in tops[-3:]):
                        win = cs[i - 5 : i + 1]
                        hi, lo = max(b.h for b in win), min(b.l for b in win)
                        press = (lvl - c.h) if side > 0 else (c.l - lvl)
                        inside = all((b.c < lvl) if side > 0 else (b.c > lvl) for b in win)
                        if hi - lo <= 1.5 * a and 0 <= press <= 0.5 * a and inside:
                            trig = lvl + side * 0.05 * a
                            stop = (lo - 0.1 * a) if side > 0 else (hi + 0.1 * a)
                            for j in range(i + 1, i + 7):
                                if (cs[j].h >= trig) if side > 0 else (cs[j].l <= trig):
                                    e = max(trig, cs[j].o) if side > 0 else min(trig, cs[j].o)
                                    rec(out, "A phá vỡ sau nén", cs, j, side, e, stop, e + side * 2 * abs(e - stop), True, tr, sym)
                                    busy[("A", side)] = j + 6
                                    break

            # B. pullback to the broken swing, sellers fail >= 2 times, confirmation close
            if busy.get(("B", side), 0) < i and trend(x, i) == side and len(hs) >= 2 and side * (ext(hs[-1]) - ext(hs[-2])) > 0:
                S = ext(hs[-2])
                win = cs[i - 6 : i]
                fails = [b for b in win if ((b.l <= S + 0.2 * a and b.c > S) if side > 0 else (b.h >= S - 0.2 * a and b.c < S))]
                prev = cs[i - 1]
                confirm = (c.c > prev.h and c.c > c.o) if side > 0 else (c.c < prev.l and c.c < c.o)
                if len(fails) >= 2 and confirm:
                    e = cs[i + 1].o
                    stop = (min(b.l for b in fails) - 0.1 * a) if side > 0 else (max(b.h for b in fails) + 0.1 * a)
                    tp = ext(hs[-1])
                    if side * (tp - e) >= 1.5 * side * (e - stop) > 0:
                        rec(out, "B hồi cạn kiệt", cs, i + 1, side, e, stop, tp, False, tr, sym)
                        busy[("B", side)] = i + 6

            # C. head & shoulders (top → short = side -1 uses swing highs; inverse → long uses swing lows)
            sh = confirmed(x.highs if side < 0 else x.lows, i, 3)
            pk = (lambda k: cs[k].h) if side < 0 else (lambda k: cs[k].l)
            if busy.get(("C", side), 0) < i and len(sh) == 3 and sh[0] >= i - 80:
                l_, h_, r_ = sh
                head_ok = (pk(h_) - max(pk(l_), pk(r_)) >= 0.5 * a) if side < 0 else (min(pk(l_), pk(r_)) - pk(h_) >= 0.5 * a)
                if head_ok and abs(pk(l_) - pk(r_)) <= 0.5 * a:
                    seg = cs[l_ : r_ + 1]
                    neck = min(b.l for b in seg) if side < 0 else max(b.h for b in seg)
                    broke = (c.c < neck <= cs[i - 1].c) if side < 0 else (c.c > neck >= cs[i - 1].c)
                    if broke:
                        stop = pk(r_) - side * 0.1 * a
                        tp = neck + side * abs(pk(h_) - neck)
                        e = cs[i + 1].o
                        if side * (tp - e) >= side * (e - stop) > 0:
                            rec(out, "C1 vai-đầu-vai phá cổ", cs, i + 1, side, e, stop, tp, False, tr, sym)
                        for j in range(i + 1, i + 13):
                            if (cs[j].h >= neck) if side < 0 else (cs[j].l <= neck):
                                e2 = max(neck, cs[j].o) if side < 0 else min(neck, cs[j].o)
                                rec(out, "C2 vai-đầu-vai test lại cổ", cs, j, side, e2, stop, tp, True, tr, sym)
                                break
                            if (cs[j].l <= tp) if side < 0 else (cs[j].h >= tp):
                                break
                        busy[("C", side)] = i + 12
    return out


def main():
    rows = []
    for fp in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        sym = fp.name.split("_")[0]
        if sym.replace("USDT-PERP", "") not in LIVE_COINS:
            continue
        c1 = load(sym, "1h", include_holdout=True)
        own = daily_trend(c1)
        for tf, cs in (("1h", c1), ("4h", resample(c1, 4))):
            for t in scan(cs, build(cs), own, tf, sym):
                t["tf"] = tf
                rows.append(t)
    for name in ("A phá vỡ sau nén", "B hồi cạn kiệt", "C1 vai-đầu-vai phá cổ", "C2 vai-đầu-vai test lại cổ"):
        for tf in ("1h", "4h"):
            for flt in ("mọi lúc", "thuận ngày"):
                g = [t for t in rows if t["name"] == name and t["tf"] == tf and (flt == "mọi lúc" or t["trend"] == t["side"])]
                if not g:
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
