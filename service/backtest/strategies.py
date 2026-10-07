"""Example strategies. Each takes (candles, i) and may only read candles[: i + 1]."""
from .data import Candle


def sma(candles: list[Candle], i: int, n: int) -> float:
    return sum(c.c for c in candles[i - n + 1 : i + 1]) / n


def sma_cross(fast: int = 20, slow: int = 50):
    def f(candles: list[Candle], i: int) -> int:
        if i < slow:
            return 0
        now = sma(candles, i, fast) - sma(candles, i, slow)
        prev = sma(candles, i - 1, fast) - sma(candles, i - 1, slow)
        if prev <= 0 < now:
            return 1
        if prev >= 0 > now:
            return -1
        return 0

    return f


def engulfing_trend(trend_len: int = 50):
    """Bullish engulfing above SMA(trend_len) -> long; bearish engulfing below it -> short.
    A 24/7 market has no gaps, so engulfing compares bodies only."""

    def f(candles: list[Candle], i: int) -> int:
        if i < trend_len:
            return 0
        p, c = candles[i - 1], candles[i]
        trend = sma(candles, i, trend_len)
        if p.c < p.o and c.c > c.o and c.c >= p.o and c.o <= p.c and c.c > trend:
            return 1
        if p.c > p.o and c.c < c.o and c.c <= p.o and c.o >= p.c and c.c < trend:
            return -1
        return 0

    return f


def trend_volume(trend_len: int = 200, vol_len: int = 20, vol_mult: float = 1.5):
    """Trend + volume: price above SMA(trend_len) and a green candle on volume > vol_mult x average -> long.
    Mirror for short."""

    def f(candles: list[Candle], i: int) -> int:
        if i < trend_len:
            return 0
        c = candles[i]
        avg_vol = sum(x.v for x in candles[i - vol_len : i]) / vol_len
        if c.v < vol_mult * avg_vol:
            return 0
        trend = sma(candles, i, trend_len)
        if c.c > trend and c.c > c.o:
            return 1
        if c.c < trend and c.c < c.o:
            return -1
        return 0

    return f


STRATEGIES = {
    "sma_cross": sma_cross(),
    "engulfing_trend": engulfing_trend(),
    "trend_volume": trend_volume(),
}
