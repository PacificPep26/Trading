"""Test every chart-analysis style in service/backtest/patterns.py on all *-PERP files.

Usage: python -m service.scripts.styles_study [--intervals 1h 4h]

Execution rules
- signal on a closed bar; market entry at the next open, or limit at `entry` valid PENDING bars
  (cancelled if price reaches the target side first or opens beyond the stop)
- stop first inside a bar (also on the fill bar); targets: 1.5R, 2R, and the style's structural target
- exit at close after MAX_HOLD bars; one open trade per style and symbol
- fees round trip: market 0.10%, limit entry 0.07%

Verdict (fixed before looking at results): TRADEABLE only if, after fees,
train (2023-2025) expR > 0 with t-stat >= 3, test (2026) expR > 0, >= 60% of coins positive, n_train >= 300.
"""
import argparse
import json
import math
import random
from collections import defaultdict
from pathlib import Path

from service.backtest.data import DATA_DIR, Candle, load
from service.backtest.patterns import STYLES, build

PENDING = 6
MAX_HOLD = {"1h": 24, "4h": 12}
RISK_RANGE = {"1h": (0.002, 0.05), "4h": (0.004, 0.08)}
FEE_MARKET, FEE_LIMIT = 0.001, 0.0007
OUT = Path(__file__).resolve().parents[2] / "lib" / "styles-stats.json"


def resample(cs: list[Candle], hours: int) -> list[Candle]:
    ms = hours * 3_600_000
    out, cur = [], None
    for c in cs:
        t = c.t // ms * ms
        if cur and cur[0] == t:
            cur[2], cur[3], cur[4], cur[5] = max(cur[2], c.h), min(cur[3], c.l), c.c, cur[5] + c.v
        else:
            if cur:
                out.append(Candle(*cur))
            cur = [t, c.o, c.h, c.l, c.c, c.v]
    if cur:
        out.append(Candle(*cur))
    return out


def year_of(t):
    return t // 31_557_600_000 + 1970


def execute(cs, i, sig, target, hold, risk_range):
    """Return (gross return fraction, risk fraction, fee, year, exit index) or None."""
    side, stop = sig["side"], sig["stop"]
    n = len(cs)
    if sig.get("entry") is None:
        fill, entry, fee = i + 1, cs[i + 1].o if i + 1 < n else None, FEE_MARKET
        if entry is None:
            return None
    else:
        entry, fee, fill = sig["entry"], FEE_LIMIT, None
        for j in range(i + 1, min(i + 1 + PENDING, n)):
            c = cs[j]
            if (c.o <= stop) if side > 0 else (c.o >= stop):
                return None
            if (c.h >= target) if side > 0 else (c.l <= target):
                return None
            if (c.l <= entry) if side > 0 else (c.h >= entry):
                fill = j
                if (c.o < entry) if side > 0 else (c.o > entry):
                    entry = c.o  # gapped through the limit: better fill
                break
        if fill is None:
            return None
    risk = side * (entry - stop) / entry
    if not (risk_range[0] <= risk <= risk_range[1]) or side * (target - entry) <= 0:
        return None
    last = min(fill + hold - 1, n - 1)
    for k in range(fill, last + 1):
        c = cs[k]
        if (c.l <= stop) if side > 0 else (c.h >= stop):
            px = c.o if ((c.o < stop) if side > 0 else (c.o > stop)) else stop
            return side * (px / entry - 1), risk, fee, year_of(cs[fill].t), k
        if (c.h >= target) if side > 0 else (c.l <= target):
            if k == fill and sig.get("entry") is not None:
                continue  # unknown order inside the fill bar: don't credit the target
            return side * (target / entry - 1), risk, fee, year_of(cs[fill].t), k
    return side * (cs[last].c / entry - 1), risk, fee, year_of(cs[fill].t), last


