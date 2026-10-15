"""Owner (2026-10-15, BTC 14/10): "after a strong breakdown, wait for the bounce back and short it".

Usage: python -m service.scripts.break_retest_study

21 bot coins, 1H and 4H, 2025–2026, fee 0, slippage 0.04% round trip, 2.5$/trade.
Breakdown bar i: red, closes below base = lowest low of the previous 24 bars, body >= k x ATR14 (k = 1, 1.5, 2).
Short limit at the bounce level within the next 12 bars: "nền" = back to the base, "nửa" = half way from the close
back to the base. SL = limit + 1 ATR; TP 1R / 2R; max 48 bars; stop first, no TP on the fill bar;
cancel if price first falls 1R below the limit without filling.
Trend filter: any / coin daily trend down. Pick on 2025, check 2026, vs random short entries (same coin/year/trend,
same SL% and TP%).
"""
from service.backtest.data import DATA_DIR, load
from service.backtest.structure import atr_series
from service.scripts import fee0_shootout as X
from service.scripts import trailing_study as T
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import resample, year_of

COST = 0.0004


def run():
    res = {}
    for fp in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        sym = fp.name.split("_")[0]
        if sym.replace("USDT-PERP", "") not in LIVE_COINS:
            continue
        c1 = load(sym, "1h", include_holdout=True)
        own = daily_trend(c1)
        for tf, cs in (("1h", c1), ("4h", resample(c1, 4))):
            atr = atr_series(cs)
            for i in range(30, len(cs) - 62):
                c, a = cs[i], atr[i]
                y = year_of(c.t)
                if y < 2025 or not a:
                    continue
                base = min(b.l for b in cs[i - 24 : i])
                if not (c.c < c.o and c.c < base):
                    continue
                tr = trend_at(own, c.t + (3_600_000 if tf == "1h" else 14_400_000))
                for k in (1.0, 1.5, 2.0):
                    if c.o - c.c < k * a:
                        continue
                    for lvl_name, limit in (("nền", base), ("nửa", c.c + 0.5 * (base - c.c))):
                        stop = limit + a
                        r = stop - limit
                        fill = None
                        for j in range(i + 1, i + 13):
                            b = cs[j]
                            if b.h >= limit:
                                fill = j
                                break
                            if b.l <= limit - r:
                                break  # kept falling without a bounce
                        if fill is None:
                            continue
                        entry = max(limit, cs[fill].o)
                        risk = (stop - entry) / entry
                        if not 0.003 <= risk <= 0.06:
                            continue
                        for R in (1.0, 2.0):
                            tp = entry - R * (stop - entry)
                            g, last = None, min(fill + 47, len(cs) - 1)
                            for j in range(fill, last + 1):
                                b = cs[j]
                                if b.h >= stop:
                                    g = -(stop / entry - 1)
                                    break
                                if j > fill and b.l <= tp:
                                    g = -(tp / entry - 1)
                                    break
                            if g is None:
                                g = -(cs[last].c / entry - 1)
                            row = {"sym": sym, "year": y, "side": -1, "risk": risk, "tp": R * risk, "trend": tr,
                                   "r": (g - COST) / risk}
                            for trend_name in ("mọi lúc", "ngày giảm"):
                                if trend_name == "ngày giảm" and tr != -1:
                                    continue
                                res.setdefault((tf, k, lvl_name, R, trend_name), []).append(row)
    return res


def main():
    res = run()
    mean = lambda xs: sum(x["r"] for x in xs) / len(xs)
    keys = [k for k, v in res.items() if sum(x["year"] == 2025 for x in v) >= 40]
    keys.sort(key=lambda k: -mean([x for x in res[k] if x["year"] == 2025]))
    print(f"{len(keys)} biến thể. Top 5 chọn bằng 2025, kiểm 2026:\n")
    for key in keys[:5]:
        tf, k, lvl, R, trend = key
        rows = res[key]
        print(f"{tf} · thân gãy ≥ {k} ATR · short khi hồi về {lvl} · TP {R}R · {trend}")
        X.show("  thật", {y: [x["r"] for x in rows if x["year"] == y] for y in X.YEARS})
        if tf == "1h":  # fixed_control reads raw files; there is no 4h file
            rc = X.fixed_control([x for x in rows if x["trend"] != 0], tf, 48)
            X.show("  vào ngẫu nhiên", {y: [x["r"] for x in rc if x["year"] == y] for y in X.YEARS})
        print()


if __name__ == "__main__":
    main()
