"""Owner's idea: after a 4h BOS breaks down, price falls to an OLD base (an earlier 4h swing low)
where buyers sit, bounces there, so take profit just above it. Mirror for longs.

Usage: python -m service.scripts.support_target_study
- old base = nearest confirmed 4h swing low below entry (excluding the one just broken), within 3R
- reach: price touches it within 48h (1h bars, after entry, before the 4h stop)
- bounce test: after the first touch, within 12h does price rise >= 1.5% from the touch low
  before falling >= 1.5% further? Placebo: the same test at a level halfway entry -> base.
- E: stop at 4h structure, TP 0.3% above the old base (short) vs A: TP 1.5R
"""
import bisect, math
from collections import defaultdict
from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import bos, build, confirmed
from service.scripts.styles_study import resample
from service.scripts.bos_exit_study import walk, HOLD

FEE = 0.0004
MOVE = 0.015


def bounce(c1, j, side, level):
    """First touch of level after j; return 'bounce' / 'through' / None (not reached or unresolved)."""
    for k in range(j, min(j + HOLD, len(c1))):
        if (c1[k].l <= level) if side < 0 else (c1[k].h >= level):
            for m in range(k, min(k + 12, len(c1))):
                b = c1[m]
                if (b.l <= level * (1 - MOVE)) if side < 0 else (b.h >= level * (1 + MOVE)):
                    return "through"
                if (b.h >= level * (1 + MOVE)) if side < 0 else (b.l <= level * (1 - MOVE)):
                    return "bounce"
            return "flat"
    return None


def main():
    cnt = defaultdict(lambda: defaultdict(int))
    pnl = defaultdict(list)
    for f in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        c1 = load(f.name.split("_")[0], "1h", include_holdout=True)
        c4 = resample(c1, 4); x4 = build(c4)
        t1 = [c.t for c in c1]
        busy = 0
        for i in range(260, len(c4) - 2):
            if i <= busy: continue
            sig = bos(x4, i)
            if not sig: continue
            side, stop = sig["side"], sig["stop"]
            j = bisect.bisect_left(t1, c4[i + 1].t)
            if j >= len(c1) or c1[j].t != c4[i + 1].t: continue
            entry = c1[j].o; R = abs(entry - stop); r = R / entry
            if not (0.004 <= r <= 0.08): continue
            pts = confirmed(x4.lows if side < 0 else x4.highs, i, 40)
            lv = [c4[k].l for k in pts] if side < 0 else [c4[k].h for k in pts]
            cand = [x for x in lv if (x < entry * 0.997 if side < 0 else x > entry * 1.003) and abs(x - entry) <= 3 * R]
            if not cand: continue
            base = max(cand) if side < 0 else min(cand)
            res = bounce(c1, j, side, base); cnt["base"][res] += 1
            cnt["placebo"][bounce(c1, j, side, (entry + base) / 2)] += 1
            tp_e = base * (1.003 if side < 0 else 0.997)
            pnl["A"].append(((walk(c1, j, side, entry, stop, entry + side * 1.5 * R) - FEE) / r))
            pnl["E"].append(((walk(c1, j, side, entry, stop, tp_e) - FEE) / r))
            busy = i + HOLD // 4
    for k in ("base", "placebo"):
        c = cnt[k]; reached = c["bounce"] + c["through"] + c["flat"]; tot = reached + c[None]
        print(f"{'nền cũ' if k == 'base' else 'mức giả (giữa đường)':22s} chạm {reached/tot:.0%} | sau khi chạm: bật ≥1,5% {c['bounce']/reached:.0%}, xuyên ≥1,5% {c['through']/reached:.0%}, đứng yên {c['flat']/reached:.0%}")
    for k, name in (("A", "TP 1,5R"), ("E", "TP ngay trên nền cũ")):
        v = pnl[k]; m = sum(v) / len(v); sd = math.sqrt(sum((x - m) ** 2 for x in v) / (len(v) - 1))
        print(f"{k} {name:20s} n={len(v)} thắng {sum(x > 0 for x in v)/len(v):.0%} TB {m:+.3f}R (t={m/(sd/math.sqrt(len(v))):+.1f})")


if __name__ == "__main__":
    main()