def stats(rows):
    if not rows:
        return {"n": 0}
    rs = [(g - f) / r for g, r, f, _, _ in rows]
    n = len(rs)
    mean = sum(rs) / n
    sd = math.sqrt(sum((x - mean) ** 2 for x in rs) / (n - 1)) if n > 1 else 0
    by_sym = defaultdict(float)
    for (g, r, f, _, s), x in zip(rows, rs):
        by_sym[s] += x
    return {
        "n": n,
        "winRate": round(sum(x > 0 for x in rs) / n, 3),
        "expR": round(mean, 3),
        "t": round(mean / (sd / math.sqrt(n)), 2) if sd else 0.0,
        "coinsPositive": round(sum(v > 0 for v in by_sym.values()) / len(by_sym), 2),
        "avgRiskPct": round(sum(r for _, r, _, _, _ in rows) / n * 100, 2),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--intervals", nargs="+", default=["1h", "4h"])
    a = ap.parse_args()
    files = sorted(DATA_DIR.glob("*-PERP_1h.csv"))
    base = {f.name.split("-PERP")[0]: load(f.name.split("_")[0], "1h", include_holdout=True) for f in files}
    out = {"symbols": sorted(base), "fees": {"market": FEE_MARKET, "limit": FEE_LIMIT}, "results": []}
    rng = random.Random(0)

    for interval in a.intervals:
        series = base if interval == "1h" else {s: resample(cs, 4) for s, cs in base.items()}
        hold, rr = MAX_HOLD[interval], RISK_RANGE[interval]
        ctxs = {s: build(cs) for s, cs in series.items()}
        random_rows = []
        for key, (title, det) in STYLES.items():
            buckets = defaultdict(list)  # target name -> rows (g, r, fee, year, symbol)
            for sym, cs in series.items():
                ctx = ctxs[sym]
                busy_until = 0
                for i in range(260, len(cs) - 2):
                    if i <= busy_until:
                        continue
                    sig = det(ctx, i)
                    if not sig:
                        continue
                    side = sig["side"]
                    ref = sig.get("entry") or cs[i + 1].o
                    R = abs(ref - sig["stop"])
                    targets = {"1.5R": ref + side * 1.5 * R, "2R": ref + side * 2 * R}
                    if sig.get("target") is not None:
                        targets["cấu trúc"] = sig["target"]
                    last_exit = i
                    for name, tgt in targets.items():
                        r = execute(cs, i, sig, tgt, hold, rr)
                        if r:
                            buckets[name].append((r[0], r[1], r[2], r[3], sym))
                            last_exit = max(last_exit, r[4])
                            if name == "1.5R" and len(random_rows) < 40_000:
                                # random twin: same symbol, random time and side, same risk, market entry
                                j = rng.randint(260, len(cs) - hold - 2)
                                s2 = rng.choice([1, -1])
                                e2 = cs[j + 1].o
                                twin = {"side": s2, "stop": e2 * (1 - s2 * r[1])}
                                rr2 = execute(cs, j, twin, e2 * (1 + s2 * 1.5 * r[1]), hold, (0, 1))
                                if rr2:
                                    random_rows.append((rr2[0], rr2[1], rr2[2], rr2[3], sym))
                    busy_until = last_exit
            for name, rows in buckets.items():
                train = [x for x in rows if x[3] <= 2025]
                test = [x for x in rows if x[3] >= 2026]
                st, se = stats(train), stats(test)
                ok = (st["n"] >= 300 and st["expR"] > 0 and st["t"] >= 3 and se.get("expR", -1) > 0
                      and st["coinsPositive"] >= 0.6)
                out["results"].append({"style": key, "title": title, "interval": interval, "target": name,
                                       "train": st, "test": se, "tradeable": ok})
                print(f"{interval} {key:18s} {name:8s} | train n={st['n']:6d} win={st.get('winRate',0):.0%} "
                      f"expR={st.get('expR',0):+.3f} t={st.get('t',0):+6.2f} coin+={st.get('coinsPositive',0):.0%} "
                      f"| 2026 n={se['n']:5d} expR={se.get('expR',0):+.3f} | {'ĐÁNH ĐƯỢC' if ok else 'không'}", flush=True)
        rnd = stats([x for x in random_rows if x[3] <= 2025])
        out.setdefault("random", {})[interval] = rnd
        print(f"{interval} random 1.5R market      | train n={rnd['n']:6d} win={rnd['winRate']:.0%} expR={rnd['expR']:+.3f}\n")
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
