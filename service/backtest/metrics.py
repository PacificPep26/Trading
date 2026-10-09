import math
import random

from .data import Candle
from .engine import Params, Result, simulate_trade


def summary(res: Result) -> dict:
    r = [t.ret for t in res.trades]
    n = len(r)
    if n == 0:
        return {"trades": 0}
    wins = [x for x in r if x > 0]
    losses = [x for x in r if x <= 0]
    eq, peak, mdd = 1.0, 1.0, 0.0
    for x in r:
        eq *= 1 + x
        peak = max(peak, eq)
        mdd = max(mdd, 1 - eq / peak)
    mean = sum(r) / n
    sd = math.sqrt(sum((x - mean) ** 2 for x in r) / (n - 1)) if n > 1 else 0.0
    losing_streak = max_streak = 0
    for x in r:
        losing_streak = losing_streak + 1 if x <= 0 else 0
        max_streak = max(max_streak, losing_streak)
    # Deterministic non-parametric bootstrap interval for mean return.
    rng = random.Random(0)
    means = sorted(sum(rng.choice(r) for _ in range(n)) / n for _ in range(1000))
    return {
        "trades": n,
        "win_rate": len(wins) / n,
        "expectancy": mean,
        "profit_factor": sum(wins) / -sum(losses) if sum(losses) < 0 else float("inf"),
        "total_return": eq - 1,
        "max_drawdown": mdd,
        "t_stat": mean / (sd / math.sqrt(n)) if sd > 0 else 0.0,
        "max_losing_streak": max_streak,
        "expectancy_ci95": [means[24], means[974]],
    }


def random_baseline(candles: list[Candle], res: Result, p: Params, runs: int = 300, seed: int = 0,
                    start: int = 0, end: int | None = None) -> dict:
    """Random entries with the same number of trades, same sides and same exit rules.
    p_value = share of random runs whose mean return >= the strategy's."""
    end = len(candles) if end is None else end
    if not res.trades:
        return {}
    rng = random.Random(seed)
    target = sum(t.ret for t in res.trades) / len(res.trades)
    lo, hi = max(start, p.atr_len), end - 2
    means = []
    for _ in range(runs):
        rets = [tr.ret for t in res.trades if (tr := simulate_trade(candles, rng.randint(lo, hi), t.side, p, end))]
        means.append(sum(rets) / len(rets))
    means.sort()
    return {
        "random_mean": sum(means) / runs,
        "p_value": sum(m >= target for m in means) / runs,
    }


def buy_and_hold(candles: list[Candle], start: int = 0, end: int | None = None, fee: float = 0.001) -> float:
    end = len(candles) if end is None else end
    return candles[end - 1].c / candles[start].o * (1 - fee) ** 2 - 1
