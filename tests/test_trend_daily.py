from service.backtest.data import Candle
from service.scripts.trend_daily_study import run_symbol


def c(t, o, h, l, cl):
    return Candle(t * 86_400_000, o, h, l, cl, 1.0)


def base():
    # 30 ngày đi ngang (TR=2), ngày 30 phá kênh 20 ngày lên 110 (TR=11) → ATR=2.45, vào 110 ở mở ngày 31, SL 105.1
    cs = [c(i, 100, 101, 99, 100) for i in range(30)] + [c(30, 100, 111, 100, 110)]
    return cs + [c(31 + i, 110 + i, 112 + i, 110 + i, 111 + i) for i in range(5)]


def test_stop_loss_is_minus_one_r():
    t = run_symbol(base() + [c(36, 115, 115, 104, 105)], 20, 3)[0]
    assert t["side"] == 1 and -1.2 < t["r"] < -1.0


def test_channel_exit_next_open():
    # đóng 108.5 < đáy 3 ngày (112) nhưng chưa chạm SL → thoát ở mở ngày 37 = 108
    t = run_symbol(base() + [c(36, 114, 114, 108, 108.5), c(37, 108, 109, 107, 108)], 20, 3)[0]
    assert -0.6 < t["r"] < -0.4
