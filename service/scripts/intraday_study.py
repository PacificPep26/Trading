"""Intraday study: fixed $ target / $ stop on a leveraged position, forced close at end of the Vietnam day.

Usage: python -m service.scripts.intraday_study [--symbol SOLUSDT-PERP] [--interval 15m] [--margin 40] [--lev 15]

Entries: random (baseline) and each strategy in STRATEGIES (one position at a time).
Rules: entry at next bar open; SL checked before TP inside a bar; no SL means liquidation at
-1/lev (approx., ignores maintenance margin); exit at the first bar opening at/after 00:00 UTC+7.
"""
import argparse
import random

from service.backtest.data import load, ts
from service.backtest.strategies import STRATEGIES

DAY_MS = 86_400_000
VN_OFFSET_MS = 7 * 3_600_000


def day_end(t: int) -> int:
    """Next 00:00 Vietnam time after t (ms UTC)."""
    return ((t + VN_OFFSET_MS) // DAY_MS + 1) * DAY_MS - VN_OFFSET_MS


def trade(cs, i, side, tp, sl, fee):
    """Return (net return fraction of notional, exit index). tp/sl are price-move fractions; sl=None -> liquidation."""
    e_i = i + 1
    if e_i >= len(cs):
        return None
    e = cs[e_i].o
    end_t = day_end(cs[e_i].t)
    for k in range(e_i, len(cs)):
        c = cs[k]
        if c.t >= end_t:
            return side * (c.o / e - 1) - fee, k
        adv = (e - c.l) / e if side > 0 else (c.h - e) / e
        fav = (c.h - e) / e if side > 0 else (e - c.l) / e
        if adv >= sl:
            return -sl - fee, k
        if fav >= tp:
            return tp - fee, k
    return None


def stats(rets, notional):
    if not rets:
        return "0 trades"
    usd = [r * notional for r in rets]
    wins = sum(u > 0 for u in usd)
    return f"{len(usd):5d} lệnh | thắng {wins / len(usd):4.0%} | TB {sum(usd) / len(usd):+6.2f}$/lệnh | tổng {sum(usd):+8.0f}$"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="SOLUSDT-PERP")
    ap.add_argument("--interval", default="15m")
    ap.add_argument("--margin", type=float, default=40)
    ap.add_argument("--lev", type=float, default=15)
    ap.add_argument("--fee", type=float, default=0.001, help="round trip, fraction of notional (OKX taker ~0.1%%)")
    ap.add_argument("--random", type=int, default=5000)
    a = ap.parse_args()

    cs = load(a.symbol, a.interval, include_holdout=True)
    notional = a.margin * a.lev
    liq = 1 / a.lev
    print(f"{a.symbol} {a.interval} {ts(cs[0].t)} -> {ts(cs[-1].t)} | notional {notional:.0f}$ | phí khứ hồi {a.fee:.2%} | đóng trước 0h VN")
    signals = {name: [s(cs, i) if i >= 200 else 0 for i in range(len(cs))] for name, s in STRATEGIES.items()}

    for tp_usd in (7, 10):
        tp = tp_usd / notional
        for sl_usd in (None, 3, 5, 10, 20):
            sl = liq if sl_usd is None else sl_usd / notional
            label = f"target {tp_usd}$ / " + ("không SL (thanh lý)" if sl_usd is None else f"SL {sl_usd}$")
            print(f"\n== {label} ==")

            rng = random.Random(0)
            rets = []
            for _ in range(a.random):
                r = trade(cs, rng.randint(200, len(cs) - 200), rng.choice([1, -1]), tp, sl, a.fee)
                if r:
                    rets.append(r[0])
            print(f"  {'ngẫu nhiên':16s} {stats(rets, notional)}")

            for name, sig in signals.items():
                rets, i = [], 200
                while i < len(cs) - 1:
                    side = sig[i]
                    if side and (r := trade(cs, i, side, tp, sl, a.fee)):
                        rets.append(r[0])
                        i = r[1]
                    i += 1
                print(f"  {name:16s} {stats(rets, notional)}")


if __name__ == "__main__":
    main()
