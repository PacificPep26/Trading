"""Comprehensive Backtest with ZERO FEES (MEXC 0% fee mode) across 21 coins (2023-2026).
Compares 1h and 4h, separated by LONG and SHORT, testing TP: 0.5R, 0.75R, 1.0R, 1.5R, 2.0R.
"""
import math
import sys
from collections import defaultdict
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from service.backtest.data import DATA_DIR, Candle, load
from service.backtest.patterns import STYLES, build


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


def run_zero_fee_test():
    print("==========================================================================")
    print("🔥 BACKTEST 0% PHÍ (MEXC ZERO-FEE) - DỮ LIỆU THẬT 2023-2026 TRÊN 21 COIN 🔥")
    print("==========================================================================")

    files = sorted(DATA_DIR.glob("*-PERP_1h.csv"))
    print(f"-> Đọc dữ liệu {len(files)} coins...")

    base_1h = {}
    for f in files:
        sym = f.name.split("_")[0]
        cs = load(sym, "1h", include_holdout=True)
        if len(cs) >= 500:
            base_1h[sym] = cs

    base_4h = {sym: resample(cs, 4) for sym, cs in base_1h.items()}

    tps = [0.5, 0.75, 1.0, 1.5, 2.0]

    for tf_name, data_dict, max_hold, risk_range in [
        ("1H", base_1h, 24, (0.002, 0.05)),
        ("4H", base_4h, 12, (0.004, 0.08))
    ]:
        print(f"\n==================== KHUNG THỜI GIAN: {tf_name} (0% PHÍ) ====================")
        results = defaultdict(list)

        for sym, cs in data_dict.items():
            ctx = build(cs)
            n = len(cs)

            for i in range(50, n - max_hold - 2):
                for style_key in ["bos", "double_top_bottom"]:
                    title, det = STYLES[style_key]
                    s = det(ctx, i)
                    if not s:
                        continue

                    side = s["side"]
                    stop = s["stop"]
                    entry = cs[i + 1].o  # vào ở giá mở nến sau
                    risk = side * (entry - stop) / entry
                    if not (risk_range[0] <= risk <= risk_range[1]):
                        continue

                    r_dist = abs(entry - stop)

                    for tp_mult in tps:
                        target = entry + side * tp_mult * r_dist
                        exit_r = None

                        for j in range(i + 1, min(i + 1 + max_hold, n)):
                            bar = cs[j]
                            # Quy tắc bảo thủ: SL chạm trước nếu cùng nến
                            if (bar.l <= stop) if side > 0 else (bar.h >= stop):
                                exit_r = -1.0
                                break
                            if (bar.h >= target) if side > 0 else (bar.l <= target):
                                exit_r = tp_mult
                                break

                        if exit_r is None:
                            bar = cs[min(i + 1 + max_hold, n - 1)]
                            exit_r = side * (bar.c - entry) / r_dist

                        # ZERO FEE: không trừ bất kỳ phí gì
                        results[(style_key, side, tp_mult)].append(exit_r)

        print(f"\n{'Kiểu Setup':<18} | {'Chiều':<6} | {'TP Target':<10} | {'Số lệnh':<7} | {'WinRate':<8} | {'Kỳ vọng Exp R':<14} | {'t-stat'}")
        print("-" * 80)

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
            style_str = "BOS" if style == "bos" else "Hai đỉnh/đáy"
            print(f"{style_str:<18} | {side_str:<6} | {tp_mult:<4}R       | {n:<7} | {wr:6.1f}% | {mean_r:+13.4f}R | {t_stat:+5.2f}")


if __name__ == "__main__":
    run_zero_fee_test()

