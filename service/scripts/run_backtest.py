"""Usage: python -m service.scripts.run_backtest [STRATEGY] [--symbols BTCUSDT ETHUSDT] [--holdout]"""
import argparse

from service.backtest.data import load
from service.backtest.engine import Params
from service.backtest.strategies import STRATEGIES
from service.backtest.walkforward import evaluate

COLS = ["fold", "trades", "win_rate", "expectancy", "profit_factor", "total_return",
        "max_drawdown", "t_stat", "random_mean", "p_value", "buy_hold"]


def fmt(v):
    return f"{v:.4f}" if isinstance(v, float) else str(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("strategy", nargs="?", default="sma_cross", choices=list(STRATEGIES))
    ap.add_argument("--symbols", nargs="+", default=["BTCUSDT", "ETHUSDT"])
    ap.add_argument("--holdout", action="store_true", help="include the 2026 holdout (run once, at the end)")
    ap.add_argument("--interval", default="1h")
    ap.add_argument("--fee", type=float, default=0.001, help="per side, e.g. 0 for a zero-fee exchange")
    ap.add_argument("--slippage", type=float, default=0.0002, help="per side; spread + slippage still apply at zero fee")
    ap.add_argument("--runs", type=int, default=300)
    a = ap.parse_args()
    for sym in a.symbols:
        rows = evaluate(load(sym, a.interval, include_holdout=a.holdout), STRATEGIES[a.strategy], Params(fee=a.fee, slippage=a.slippage), a.runs)
        print(f"\n== {sym} {a.interval} {a.strategy} fee={a.fee} slip={a.slippage} ==")
        print(" | ".join(COLS))
        for r in rows:
            print(" | ".join(fmt(r.get(c, "")) for c in COLS))


if __name__ == "__main__":
    main()
