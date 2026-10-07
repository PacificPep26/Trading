"""Backtest the structure plan (service/backtest/structure.py) on all *-PERP 1h files.

Usage: python -m service.scripts.structure_study [--interval 1h]

- plan built on a closed bar; limit order at the 50% pullback, valid PENDING bars
- order cancelled if price reaches TP1 or opens beyond the stop before filling
- after fill: SL first (also inside the fill bar), then TP; exit at close after MAX_HOLD bars
- fees: limit entry (maker 0.02%) + market exit (taker 0.05%); taker/taker shown too
Writes lib/structure-stats.json for the web.
"""
import argparse
import bisect
import json
import random
from collections import defaultdict
from pathlib import Path

from service.backtest.data import DATA_DIR, load
from service.backtest.structure import RETRACE, RR, W, atr_series, trend_of

PENDING, MAX_HOLD, LOOKBACK = 12, 24, 120
MIN_R, MAX_R = 0.002, 0.05
FEES = {"limit_in": 0.0007, "market": 0.001}
OUT = Path(__file__).resolve().parents[2] / "lib" / "structure-stats.json"


def run_symbol(cs, retrace=RETRACE):
    n = len(cs)
    atr = atr_series(cs)
    hi_idx, lo_idx = [], []
    for k in range(W, n - W):
        win = cs[k - W : k + W + 1]
        if all(cs[k].h > x.h for j, x in enumerate(win) if j != W):
            hi_idx.append(k)
        if all(cs[k].l < x.l for j, x in enumerate(win) if j != W):
            lo_idx.append(k)

    trades = []  # (side, outcome_R_gross_fraction, risk_fraction, year, target)
    i = 200
    while i < n - PENDING - MAX_HOLD - 2:
        start = i - LOOKBACK
        hs = hi_idx[bisect.bisect_left(hi_idx, start + W) : bisect.bisect_right(hi_idx, i - W)]
        ls = lo_idx[bisect.bisect_left(lo_idx, start + W) : bisect.bisect_right(lo_idx, i - W)]
        trend = trend_of(cs, hs, ls)
        if trend == "range":
            i += 1
            continue
        side = -1 if trend == "down" else 1
        if side < 0:
            k = hs[-1]
            hi = cs[k].h
            lo = min(c.l for c in cs[k : i + 1])
            entry, stop = lo + retrace * (hi - lo), hi + 0.1 * atr[i]
            tp2 = lo
        else:
            k = ls[-1]
            lo = cs[k].l
            hi = max(c.h for c in cs[k : i + 1])
            entry, stop = hi - retrace * (hi - lo), lo - 0.1 * atr[i]
            tp2 = hi
        risk = abs(entry - stop) / entry
        if not (MIN_R <= risk <= MAX_R):
            i += 1
            continue
        tp1 = entry + side * RR * abs(entry - stop)

        # wait for the limit fill
        fill, j = None, i + 1
        while j <= i + PENDING:
            c = cs[j]
            if (c.o >= stop) if side < 0 else (c.o <= stop):
                break
            if (c.l <= tp1) if side < 0 else (c.h >= tp1):
                break
            if (c.h >= entry) if side < 0 else (c.l <= entry):
                fill = j
                break
            j += 1
        if fill is None:
            i = j + 1
            continue

        year = cs[fill].t // 31_557_600_000 + 1970
        for target_name, target in (("tp1", tp1), ("tp2", tp2)):
            if side * (target - entry) <= 0:
                continue
            exit_px, k2 = None, fill
            for k2 in range(fill, min(fill + MAX_HOLD, n)):
                c = cs[k2]
                if (c.h >= stop) if side < 0 else (c.l <= stop):
                    exit_px = stop
                    break
                if k2 > fill and ((c.l <= target) if side < 0 else (c.h >= target)):
                    exit_px = target
                    break
            if exit_px is None:
                exit_px = cs[k2].c
            trades.append((side, side * (exit_px / entry - 1), risk, year, target_name, abs(target - entry) / abs(entry - stop)))
        i = fill + 1
    return trades


