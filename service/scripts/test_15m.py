"""Backtest 15m timeframe with 0% fees (MEXC) on 21 coins (2023-2026).
"""
import math
import sys
from collections import defaultdict
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from service.backtest.data import DATA_DIR, Candle, load
from service.backtest.patterns import STYLES, build

def run_15m_test():
    print("=== BACKTEST KHUNG 15M (0% PHÍ MEXC) TRÊN DATA THẬT 2023-2026 ===")
    files = sorted(DATA_DIR.glob("*-PERP_15m.csv"))[:10] # test trên 10 coin chính
    print(f"-> Đọc dữ liệu 15m của {len(files)} coins...")

    results = defaultdict(list)
    tps = [0.5, 0.75, 1.0]

    for f in files:
        sym = f.name.split("_")[0]
        # load 15m
        cs = load(sym, "15m", include_holdout=True)
        if len(cs) < 1000:
            continue
        
        ctx = build(cs)
        n = len(cs)

        for i in range(100, n - 48, 2): # bước 2 để giảm trùng lặp
            for style_key in ["bos", "double_top_bottom"]:
                det = STYLES[style_key][1]
                s = det(ctx, i)
                if not s:
                    continue

                side = s["side"]
                stop = s["stop"]
                entry = cs[i + 1].o
                risk = side * (entry - stop) / entry
                if not (0.0015 <= risk <= 0.03):
                    continue

                r_dist = abs(entry - stop)

                for tp_mult in tps:
                    target = entry + side * tp_mult * r_dist
                    exit_r = None

                    # Giữ tối đa 48 nến 15m (12 tiếng)
                    for j in range(i + 1, min(i + 1 + 48, n)):
                        bar = cs[j]
                        if (bar.l <= stop) if side > 0 else (bar.h >= stop):
                            exit_r = -1.0
                            break
                        if (bar.h >= target) if side > 0 else (bar.l <= target):
                            exit_r = tp_mult
                            break

                    if exit_r is None:
                        bar = cs[min(i + 1 + 48, n - 1)]
                        exit_r = side * (bar.c - entry) / r_dist

                    results[(style_key, side, tp_mult)].append(exit_r)

    print(f"\n{'Kiểu Setup (15M)':<20} | {'Chiều':<6} | {'TP':<6} | {'Số lệnh':<8} | {'WinRate':<7} | {'Exp R/lệnh':<12} | {'t-stat'}")
    print("-" * 75)

    for (style, side, tp_mult), rets in sorted(results.items()):
        n = len(rets)
        if n == 0:
            continue
        wins = sum(1 for r in rets if r > 0)
        wr = wins / n * 100
        mean_r = sum(rets) / n
        var = sum((r - mean_r) ** 2 for r in rets) / (n - 1) if n > 1 else 0
        se = math.sqrt(var / n) if n > 1 else 1
        t_stat = mean_r / se if se > 0 else 0

        side_str = "LONG" if side > 0 else "SHORT"
        style_str = "BOS 15m" if style == "bos" else "Hai đỉnh/đáy 15m"
        print(f"{style_str:<20} | {side_str:<6} | {tp_mult:<4}R | {n:<8} | {wr:5.1f}% | {mean_r:+11.4f}R | {t_stat:+5.2f}")


if __name__ == "__main__":
    run_15m_test()

