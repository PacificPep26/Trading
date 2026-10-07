from service.backtest.data import Candle
from service.backtest.engine import Params, run, simulate_trade
from service.backtest.metrics import summary

P = Params(sl_atr=1.0, tp_atr=2.0, max_hold=5, atr_len=2, fee=0.0, slippage=0.0)


def flat(n, px=100.0, rng=1.0):
    return [Candle(i, px, px + rng / 2, px - rng / 2, px, 1.0) for i in range(n)]


def test_entry_is_next_open_not_signal_close():
    cs = flat(10)
    cs[3] = Candle(3, 105.0, 105.5, 104.5, 105.0, 1.0)
    tr = simulate_trade(cs, 2, 1, P)
    assert tr.entry_i == 3 and tr.entry == 105.0


def test_stop_loss_wins_when_both_hit_in_same_bar():
    cs = flat(10)  # ATR = 1, entry 100 -> SL 99, TP 102
    cs[4] = Candle(4, 100.0, 103.0, 98.0, 100.0, 1.0)
    tr = simulate_trade(cs, 2, 1, P)
    assert tr.reason == "sl" and tr.exit == 99.0


def test_gap_through_stop_fills_at_open():
    cs = flat(10)
    cs[4] = Candle(4, 97.0, 97.5, 96.0, 97.0, 1.0)
    tr = simulate_trade(cs, 2, 1, P)
    assert tr.reason == "sl" and tr.exit == 97.0


def test_short_take_profit_and_costs():
    cs = flat(10)
    cs[4] = Candle(4, 100.0, 100.2, 97.0, 98.0, 1.0)
    tr = simulate_trade(cs, 2, -1, Params(sl_atr=1.0, tp_atr=2.0, max_hold=5, atr_len=2, fee=0.001, slippage=0.0))
    assert tr.reason == "tp"
    assert abs(tr.ret - (0.02 - 0.002)) < 1e-9


def test_time_exit_and_no_trade_past_end():
    cs = flat(10)
    tr = simulate_trade(cs, 2, 1, P)
    assert tr.reason == "time" and tr.exit_i == 7
    assert simulate_trade(cs, 9, 1, P) is None


def test_strategy_only_sees_closed_bars():
    cs = flat(20)
    seen = []

    def spy(candles, i):
        seen.append(i)
        return 0

    run(cs, spy, P)
    assert max(seen) == len(cs) - 2  # last bar is never used as a signal: no next open to enter


def test_summary():
    cs = flat(30)
    res = run(cs, lambda c, i: 1 if i == 5 else 0, P)
    s = summary(res)
    assert s["trades"] == 1 and s["win_rate"] == 0.0
