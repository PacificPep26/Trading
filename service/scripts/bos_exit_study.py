"""Compare exit plans for the 4h BOS signal (the best-tested style), simulated on 1h bars.

Usage: python -m service.scripts.bos_exit_study

A  stop at the 4h structure (as backtested), target 1.5R
B  stop at the 1h structure (max(EMA20 1h, last 1h swing) +0.2% for shorts; mirror for longs), target 1.3R
C  stop at the 4h structure, target 0.5R (owner's "TP 12.68 with SL 14.14" on LINK)
D  stop at the 4h structure, half at 0.5R then stop to entry, rest at 1.5R
Entry: market at the open of the 4h bar after the signal. Stop first inside a bar. Max hold 48h.
$ figures: 40$ margin x 10x = 400$ position (A also shown sized to lose 3$ at the stop).
"""
import bisect
import math
from collections import defaultdict

from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import bos, build, confirmed
from service.scripts.styles_study import resample

HOLD = 48
FEES = {"MEXC": 0.0004, "OKX": 0.001}
POSITION = 400


def walk(c1, j, side, entry, stop, tp, half_tp=None):
    """Return gross return fraction of the whole position."""
    realized, size, cur_stop = 0.0, 1.0, stop
    for k in range(j, min(j + HOLD, len(c1))):
        b = c1[k]
        if (b.h >= cur_stop) if side < 0 else (b.l <= cur_stop):
            px = b.o if ((b.o > cur_stop) if side < 0 else (b.o < cur_stop)) else cur_stop
            return realized + size * side * (px / entry - 1)
        if half_tp is not None and size == 1.0 and ((b.l <= half_tp) if side < 0 else (b.h >= half_tp)):
            realized += 0.5 * side * (half_tp / entry - 1)
            size, cur_stop = 0.5, entry
        if (b.l <= tp) if side < 0 else (b.h >= tp):
            return realized + size * side * (tp / entry - 1)
    last = c1[min(j + HOLD, len(c1)) - 1].c
    return realized + size * side * (last / entry - 1)


def main():
    res = defaultdict(list)  # plan -> (gross, risk, year)
    for f in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        c1 = load(f.name.split("_")[0], "1h", include_holdout=True)
        c4 = resample(c1, 4)
        x4, x1 = build(c4), build(c1)
        t1 = [c.t for c in c1]
        busy = 0
        for i in range(260, len(c4) - 2):
            if i <= busy:
                continue
            sig = bos(x4, i)
            if not sig:
                continue
            side, stop4 = sig["side"], sig["stop"]
            j = bisect.bisect_left(t1, c4[i + 1].t)
            if j >= len(c1) or c1[j].t != c4[i + 1].t or j < 300:
                continue
            entry = c1[j].o
            r4 = side * (entry - stop4) / entry
            if not (0.004 <= r4 <= 0.08):
                continue
            year = c1[j].t // 31_557_600_000 + 1970
            R4 = abs(entry - stop4)
            res["A"].append((walk(c1, j, side, entry, stop4, entry + side * 1.5 * R4), r4, year))
            res["C"].append((walk(c1, j, side, entry, stop4, entry + side * 0.5 * R4), r4, year))
            res["D"].append((walk(c1, j, side, entry, stop4, entry + side * 1.5 * R4, half_tp=entry + side * 0.5 * R4), r4, year))
            # B: 1h structure stop from the last closed 1h bar before entry
            sw = confirmed(x1.highs if side < 0 else x1.lows, j - 1, 1)
            if sw:
                lvl = c1[sw[0]].h if side < 0 else c1[sw[0]].l
                edge = max(lvl, x1.ema20[j - 1]) if side < 0 else min(lvl, x1.ema20[j - 1])
                stop1 = edge * (1.002 if side < 0 else 0.998)
                r1 = side * (entry - stop1) / entry
                if 0.003 <= r1 < r4:
                    R1 = abs(entry - stop1)
                    res["B"].append((walk(c1, j, side, entry, stop1, entry + side * 1.3 * R1), r1, year))
            busy = i + HOLD // 4
    names = {
        "A": "SL cấu trúc 4h, TP 1,5R (đã kiểm chứng)",
        "B": "SL cấu trúc 1h, TP 1,3R",
        "C": "SL cấu trúc 4h, TP 0,5R",
        "D": "SL 4h, chốt nửa 0,5R → SL về giá vào, nửa còn lại 1,5R",
    }
    for fee_name, fee in FEES.items():
        print(f"\n== phí {fee_name} ({fee * 100:.2f}% khứ hồi)")
        for k in "ABCD":
            rows = res[k]
            rs = [(g - fee) / r for g, r, _ in rows]
            usd = [POSITION * (g - fee) for g, _, _ in rows]
            n = len(rs)
            m = sum(rs) / n
            sd = math.sqrt(sum((x - m) ** 2 for x in rs) / (n - 1))
            test = [(g - fee) / r for g, r, y in rows if y >= 2026]
            loss = [u for u in usd if u < 0]
            extra = ""
            if k == "A":
                extra = f" | cỡ lệnh mất 3$ ở SL: TB {sum(3 * x for x in rs) / n:+.2f}$/lệnh"
            print(f"{k} {names[k]:52s} n={n:4d} thắng {sum(x > 0 for x in rs) / n:.0%} "
                  f"TB {m:+.3f}R (t={m / (sd / math.sqrt(n)):+.1f}) 2026 {sum(test) / max(1, len(test)):+.3f}R | "
                  f"400$: TB {sum(usd) / n:+.2f}$/lệnh, lỗ TB {sum(loss) / max(1, len(loss)):.1f}${extra}")


if __name__ == "__main__":
    main()
