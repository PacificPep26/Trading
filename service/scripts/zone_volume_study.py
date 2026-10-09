"""Does volume change the 1h-pullback zone plan (trend_ride_study rules)? 21 coins, results in R after fees.

Usage: python -m service.scripts.zone_volume_study
vr  = volume of the 15m rejection candle / mean of the previous 20 bars
pbv = mean volume of the 4 pullback bars / mean of the 20 bars before them (low = quiet, weak pullback)
"""
import math
from service.backtest.data import DATA_DIR
from service.scripts.trend_ride_study import run


def show(name, rows):
    if not rows:
        print(f"{name:42s} n=0"); return
    r = [x["R"] for x in rows]; n = len(r); m = sum(r) / n
    sd = math.sqrt(sum((x - m) ** 2 for x in r) / (n - 1)) if n > 1 else 0
    test = [x["R"] for x in rows if x["year"] >= 2026]
    print(f"{name:42s} n={n:5d} thắng {sum(x > 0 for x in r) / n:.0%} TB {m:+.3f}R (t={m / (sd / math.sqrt(n)) if sd else 0:+.1f}) 2026 {sum(test) / max(len(test), 1):+.3f}R")


def main():
    syms = sorted(f.name.split("-PERP")[0] for f in DATA_DIR.glob("*-PERP_15m.csv"))
    t = []
    for s in syms:
        t += run(s, 10, 40, 0.012)[0]
    show("tất cả (vùng hồi 1h, nến từ chối 15m)", t)
    for lo, hi in ((0, 0.8), (0.8, 1.5), (1.5, 3), (3, 1e9)):
        show(f"nến từ chối KL {lo}–{hi if hi < 1e9 else '∞'}× TB", [x for x in t if lo <= x["vr"] < hi])
    for lo, hi in ((0, 0.7), (0.7, 1.2), (1.2, 1e9)):
        show(f"nhịp hồi KL {lo}–{hi if hi < 1e9 else '∞'}× (thấp = hồi yếu)", [x for x in t if lo <= x["pbv"] < hi])
    show("hồi KL thấp (<0,7×) + nến từ chối KL cao (≥1,5×)", [x for x in t if x["pbv"] < 0.7 and x["vr"] >= 1.5])


if __name__ == "__main__":
    main()
