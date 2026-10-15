"""Hub videos re-run on the day-trading frames the videos name (owner, 2026-10-15): 15m structure, 5m entries.

Usage: python -m service.scripts.lowtf_study [15m|5m ...]

Same rules as video_hub_study.py (Rayner T.A.E, The Trading Channel double bottom, Jason Graystone high test) and
tradinglab_study.py (inducement + FVG), only on 15m / 5m candles (5m from download_klines.py --interval 5m --market futures).
Max hold 48 bars of that frame. 21 bot coins, 2025–2026, fee 0, slippage 0.04%, random control with the same SL/TP.
"""
import sys

from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import build
from service.scripts import fee0_shootout as X
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend
from service.scripts.tradinglab_study import setups as tradinglab
from service.scripts.video_hub_study import MAXB, graystone, tae, ttc_double


def main():
    for tf in sys.argv[1:] or ["15m", "5m"]:
        rows = []
        for fp in sorted(DATA_DIR.glob(f"*-PERP_{tf}.csv")):
            sym = fp.name.split("_")[0]
            if sym.replace("USDT-PERP", "") not in LIVE_COINS:
                continue
            cs = load(sym, tf, include_holdout=True)
            cs = [c for c in cs if c.t >= 1_733_011_200_000]  # from 2024-12 (warm-up for 2025)
            x, own = build(cs), daily_trend(load(sym, "1h", include_holdout=True))
            rows += tae(cs, x, own, tf, sym) + ttc_double(cs, x, own, tf, sym) + graystone(cs, x, own, tf, sym) + tradinglab(cs, x, own, tf, sym)
            print(sym, len(rows), file=sys.stderr)
        for name in sorted({r["name"] for r in rows}):
            g = [r for r in rows if r["name"] == name]
            if len(g) < 20:
                continue
            X.show(f"{name} · {tf}", {y: [r["r"] for r in g if r["year"] == y] for y in X.YEARS})
            if all(sum(r["r"] for r in g if r["year"] == y) > 0 for y in X.YEARS):
                rc = X.fixed_control([r for r in g if r["trend"] != 0], tf, MAXB)
                X.show("  vào ngẫu nhiên cùng SL/TP", {y: [r["r"] for r in rc if r["year"] == y] for y in X.YEARS})
            print(flush=True)


if __name__ == "__main__":
    main()
