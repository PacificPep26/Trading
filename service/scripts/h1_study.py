"""Backtest 1h with TP 0.5R, 0.75R, 1.0R across 21 coins.
"""
import math
import sys
from collections import defaultdict
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from service.backtest.data import DATA_DIR, Candle, load
from service.backtest.patterns import STYLES, build

def run():
    print("=== BACKTEST KHUNG 1H VỚI TP 0.5R, 0.75R, 1.0R (2023-2026) ===")
    results = defaultdict(list)
    
    fee_mexc = 0.0004 + 0.0004  # 0.04% fee + 0.04% slippage
    fee_okx = 0.0010 + 0.0004   # 0.10% fee + 0.04% slippage

    files = sorted(DATA_DIR.glob("*-PERP_1h.csv"))

    for f in files:
        sym = f.name.split("_")[0]
        cs = load(sym, "1h", include_holdout=True)
        if len(cs) < 500:
            continue
        
        ctx = build(cs)
        n = len(cs)

        for i in range(50, n - 25):
            for style_key in ["bos", "double_top_bottom"]:
                title, det = STYLES[style_key]
                s = det(ctx, i)
                if not s:
                    continue

                side = s["side"]
                stop = s["stop"]
                entry = cs[i + 1].o  # vào ở giá mở nến sau
                risk = side * (entry - stop) / entry
                if not (0.002 <= risk <= 0.05):
                    continue

                r_dist = abs(entry - stop)
                # Test TP: 0.5R, 0.75R, 1.0R
                for tp_mult in [0.5, 0.75, 1.0]:
                    target = entry + side * tp_mult * r_dist
                    
                    exit_r = None
                    for j in range(i + 1, min(i + 1 + 24, n)):
                        bar = cs[j]
                        # Quy tắc: SL chạm trước nếu cùng nến
                        if (bar.l <= stop) if side > 0 else (bar.h >= stop):
                            exit_r = -1.0
                            break
                        if (bar.h >= target) if side > 0 else (bar.l <= target):
                            exit_r = tp_mult
                            break

                    if exit_r is None:
                        bar = cs[min(i + 1 + 24, n - 1)]
                        exit_r = side * (bar.c - entry) / r_dist

                    fee_r_mexc = fee_mexc / risk
                    fee_r_okx = fee_okx / risk

                    results[(style_key, side, tp_mult, "mexc")].append(exit_r - fee_r_mexc)
                    results[(style_key, side, tp_mult, "okx")].append(exit_r - fee_r_okx)

    print(f"\n{'Kiểu':<18} | {'Chiều':<6} | {'TP':<5} | {'Sàn':<5} | {'Số lệnh':<7} | {'WinRate':<7} | {'Exp R/lệnh':<10} | {'t-stat'}")
    print("-" * 75)

    for (style, side, tp_mult, fee_name), rets in sorted(results.items()):
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
        print(f"{style:<18} | {side_str:<6} | {tp_mult:<4}R | {fee_name.upper():<5} | {n:<7} | {wr:5.1f}% | {mean_r:+9.4f}R | {t_stat:+5.2f}")


if __name__ == "__main__":
    run()
