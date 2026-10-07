"""Measure each setup across many perp symbols and write the web playbook (lib/playbook.json).

Usage: python -m service.scripts.build_playbook [--intervals 15m 1h]

Trade rules (intraday, like the owner trades):
- entry at the next bar open; stop from the setup; target = entry + side * m * R (m = 1, 1.5, 2)
- stop checked before target inside a bar; forced exit at the first bar opening at/after 00:00 UTC+7
- skip setups whose stop distance R is < 0.15% or > 5% of price
Results are in R (risk units) after fees. Train = 2023-2025, test = 2026 (Jan-Sep).
"""
import argparse
import json
import random
from collections import defaultdict
from pathlib import Path

from service.backtest.data import DATA_DIR, load
from service.backtest.setups import SETUPS, indicators
from service.scripts.intraday_study import day_end

OUT = Path(__file__).resolve().parents[2] / "lib" / "playbook.json"
MULTS = (1.0, 1.5, 2.0)
FEES = {"taker": 0.001, "maker": 0.0004}  # round trip
MIN_R, MAX_R = 0.0015, 0.05


def simulate(cs, i, side, stop, m):
    """Return (gross return fraction, risk fraction, year) or None."""
    e_i = i + 1
    if e_i >= len(cs):
        return None
    e = cs[e_i].o
    risk = side * (e - stop) / e
    if not (MIN_R <= risk <= MAX_R):
        return None
    tp = e * (1 + side * m * risk)
    end_t = day_end(cs[e_i].t)
    year = cs[e_i].t // 31_557_600_000 + 1970
    for k in range(e_i, len(cs)):
        c = cs[k]
        if c.t >= end_t:
            return side * (c.o / e - 1), risk, year, k
        if (c.l <= stop) if side > 0 else (c.h >= stop):
            gap = (c.o < stop) if side > 0 else (c.o > stop)
            px = c.o if gap else stop
            return side * (px / e - 1), risk, year, k
        if (c.h >= tp) if side > 0 else (c.l <= tp):
            return m * risk, risk, year, k
    return None


def summarize(rows, fee):
    """rows: list of (gross, risk, year, symbol). Returns stats dict in R after fees."""
    if not rows:
        return {"n": 0}
    rs = [(g - fee) / r for g, r, _, _ in rows]
    by_sym, by_year = defaultdict(list), defaultdict(list)
    for (g, r, y, s), x in zip(rows, rs):
        by_sym[s].append(x)
        by_year[y].append(x)
    pos = lambda d: sum(1 for v in d.values() if sum(v) > 0) / len(d)
    return {
        "n": len(rs),
        "winRate": round(sum(1 for x in rs if x > 0) / len(rs), 3),
        "expR": round(sum(rs) / len(rs), 3),
        "medianRiskPct": round(sorted(r for _, r, _, _ in rows)[len(rows) // 2] * 100, 2),
        "symbolsPositive": round(pos(by_sym), 2),
        "yearsPositive": round(pos(by_year), 2),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--intervals", nargs="+", default=["15m", "1h"])
    a = ap.parse_args()
    playbook = {"generatedFrom": "Binance USDT-M perpetuals, 2023-01 to 2026-09", "fees": FEES, "mults": MULTS, "setups": {}}

    for interval in a.intervals:
        files = sorted(DATA_DIR.glob(f"*-PERP_{interval}.csv"))
        symbols = [f.name.split("-PERP")[0] for f in files]
        print(f"\n== {interval}: {len(symbols)} symbols: {' '.join(symbols)}")
        trades = defaultdict(list)  # (setup, m) -> rows
        risks = defaultdict(list)
        candles = {}
        for sym in symbols:
            cs = load(f"{sym}-PERP", interval, include_holdout=True)
            candles[sym] = cs
            ind = indicators(cs)
            for name, det in SETUPS.items():
                for m in MULTS:
                    i = 0
                    while i < len(cs) - 1:
                        sig = det(cs, ind, i)
                        if sig and (r := simulate(cs, i, sig[0], sig[1], m)):
                            trades[(name, m)].append((r[0], r[1], r[2], sym))
                            if m == MULTS[0]:
                                risks[name].append(r[1])
                            i = r[3]
                        i += 1
            print(f"  {sym} done", flush=True)

        # random baseline: random time/symbol/side with the same stop-distance distribution
        rng = random.Random(0)
        for name in SETUPS:
            for m in MULTS:
                rows = []
                pool = risks[name] or [0.01]
                while len(rows) < 3000:
                    sym = rng.choice(symbols)
                    cs = candles[sym]
                    i = rng.randint(250, len(cs) - 2)
                    side = rng.choice([1, -1])
                    e = cs[i + 1].o
                    stop = e * (1 - side * rng.choice(pool))
                    if r := simulate(cs, i, side, stop, m):
                        rows.append((r[0], r[1], r[2], sym))
                trades[("random:" + name, m)] = rows

        for (name, m), rows in sorted(trades.items()):
            train = [r for r in rows if r[2] <= 2025]
            test = [r for r in rows if r[2] >= 2026]
            entry = playbook["setups"].setdefault(name, {}).setdefault(interval, {})
            entry[str(m)] = {
                fee_name: {"train": summarize(train, fee), "test": summarize(test, fee)}
                for fee_name, fee in FEES.items()
            }
            t, s = entry[str(m)]["taker"]["train"], entry[str(m)]["taker"]["test"]
            mk = entry[str(m)]["maker"]["train"]
            print(f"  {name:26s} {m:>3}R | train n={t['n']:6d} win={t.get('winRate',0):.0%} expR taker={t.get('expR',0):+.3f} maker={mk.get('expR',0):+.3f} "
                  f"sym+={t.get('symbolsPositive',0):.0%} yr+={t.get('yearsPositive',0):.0%} | 2026 n={s['n']:5d} expR={s.get('expR',0):+.3f}")

    OUT.write_text(json.dumps(playbook, indent=1), encoding="utf-8")
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
