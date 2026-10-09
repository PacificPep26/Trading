"""(1) Account with fixed $ risk; (2) exit early when the breakout fails instead of waiting for the far stop.

Usage: python -m service.scripts.early_exit_study
BOS LONG on 4h (21 original coins). Early exit = a later 4h candle CLOSES back below the broken swing high
(the BOS level) -> exit at that close. Cost: slippage 0.04% + funding 0.01%/8h (zero-fee exchange).
"""
import bisect, math
from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import bos, build, confirmed
from service.scripts.styles_study import resample
from service.scripts.expand_study import ORIGINAL

COST = 0.0004


def run(early, tp_r):
    out = []
    for f in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        if f.name.split("-PERP")[0] not in ORIGINAL: continue
        cs = resample(load(f.name.split("_")[0], "1h", include_holdout=True), 4); x = build(cs); busy = 0
        for i in range(260, len(cs) - 14):
            if i <= busy: continue
            s = bos(x, i)
            if not s or s["side"] < 0: continue
            level = cs[confirmed(x.highs, i, 1)[0]].h
            e = cs[i + 1].o; stop = s["stop"]; risk = (e - stop) / e
            if not (0.004 <= risk <= 0.08): continue
            tp = e + tp_r * (e - stop); res = None
            for k in range(i + 1, i + 13):
                b = cs[k]
                if b.l <= stop: res = ((b.o if b.o < stop else stop) / e - 1, k); break
                if b.h >= tp: res = (tp / e - 1, k); break
                if early and b.c < level: res = (b.c / e - 1, k); break
            if res is None: res = (cs[i + 12].c / e - 1, i + 12)
            g, k = res
            out.append(((g - COST - 0.0001 * (k - i) / 2) / risk, cs[i].t, k))
            busy = k
    return out


def stats(name, v):
    r = [a for a, _, _ in v]; n = len(r); m = sum(r) / n; sd = math.sqrt(sum((a - m) ** 2 for a in r) / (n - 1))
    losses = [a for a in r if a < 0]
    print(f"{name:52s} n={n} thắng {sum(a > 0 for a in r) / n:.0%} TB {m:+.3f}R t={m / (sd / math.sqrt(n)):+.1f} | lỗ TB khi thua {sum(losses) / len(losses):+.2f}R")


def account(v, start, risk_usd):
    eq, peak, mdd, low = start, start, 0, start
    for r, _, _ in sorted(v, key=lambda z: z[1]):
        if eq <= 0: break
        eq += risk_usd * r; peak = max(peak, eq); low = min(low, eq); mdd = max(mdd, 1 - eq / peak)
    return f"cuối {eq:.0f}$ | thấp nhất {low:.0f}$ | sụt tối đa {mdd:.0%}"


def main():
    for tp in (0.5, 1.0):
        a = run(False, tp); b = run(True, tp)
        stats(f"BOS LONG, TP {tp}R, chờ SL cấu trúc", a)
        stats(f"BOS LONG, TP {tp}R, THOÁT SỚM khi nến 4h đóng lại dưới mức phá", b)
        for name, v in (("chờ SL", a), ("thoát sớm", b)):
            print(f"   vốn 57$, mất 10$/lệnh ({name}): {account(v, 57, 10)} | mất 3$/lệnh: {account(v, 57, 3)}")


if __name__ == "__main__":
    main()
