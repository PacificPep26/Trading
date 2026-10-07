from .data import Candle, ts
from .engine import Params, Strategy, run
from .metrics import buy_and_hold, random_baseline, summary


def year_folds(candles: list[Candle]) -> list[tuple[str, int, int]]:
    """Split into calendar-year folds: (label, start index, end index)."""
    folds, start = [], 0
    for i in range(1, len(candles) + 1):
        if i == len(candles) or ts(candles[i].t)[:4] != ts(candles[start].t)[:4]:
            folds.append((ts(candles[start].t)[:4], start, i))
            start = i
    return folds


def evaluate(candles: list[Candle], strategy: Strategy, p: Params = Params(), runs: int = 300) -> list[dict]:
    rows = []
    for label, s, e in year_folds(candles):
        res = run(candles, strategy, p, s, e)
        row = {"fold": label, **summary(res)}
        row.update(random_baseline(candles, res, p, runs=runs, start=s, end=e))
        row["buy_hold"] = buy_and_hold(candles, s, e, p.fee)
        rows.append(row)
    return rows
