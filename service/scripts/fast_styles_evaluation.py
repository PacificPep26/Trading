import bisect
import math
from collections import defaultdict
from pathlib import Path
from service.backtest.data import DATA_DIR, load, Candle
from service.backtest.patterns import STYLES, build
from service.scripts.styles_study import resample
from service.scripts.live_simulation_study import (
    daily_trend, trend_at, simulate_live_exit, net_r, FEE_TAKER_MEXC, FEE_MAKER_MEXC
)

def pinbar_reversal(ctx, i):
    cs, a = ctx.cs, ctx.atr[i]
    c = cs[i]
    # Check volume
    if ctx.vol_avg[i] > 0 and c.v > 0 and c.v / ctx.vol_avg[i] < 0.75:
        return None
    j_h = bisect.bisect_right(ctx.highs, i - 3)
    j_l = bisect.bisect_right(ctx.lows, i - 3)
    if j_h == 0 or j_l == 0:
        return None
    last_high = cs[ctx.highs[j_h - 1]].h
    last_low = cs[ctx.lows[j_l - 1]].l
    rng = c.h - c.l
    if rng <= 0.4 * a:
        return None
    body = abs(c.c - c.o)
    # Bearish pinbar
    upper_wick = c.h - max(c.o, c.c)
    if upper_wick >= 0.5 * rng and body <= 0.4 * rng and c.h >= last_high * 0.995:
        return {"side": -1, "stop": c.h + 0.05 * a, "target": None}
    # Bullish pinbar
    lower_wick = min(c.o, c.c) - c.l
    if lower_wick >= 0.5 * rng and body <= 0.4 * rng and c.l <= last_low * 1.005:
        return {"side": 1, "stop": c.l - 0.05 * a, "target": None}
    return None

ALL_STYLES = dict(STYLES)
ALL_STYLES["pinbar_reversal"] = ("Pinbar đảo chiều tại cản Swing", pinbar_reversal)

print("Pre-loading coin data...")
btc_cs = load("BTCUSDT-PERP", "1h", include_holdout=True)
btc_trend = daily_trend(btc_cs)

coin_data = []
for f in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
    sym = f.name.split("-PERP")[0]
    c1 = load(f.name.split("_")[0], "1h", include_holdout=True)
    own_trend = daily_trend(c1)
    cs4 = resample(c1, 4)
    x = build(cs4)
    coin_data.append((sym, cs4, x, own_trend))

print(f"Loaded {len(coin_data)} coins. Evaluating styles...")

for style_key, (style_name, detector) in ALL_STYLES.items():
    trades = []
    for sym, cs4, x, own_trend in coin_data:
        n = len(cs4)
        hold_bars = 12
        busy_until = 0
        for i in range(260, n - 2):
            if i <= busy_until:
                continue
            t = cs4[i].t + 4 * 3_600_000
            btc_d = trend_at(btc_trend, t)
            own_d = trend_at(own_trend, t)
            sig = detector(x, i)
            if not sig:
                continue
            side = sig["side"]
            # Macro filter
            if side < 0 and btc_d > 0:
                continue
            if side > 0 and btc_d < 0:
                continue
            # Star / alignment filter
            if side != own_d:
                continue

            fill_i = i + 1
            entry = sig.get("entry") or cs4[fill_i].o
            stop = sig["stop"]
            risk_pct = abs(entry - stop) / entry
            if risk_pct < 0.015 or risk_pct > 0.060:
                continue
            r_dist = abs(entry - stop)
            tp1 = entry + side * 1.0 * r_dist
            tp2 = entry + side * 2.0 * r_dist
            res = simulate_live_exit(cs4, fill_i, side, entry, stop, tp1, tp2, hold_bars)
            if not res:
                continue
            gross, r_fraction, hold_cnt, exit_type = res
            trades.append({
                "gross": gross,
                "risk": r_fraction,
                "hold_h": hold_cnt * 4,
                "year": cs4[fill_i].t // 31_557_600_000 + 1970,
                "exit_type": exit_type,
            })
            busy_until = fill_i + hold_cnt

    if trades:
        r_taker = [net_r(t, FEE_TAKER_MEXC) for t in trades]
        r_maker = [net_r(t, FEE_MAKER_MEXC) for t in trades]
        n_tr = len(trades)
        m_taker = sum(r_taker) / n_tr
        m_maker = sum(r_maker) / n_tr
        win_taker = sum(x > 0 for x in r_taker) / n_tr
        sd_taker = math.sqrt(sum((x - m_taker) ** 2 for x in r_taker) / (n_tr - 1)) if n_tr > 1 else 0
        t_taker = m_taker / (sd_taker / math.sqrt(n_tr)) if sd_taker > 0 else 0
        print(f"{style_key:18s} | N={n_tr:4d} | Win={win_taker*100:4.1f}% | Taker={m_taker:+.3f}R (t={t_taker:+.2f}) | Maker={m_maker:+.3f}R")
    else:
        print(f"{style_key:18s} | N=   0")