def random_trades(cs, risks, count, rng):
    out = []
    n = len(cs)
    while len(out) < count:
        i = rng.randint(200, n - MAX_HOLD - 2)
        side = rng.choice([1, -1])
        entry = cs[i + 1].o
        r = rng.choice(risks)
        stop = entry * (1 - side * r)
        tp = entry * (1 + side * RR * r)
        exit_px, k = None, i + 1
        for k in range(i + 1, i + 1 + MAX_HOLD):
            c = cs[k]
            if (c.l <= stop) if side > 0 else (c.h >= stop):
                exit_px = stop
                break
            if (c.h >= tp) if side > 0 else (c.l <= tp):
                exit_px = tp
                break
        if exit_px is None:
            exit_px = cs[k].c
        out.append((side, side * (exit_px / entry - 1), r, cs[i].t // 31_557_600_000 + 1970, "tp1", RR))
    return out


def summarize(rows, fee):
    if not rows:
        return {"n": 0}
    rs = [(g - fee) / r for _, g, r, _, _, _ in rows]
    return {
        "n": len(rs),
        "winRate": round(sum(x > 0 for x in rs) / len(rs), 3),
        "expR": round(sum(rs) / len(rs), 3),
        "avgTargetR": round(sum(t for *_, t in rows) / len(rows), 2),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", default="1h")
    ap.add_argument("--fibs", nargs="+", type=float, default=[0.382, 0.5, 0.618, 0.786])
    a = ap.parse_args()
    files = sorted(DATA_DIR.glob(f"*-PERP_{a.interval}.csv"))
    candles = {f.name.split("-PERP")[0]: load(f.name.split("_")[0], a.interval, include_holdout=True) for f in files}
    stats = {"interval": a.interval, "rr": RR, "pendingBars": PENDING, "maxHoldBars": MAX_HOLD,
             "symbols": len(files), "fees": FEES, "fibs": {}}
    all_risks = []
    for fib in a.fibs:
        by = defaultdict(list)
        for sym, cs in candles.items():
            for row in run_symbol(cs, fib):
                by[(row[4], row[0])].append((*row, sym))
                if row[4] == "tp1":
                    all_risks.append(row[2])
        res = {}
        print(f"\n== Fibonacci {fib}")
        for target in ("tp1", "tp2"):
            for side_name, side in (("long", 1), ("short", -1)):
                rows = [r[:6] for r in by[(target, side)]]
                train = [r for r in rows if r[3] <= 2025]
                test = [r for r in rows if r[3] >= 2026]
                entry = {fee_name: {"train": summarize(train, fee), "test": summarize(test, fee)} for fee_name, fee in FEES.items()}
                per_sym = defaultdict(float)
                for r in by[(target, side)]:
                    if r[3] <= 2025:
                        per_sym[r[6]] += (r[1] - FEES["limit_in"]) / r[2]
                entry["symbolsPositive"] = round(sum(v > 0 for v in per_sym.values()) / max(len(per_sym), 1), 2)
                res[f"{target}:{side_name}"] = entry
                tr, te, tm = entry["limit_in"]["train"], entry["limit_in"]["test"], entry["market"]["train"]
                print(f"  {target} {side_name:5s} | train n={tr['n']:5d} win={tr.get('winRate', 0):.0%} expR limit={tr.get('expR', 0):+.3f} "
                      f"market={tm.get('expR', 0):+.3f} (target ~{tr.get('avgTargetR', 0)}R) | 2026 n={te['n']:4d} "
                      f"expR={te.get('expR', 0):+.3f} | coin+ {entry['symbolsPositive']:.0%}")
        stats["fibs"][str(fib)] = res

    rng = random.Random(0)
    rand = []
    for cs in candles.values():
        rand += random_trades(cs, all_risks or [0.01], 200, rng)
    rtrain = [r for r in rand if r[3] <= 2025]
    stats["random"] = {"market": summarize(rtrain, FEES["market"]), "limit_in": summarize(rtrain, FEES["limit_in"])}
    print(f"\nrandom 1.8R | train n={len(rtrain)} expR market={stats['random']['market']['expR']:+.3f} "
          f"limit={stats['random']['limit_in']['expR']:+.3f}")
    OUT.write_text(json.dumps(stats, indent=1), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
