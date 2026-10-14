"""The 16 classic candlestick patterns from the owner's TikTok image (2026-10-14): do they predict direction?

Usage: python -m service.scripts.candle_patterns_study

For each pattern completed on bar i, trade its direction at the next open with TP = SL = 1 x ATR14 (max 24 bars, stop first):
a pattern with real information wins clearly above 50%. Also net R at zero cost and with the daily-trend filter.
BTC alone and the 21 bot coins, 1h and 4h, 2023 onward. Definitions follow the usual textbook shapes.
"""
from service.backtest.data import DATA_DIR, load
from service.backtest.structure import atr_series
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import resample


def body(c): return abs(c.c - c.o)
def rng(c): return c.h - c.l or 1e-12
def up(c): return c.c > c.o
def dn(c): return c.c < c.o
def lower(c): return min(c.o, c.c) - c.l
def upper(c): return c.h - max(c.o, c.c)


def patterns(cs, i, trend):
    """Yield (name, side) completed at bar i. trend = sign of close vs close 10 bars ago (prior move)."""
    a, b, c = cs[i - 2], cs[i - 1], cs[i]
    out = []
    if dn(b) and up(c) and c.c >= b.o and c.o <= b.c: out.append(("1 nhấn chìm tăng", 1))
    if up(b) and dn(c) and c.c <= b.o and c.o >= b.c: out.append(("2 nhấn chìm giảm", -1))
    if dn(a) and body(b) < 0.3 * body(a) and up(c) and c.c > (a.o + a.c) / 2: out.append(("3 sao mai", 1))
    if up(a) and body(b) < 0.3 * body(a) and dn(c) and c.c < (a.o + a.c) / 2: out.append(("4 sao hôm", -1))
    hammer = lower(c) >= 2 * body(c) and upper(c) <= 0.3 * rng(c)
    inv = upper(c) >= 2 * body(c) and lower(c) <= 0.3 * rng(c)
    if hammer and trend < 0: out.append(("5 búa", 1))
    if hammer and trend > 0: out.append(("6 treo cổ", -1))
    if inv and trend > 0: out.append(("7 sao băng", -1))
    if inv and trend < 0: out.append(("8 búa ngược", 1))
    if lower(c) >= 0.66 * rng(c) and body(c) <= 0.25 * rng(c): out.append(("9 pin bar tăng", 1))
    if upper(c) >= 0.66 * rng(c) and body(c) <= 0.25 * rng(c): out.append(("10 pin bar giảm", -1))
    if dn(b) and up(c) and c.o < b.c and (b.o + b.c) / 2 < c.c < b.o: out.append(("11 đường xuyên", 1))
    if up(b) and dn(c) and c.o > b.c and b.o < c.c < (b.o + b.c) / 2: out.append(("12 mây đen", -1))
    if all(up(x) and body(x) >= 0.5 * rng(x) for x in (a, b, c)) and a.c < b.c < c.c: out.append(("13 ba lính trắng", 1))
    if all(dn(x) and body(x) >= 0.5 * rng(x) for x in (a, b, c)) and a.c > b.c > c.c: out.append(("14 ba con quạ", -1))
    if dn(b) and up(c) and max(c.o, c.c) < b.o and min(c.o, c.c) > b.c and body(c) < 0.5 * body(b): out.append(("15 harami tăng", 1))
    if up(b) and dn(c) and max(c.o, c.c) < b.c and min(c.o, c.c) > b.o and body(c) < 0.5 * body(b): out.append(("16 harami giảm", -1))
    return out


def run(hours, coins):
    btc_d = daily_trend(load("BTCUSDT-PERP", "1h", include_holdout=True))
    res = {}
    for fp in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        name = fp.name.split("_")[0]
        if name.replace("USDT-PERP", "") not in coins:
            continue
        c1 = load(name, "1h", include_holdout=True)
        own = daily_trend(c1)
        cs = c1 if hours == 1 else resample(c1, hours)
        atr = atr_series(cs)
        for i in range(20, len(cs) - 2):
            trend = 1 if cs[i].c > cs[i - 10].c else -1
            for pat, side in patterns(cs, i, trend):
                e, a = cs[i + 1].o, atr[i]
                tp, sl = e + side * a, e - side * a
                r = None
                for k in range(i + 1, min(i + 25, len(cs))):
                    b = cs[k]
                    if (b.l <= sl) if side > 0 else (b.h >= sl): r = -1.0; break
                    if (b.h >= tp) if side > 0 else (b.l <= tp): r = 1.0; break
                if r is None:
                    r = side * (cs[min(i + 24, len(cs) - 1)].c - e) / a
                t = cs[i].t
                res.setdefault(pat, []).append((r, trend_at(own, t) == side and trend_at(btc_d, t) == side))
    return res


def main():
    for label, coins in (("BTC", {"BTC"}), ("21 coin", LIVE_COINS)):
        for hours in (1, 4):
            res = run(hours, coins)
            print(f"== {label} {hours}H (TP = SL = 1 ATR: 50% = đoán mò)")
            for pat in sorted(res, key=lambda p: int(p.split()[0])):
                rs = res[pat]
                al = [r for r, ok in rs if ok]
                wr = lambda xs: sum(r > 0 for r in xs) / len(xs) * 100 if xs else 0
                avg = lambda xs: sum(xs) / len(xs) if xs else 0
                print(f"  {pat:17s} n={len(rs):6d} thắng {wr([r for r, _ in rs]):4.1f}% TB {avg([r for r, _ in rs]):+.3f}R"
                      f" | thuận trend n={len(al):5d} thắng {wr(al):4.1f}% TB {avg(al):+.3f}R")


if __name__ == "__main__":
    main()
