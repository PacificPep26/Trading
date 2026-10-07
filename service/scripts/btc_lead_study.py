"""Does BTC lead SOL? Correlation, lagged response, and a 'SOL catches up with BTC' entry test.

Usage: python -m service.scripts.btc_lead_study [--interval 15m] [--alt SOLUSDT-PERP]
"""
import argparse
import math
import random

from service.backtest.data import load
from service.scripts.intraday_study import stats, trade


def rets(cs):
    return [0.0] + [cs[i].c / cs[i - 1].c - 1 for i in range(1, len(cs))]


def corr(x, y):
    n = len(x)
    mx, my = sum(x) / n, sum(y) / n
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    sx = math.sqrt(sum((a - mx) ** 2 for a in x))
    sy = math.sqrt(sum((b - my) ** 2 for b in y))
    return sxy / (sx * sy)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", default="15m")
    ap.add_argument("--alt", default="SOLUSDT-PERP")
    ap.add_argument("--btc", default="BTCUSDT-PERP")
    ap.add_argument("--margin", type=float, default=40)
    ap.add_argument("--lev", type=float, default=15)
    a = ap.parse_args()

    btc = {c.t: c for c in load(a.btc, a.interval, include_holdout=True)}
    alt = [c for c in load(a.alt, a.interval, include_holdout=True) if c.t in btc]
    bt = [btc[c.t] for c in alt]
    rb, ra = rets(bt), rets(alt)
    print(f"{a.alt} vs {a.btc} {a.interval}: {len(alt)} nến chung")

    print("\n1) Tương quan lợi suất")
    print(f"  cùng nến:              {corr(rb[1:], ra[1:]):.2f}")
    print(f"  BTC nến trước -> {a.alt[:3]} nến sau: {corr(rb[1:-1], ra[2:]):.3f}")
    print(f"  {a.alt[:3]} nến trước -> BTC nến sau: {corr(ra[1:-1], rb[2:]):.3f}")
    beta = sum(x * y for x, y in zip(rb, ra)) / sum(x * x for x in rb)
    print(f"  beta (BTC +1% -> {a.alt[:3]} trung bình): {beta:+.2f}%")

    print(f"\n2) Sau nến BTC mạnh, {a.alt[:3]} đi tiếp thế nào (trung bình, %)")
    print("  BTC nến này | số lần | SOL cùng nến | SOL 1 nến sau | SOL 4 nến sau | khi SOL tụt lại: 1 nến sau, 4 nến sau (số lần)")
    for k in (0.003, 0.005, 0.01):
        for side in (1, -1):
            idx = [i for i in range(1, len(alt) - 5) if side * rb[i] >= k]
            lag = [i for i in idx if side * ra[i] < side * rb[i] * beta * 0.5]
            if not idx:
                continue
            avg = lambda ii, f: sum(f(i) for i in ii) / len(ii) * 100 if ii else float("nan")
            nxt = lambda i: ra[i + 1]
            n4 = lambda i: alt[i + 4].c / alt[i].c - 1
            print(f"  {'+' if side > 0 else '-'}{k*100:.1f}%      | {len(idx):6d} | {avg(idx, lambda i: ra[i]):+.3f} | {avg(idx, nxt):+.3f} | {avg(idx, n4):+.3f} | "
                  f"{avg(lag, nxt):+.3f}, {avg(lag, n4):+.3f} ({len(lag)})")

    notional = a.margin * a.lev
    print(f"\n3) Thử vào lệnh {a.alt[:3]} theo BTC: target/SL 10$, vị thế {notional:.0f}$, đóng trước 0h VN")
    for fee, fname in ((0.001, "taker"), (0.0004, "maker")):
        tp = sl = 10 / notional
        rng = random.Random(0)
        rnd = [r[0] for _ in range(3000) if (r := trade(alt, rng.randint(200, len(alt) - 200), rng.choice([1, -1]), tp, sl, fee))]
        print(f"  [{fname}] ngẫu nhiên          {stats(rnd, notional)}")
        for k in (0.005, 0.01):
            for mode in ("theo BTC", "SOL tụt lại"):
                out, i = [], 200
                while i < len(alt) - 1:
                    side = 1 if rb[i] >= k else -1 if rb[i] <= -k else 0
                    if side and mode == "SOL tụt lại" and not side * ra[i] < side * rb[i] * beta * 0.5:
                        side = 0
                    if side and (r := trade(alt, i, side, tp, sl, fee)):
                        out.append(r[0])
                        i = r[1]
                    i += 1
                print(f"  [{fname}] BTC ±{k*100:.1f}% {mode:12s} {stats(out, notional)}")


if __name__ == "__main__":
    main()
