from service.scripts.build_analysis_stats import features, first_result


def candle(o=100.0, h=101.0, l=99.0, c=100.0, v=10.0, t=0):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def test_stop_wins_when_tp_and_sl_touch_same_bar():
    future = [candle(h=103, l=97)]
    assert first_result(future, 1, 98, 102, 1) == 1
    assert first_result(future, -1, 102, 98, 1) == 1


def test_result_respects_horizon():
    future = [candle(), candle(h=103)]
    assert first_result(future, 1, 98, 102, 1) == 2
    assert first_result(future, 1, 98, 102, 2) == 0


def test_indicator_at_index_does_not_see_future_bars():
    rows = [candle(c=100 + i * 0.1, t=i) for i in range(220)]
    prefix = features(rows[:210])[-1]
    rows[210:] = [candle(o=500, h=600, l=400, c=550, t=i) for i in range(210, 220)]
    assert features(rows)[209] == prefix
