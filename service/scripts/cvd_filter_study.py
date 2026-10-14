"""Does the live CVD score (lib/cvd-engine.ts) separate good 4H trades from bad ones?

Same 881-trade set and costs as live_simulation_study.py. For each trade, CVD is taken from the
4 completed 1H candles before entry (Binance futures taker_buy_volume), with the exact live rule:
  accumulating = buy/sell 4h >= 1.15 or (delta4h > 0 and delta1h > 0)
  distributing = buy/sell 4h <= 0.85 or (delta4h < 0 and delta1h < 0)
Score +1 if it agrees with the trade side, -1 if it opposes, 0 otherwise (same order as evaluateCvdSignal).

Usage: python -m service.scripts.cvd_filter_study   (needs download_klines.py --market futures re-run first)
"""
import csv
import math

from service.backtest.data import DATA_DIR
from service.scripts.live_simulation_study import net_r, run_full_simulation

H = 3_600_000


def taker_rows(sym):
    out = {}
    with (DATA_DIR / f"{sym}-PERP_1h.csv").open() as f:
        for r in csv.DictReader(f):
            buy = float(r["taker_buy_volume"])
            out[int(r["open_time_ms"])] = (buy, float(r["volume"]) - buy)
    return out


def cvd_flags(rows, t_in):
    hours = [rows.get(t_in - k * H) for k in range(1, 5)]  # newest first, like OKX rubik rows
    if any(h is None for h in hours):
        return None
    buy, sell = sum(h[0] for h in hours), sum(h[1] for h in hours)
    d1, d4 = hours[0][0] - hours[0][1], buy - sell
    ratio = buy / sell if sell > 0 else 1
    return ratio >= 1.15 or (d4 > 0 and d1 > 0), ratio <= 0.85 or (d4 < 0 and d1 < 0), ratio


def live_score(side, acc, dist):
    if side > 0:
        return 1 if acc else -1 if dist else 0
    return 1 if dist else -1 if acc else 0


def stats(rs):
    n = len(rs)
    if n < 2:
        return f"n={n}"
    m = sum(rs) / n
    sd = math.sqrt(sum((x - m) ** 2 for x in rs) / (n - 1))
    return f"n={n:4d}  thắng {sum(x > 0 for x in rs) / n * 100:4.1f}%  TB {m:+.3f}R  t={m / (sd / math.sqrt(n)):+.2f}  tổng {2.5 * sum(rs):+7.1f}$"


def main():
    trades = [t for t in run_full_simulation() if t["year"] >= 2025]  # chủ dự án chỉ xét 2025–2026
    cache, rows = {}, []
    for tr in trades:
        if tr["sym"] not in cache:
            cache[tr["sym"]] = taker_rows(tr["sym"])
        f = cvd_flags(cache[tr["sym"]], tr["t_in"])
        if f is None:
            continue
        acc, dist, ratio = f
        rows.append((tr, live_score(tr["side"], acc, dist), ratio, net_r(tr, 0.0)))

    print(f"Lệnh có dữ liệu CVD: {len(rows)}/{len(trades)}  (2.5$/lệnh, phí 0 — giao dịch tay miễn phí; vẫn trừ trượt 0.04% + funding)\n")
    print("Tất cả            ", stats([r for _, _, _, r in rows]))
    for s, name in ((1, "CVD +1 (cùng chiều)"), (0, "CVD 0            "), (-1, "CVD -1 (ngược)   ")):
        print(name, stats([r for _, sc, _, r in rows if sc == s]))
    print("Bỏ lệnh CVD -1    ", stats([r for _, sc, _, r in rows if sc >= 0]))

    print("\nTheo năm (+1 / -1):")
    for y in (2025, 2026):
        for s in (1, -1):
            print(f"  {y} CVD {s:+d}", stats([r for tr, sc, _, r in rows if sc == s and tr["year"] == y]))

    print("\nChỉ dùng tỷ lệ mua/bán 4h (bỏ vế delta), theo chiều lệnh:")
    for lo, hi, name in ((1.15, 99, ">= 1.15"), (1.0, 1.15, "1.00-1.15"), (0.85, 1.0, "0.85-1.00"), (0, 0.85, "<= 0.85")):
        sel = [r for tr, _, ratio, r in rows if lo <= (ratio if tr["side"] > 0 else 1 / ratio) < hi]
        print(f"  mua/bán thuận chiều {name:9s}", stats(sel))


if __name__ == "__main__":
    main()
