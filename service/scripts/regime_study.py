"""When to go long vs short? 4h BOS / double top-bottom split by side and by BTC regime.

Usage: python -m service.scripts.regime_study
Regime = BTC daily close vs its daily EMA50 at the signal time (above = bull, below = bear),
also the coin's own daily EMA50. Exits as in styles_study (1.5R, 12 4h bars, MEXC-like fee).
"""
import bisect, math
from collections import defaultdict
from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import build, STYLES
from service.scripts.styles_study import resample, execute

FEE = 0.0004


def daily_state(c1):
    d = resample(c1, 24)
    ema, out = d[0].c, []
    for c in d:
        ema += 2 / 51 * (c.c - ema)
        out.append((c.t + 86_400_000, 1 if c.c > ema else -1))  # known at day close
    return [t for t, _ in out], [s for _, s in out]


def main():
    btc_t, btc_s = daily_state(load("BTCUSDT-PERP", "1h", include_holdout=True))
    res = defaultdict(list)
    for f in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        c1 = load(f.name.split("_")[0], "1h", include_holdout=True)
        own_t, own_s = daily_state(c1)
        cs = resample(c1, 4); x = build(cs)
        for key in ("bos", "double_top_bottom"):
            det = STYLES[key][1]; busy = 0
            for i in range(260, len(cs) - 2):
                if i <= busy: continue
                s = det(x, i)
                if not s: continue
                t = cs[i].t + 4 * 3_600_000
                bi, oi = bisect.bisect_right(btc_t, t) - 1, bisect.bisect_right(own_t, t) - 1
                if bi < 50 or oi < 50: continue
                ref = s.get("entry") or cs[i + 1].o; R = abs(ref - s["stop"])
                r = execute(cs, i, s, ref + s["side"] * 1.5 * R, 12, (0.004, 0.08))
                if not r: continue
                busy = r[4]
                R_ = (r[0] - FEE) / r[1]
                side = s["side"]
                res[(key, side, "BTC " + ("tăng" if btc_s[bi] > 0 else "giảm"))].append((R_, r[3]))
                res[(key, side, "coin " + ("tăng" if own_s[oi] > 0 else "giảm"))].append((R_, r[3]))
                agree = btc_s[bi] == own_s[oi] == side
                res[(key, side, "BTC & coin cùng chiều lệnh" if agree else "không cùng")].append((R_, r[3]))
    for k, v in sorted(res.items(), key=lambda kv: (kv[0][0], -kv[0][1], kv[0][2])):
        rs = [a for a, _ in v]; n = len(rs); m = sum(rs) / n
        sd = math.sqrt(sum((a - m) ** 2 for a in rs) / (n - 1)) if n > 1 else 1
        t26 = [a for a, y in v if y >= 2026]
        print(f"{k[0]:18s} {'LONG ' if k[1] > 0 else 'SHORT'} {k[2]:28s} n={n:4d} thắng {sum(a > 0 for a in rs) / n:.0%} TB {m:+.3f}R t={m / (sd / math.sqrt(n)):+.1f} 2026 {sum(t26) / max(1, len(t26)):+.3f}R (n={len(t26)})")


if __name__ == "__main__":
    main()
