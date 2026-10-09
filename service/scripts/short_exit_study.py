"""Do 4h shorts need a different take-profit? BOS and double-top shorts by target and daily trend.

Usage: python -m service.scripts.short_exit_study
Same execution as rule_study (styles_study.execute, max 48h), MEXC-like fee + slippage + funding.
"""
import math
from collections import defaultdict
from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import STYLES, build
from service.scripts.rule_study import daily_trend, trend_at, H4
from service.scripts.styles_study import execute, resample

COST = 0.0004 + 0.0004


def main():
    btc = daily_trend(load("BTCUSDT-PERP", "1h", include_holdout=True))
    res = defaultdict(list)
    for f in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        c1 = load(f.name.split("_")[0], "1h", include_holdout=True)
        own = daily_trend(c1)
        cs = resample(c1, 4); x = build(cs)
        for key in ("bos", "double_top_bottom"):
            busy = 0
            for i in range(260, len(cs) - 2):
                if i <= busy: continue
                s = STYLES[key][1](x, i)
                if not s or s["side"] > 0: continue
                t = cs[i].t + H4
                down = trend_at(btc, t) < 0 and trend_at(own, t) < 0
                ref = cs[i + 1].o; R = abs(ref - s["stop"])
                last = i
                for m in (0.5, 1.0, 1.5, 2.0):
                    r = execute(cs, i, s, ref - m * R, 12, (0.004, 0.08))
                    if not r: continue
                    hold = (r[4] - i) * 4
                    val = (r[0] - COST - 0.0001 * hold / 8) / r[1]
                    res[(key, "ngày giảm" if down else "ngày không giảm", m)].append((val, r[3]))
                    last = max(last, r[4])
                busy = last
    for k in sorted(res):
        v = res[k]; n = len(v); rs = [a for a, _ in v]; mu = sum(rs) / n
        sd = math.sqrt(sum((a - mu) ** 2 for a in rs) / (n - 1))
        t26 = [a for a, y in v if y >= 2026]
        print(f"{'BOS SHORT' if k[0] == 'bos' else 'Hai đỉnh SHORT':15s} {k[1]:16s} TP {k[2]}R  n={n:4d} thắng {sum(a > 0 for a in rs) / n:.0%} TB {mu:+.3f}R t={mu / (sd / math.sqrt(n)):+.1f} 2026 {sum(t26) / max(1, len(t26)):+.3f}R")


if __name__ == "__main__":
    main()
