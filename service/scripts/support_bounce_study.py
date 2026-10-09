"""Backtest Support Zone Bounce with Rejection Wick on 4H (MEXC 0% fee).
"""
import math
import sys
from collections import defaultdict
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from service.backtest.data import DATA_DIR, Candle, load
from service.backtest.patterns import STYLES, build, rejection, confirmed


def resample(cs: list[Candle], hours: int) -> list[Candle]:
    ms = hours * 3_600_000
    out, cur = [], None
    for c in cs:
        t = c.t // ms * ms
        if cur and cur[0] == t:
            cur[2] = max(cur[2], c.h)
            cur[3] = min(cur[3], c.l)
            cur[4] = c.c
            cur[5] += c.v
        else:
            if cur:
                out.append(Candle(*cur))
            cur = [t, c.o, c.h, c.l, c.c, c.v]
    if cur:
        out.append(Candle(*cur))
    return out


def support_pinbar_detector(ctx, i):
    """Giá rơi vào vùng đáy swing cũ, rút chân mạnh (lower wick >= body) và đóng nến xanh."""
    cs, c, a = ctx.cs, ctx.cs[i], ctx.atr[i]
    ls = confirmed(ctx.lows, i, 5)
    if not ls:
        return None
    recent_lows = [cs[k].l for k in ls if i - 60 <= k <= i - 3]
    if not recent_lows:
        return None

    for base_low in recent_lows:
        if c.l <= base_low + 0.2 * a and c.c > base_low and rejection(c, 1):
            stop = c.l - 0.1 * a
            return {"side": 1, "stop": stop, "base": base_low}
    return None


def run_study():
    print("==========================================================================")
    print("🔥 BACKTEST 4H: BẬT VÙNG HỖ TRỢ / ĐÁY CŨ + NẾN 4H RÚT CHÂN (0% PHÍ MEXC) 🔥")
    print("==========================================================================")

    files = sorted(DATA_DIR.glob("*-PERP_1h.csv"))
    base_1h = {f.name.split("_")[0]: load(f.name.split("_")[0], "1h", include_holdout=True) for f in files}
    base_4h = {sym: resample(cs, 4) for sym, cs in base_1h.items() if len(cs) >= 500}

    results = defaultdict(list)
    tps = [0.5, 0.75, 1.0, 1.5, 2.0]

    for sym, cs in base_4h.items():
        ctx = build(cs)
        n = len(cs)

        for i in range(50, n - 14):
            # Kiểu 1: sr_bounce có sẵn trong STYLES
            s1 = STYLES["sr_bounce"][1](ctx, i)
            # Kiểu 2: support_pinbar_detector tại đáy cũ
            s2 = support_pinbar_detector(ctx, i)

            for det_name, sig in [("SR_Bounce (Nền 3 chạm)", s1), ("Pinbar_DayCu (Rút chân đáy)", s2)]:
                if not sig or sig["side"] != 1:
                    continue

                stop = sig["stop"]
                entry = cs[i + 1].o
                risk = (entry - stop) / entry
                if not (0.004 <= risk <= 0.08):
                    continue

                r_dist = abs(entry - stop)

                for tp_mult in tps:
                    target = entry + tp_mult * r_dist
                    exit_r = None

                    for j in range(i + 1, min(i + 1 + 12, n)):
                        bar = cs[j]
                        if bar.l <= stop:
                            exit_r = -1.0
                            break
                        if bar.h >= target:
                            exit_r = tp_mult
                            break

                    if exit_r is None:
                        bar = cs[min(i + 1 + 12, n - 1)]
                        exit_r = (bar.c - entry) / r_dist

                    results[(det_name, tp_mult)].append(exit_r)

    print(f"\n{'Kiểu Setup (LONG 4H)':<28} | {'TP Target':<10} | {'Số lệnh':<7} | {'WinRate':<8} | {'Kỳ vọng Exp R':<14} | {'t-stat'}")
    print("-" * 88)

    for (name, tp_mult), rets in sorted(results.items()):
        n = len(rets)
        if n == 0:
            continue
        wins = sum(1 for r in rets if r > 0)
        wr = wins / n * 100
        mean_r = sum(rets) / n
        var = sum((r - mean_r) ** 2 for r in rets) / (n - 1) if n > 1 else 0
        se = math.sqrt(var / n) if n > 1 else 1
        t_stat = mean_r / se if se > 0 else 0

        print(f"{name:<28} | {tp_mult:<4}R       | {n:<7} | {wr:6.1f}% | {mean_r:+13.4f}R | {t_stat:+5.2f}")


if __name__ == "__main__":
    run_study()

