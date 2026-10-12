from service.backtest.data import Candle
from service.scripts.trailing_study import exit_trail


def bar(t, o, h, l, c):
    return Candle(t, o, h, l, c, 1.0)


def test_trailing_long_locks_profit():
    # entry 100, stop 95; price runs to 120 then dumps -> exit at trailed stop, not the initial one
    cs = [bar(0, 100, 101, 99, 100), bar(1, 100, 110, 99, 110), bar(2, 110, 120, 109, 120), bar(3, 120, 120, 100, 101)]
    atr = [2.0] * len(cs)
    gross, k = exit_trail(cs, atr, 0, 1, 100.0, 95.0, mult=3.0)
    assert k == 3
    assert abs(gross - 0.14) < 1e-9  # trail = 120 - 3*2 = 114


def test_short_stop_hit_first():
    cs = [bar(0, 100, 106, 99, 104)]
    gross, k = exit_trail(cs, [2.0], 0, -1, 100.0, 105.0)
    assert k == 0 and abs(gross + 0.05) < 1e-9
