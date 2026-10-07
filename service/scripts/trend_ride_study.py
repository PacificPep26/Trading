"""Backtest the owner's high-leverage trend-riding rules on 15m data.

Usage: python -m service.scripts.trend_ride_study [--coins SOLUSDT HYPEUSDT ...] [--lev 20] [--margin 40]

Rules (as given in chat on 2026-10-07):
- trend: 4h and 1h structure (last two swing highs/lows) agree
- pullback: a 15m high (short) / low (long) touched the last closed 1h EMA20 within the last 4 bars
- trigger: current 15m bar is a rejection candle in the trend direction
- stop: beyond the extreme of the last 6 15m bars + 0.05%; skip if stop distance > 1.2% or < 0.2%
- size: margin x leverage notional (margin = min(40$, equity))
- exits: half at 1.5R then stop to entry; the rest trails behind confirmed 15m swings; max hold 24h; stop first inside a bar
- daily stop: after 2 losing trades in a Vietnam calendar day, no new trades that day
- fees: round trip `fee` per coin (MEXC taker; 0 for most alts) + 0.02%/side slippage
"""
import argparse
import bisect
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from service.backtest.data import load
from service.backtest.patterns import build, confirmed, rejection, trend
from service.scripts.styles_study import resample

VN = timezone(timedelta(hours=7))
M15, H1, H4 = 900_000, 3_600_000, 14_400_000
MEXC_TAKER = {"SOLUSDT": 0.0001, "ETHUSDT": 0.0001, "BTCUSDT": 0.0002, "HYPEUSDT": 0.0002, "SUIUSDT": 0.0002, "BNBUSDT": 0.0002}
SLIP = 0.0002


def index_by_time(cs):
    return {c.t: i for i, c in enumerate(cs)}


def last_closed(idx_map, t_close, period):
    """Index of the last `period` bar that closed at or before t_close."""
    return idx_map.get((t_close // period) * period - period)


def run(sym, lev, margin_cap, max_stop):
    cs = load(f"{sym}-PERP", "15m", include_holdout=True)
    h1, h4 = resample(cs, 1), resample(cs, 4)
    c15, c1, c4 = build(cs), build(h1), build(h4)
    m1, m4 = index_by_time(h1), index_by_time(h4)
    fee = 2 * (MEXC_TAKER.get(sym, 0.0) + SLIP)
    equity, refills, trades = margin_cap, 0, []
    day_losses = defaultdict(int)
    i = 300
    while i < len(cs) - 2:
        c = cs[i]
        t_close = c.t + M15
        day = datetime.fromtimestamp(c.t / 1000, VN).date()
        j1, j4 = last_closed(m1, t_close, H1), last_closed(m4, t_close, H4)
        if j1 is None or j4 is None or j1 < 210 or j4 < 30 or day_losses[day] >= 2:
            i += 1
            continue
        side = trend(c4, j4)
        if side == 0 or trend(c1, j1) != side:
            i += 1
            continue
        ema = c1.ema20[j1]
        touched = any((x.h >= ema) if side < 0 else (x.l <= ema) for x in cs[i - 3 : i + 1])
        if not (touched and rejection(c, side) and (c.c < ema if side < 0 else c.c > ema)):
            i += 1
            continue
        entry = cs[i + 1].o
        ext = max(x.h for x in cs[i - 5 : i + 1]) if side < 0 else min(x.l for x in cs[i - 5 : i + 1])
        stop = ext * (1 + 0.0005) if side < 0 else ext * (1 - 0.0005)
        dist = side * (entry - stop) / entry
        if not (0.002 <= dist <= max_stop):
            i += 1
            continue

        if equity < 5:  # account blown: count it and start over with a fresh 40$
            refills += 1
            equity = margin_cap
        notional = min(margin_cap, equity) * lev
        tp1 = entry * (1 + side * 1.5 * dist)
        half_done, cur_stop, realized, exit_i = False, stop, 0.0, None
        for k in range(i + 1, min(i + 1 + 96, len(cs))):
            b = cs[k]
            hit_stop = (b.h >= cur_stop) if side < 0 else (b.l <= cur_stop)
            if hit_stop:
                px = b.o if ((b.o > cur_stop) if side < 0 else (b.o < cur_stop)) else cur_stop
                realized += (0.5 if half_done else 1.0) * side * (px / entry - 1)
                exit_i = k
                break
            if not half_done and ((b.l <= tp1) if side < 0 else (b.h >= tp1)):
                realized += 0.5 * side * (tp1 / entry - 1)
                half_done, cur_stop = True, entry
            if half_done:  # trail behind the last confirmed 15m swing
                sw = confirmed(c15.highs if side < 0 else c15.lows, k, 1)
                if sw:
                    lvl = cs[sw[0]].h * 1.0005 if side < 0 else cs[sw[0]].l * 0.9995
                    if (lvl < cur_stop) if side < 0 else (lvl > cur_stop):
                        cur_stop = lvl
        if exit_i is None:
            exit_i = min(i + 96, len(cs) - 1)
            realized += (0.5 if half_done else 1.0) * side * (cs[exit_i].c / entry - 1)
        pnl = notional * (realized - fee)
        equity += pnl
        if pnl < 0:
            day_losses[day] += 1
        trades.append({
            "time": datetime.fromtimestamp(cs[i + 1].t / 1000, VN).strftime("%Y-%m-%d %H:%M"),
            "side": "LONG" if side > 0 else "SHORT", "entry": entry, "stop": stop, "tp1": tp1,
            "exit_time": datetime.fromtimestamp(cs[exit_i].t / 1000, VN).strftime("%m-%d %H:%M"),
            "half": half_done, "pnl": pnl, "dist": dist, "year": int(datetime.fromtimestamp(cs[i + 1].t / 1000, VN).year),
        })
        i = exit_i + 1
    return trades, refills, equity


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--coins", nargs="+", default=["SOLUSDT", "HYPEUSDT", "ETHUSDT", "LINKUSDT", "ARBUSDT", "APTUSDT", "NEARUSDT", "DOGEUSDT", "XRPUSDT", "AVAXUSDT"])
    ap.add_argument("--lev", type=float, default=20)
    ap.add_argument("--margin", type=float, default=40)
    ap.add_argument("--max-stop", type=float, default=0.012)
    ap.add_argument("--show", default="SOLUSDT")
    a = ap.parse_args()
    print(f"đòn bẩy {a.lev}x, ký quỹ {a.margin}$ (vị thế {a.lev * a.margin:.0f}$), dừng lỗ tối đa {a.max_stop * 100:.1f}%\n")
    all_trades = []
    for sym in a.coins:
        t, refills, eq = run(sym, a.lev, a.margin, a.max_stop)
        all_trades += t
        if not t:
            print(f"{sym:9s} không có lệnh")
            continue
        n = len(t)
        wins = sum(x["pnl"] > 0 for x in t)
        tot = sum(x["pnl"] for x in t)
        by_year = defaultdict(float)
        for x in t:
            by_year[x["year"]] += x["pnl"]
        years = " ".join(f"{y}:{v:+.0f}$" for y, v in sorted(by_year.items()))
        print(f"{sym:9s} {n:4d} lệnh ({n / max(len(by_year), 1):.0f}/năm) | thắng {wins / n:.0%} | TB {tot / n:+.2f}$/lệnh | tổng {tot:+.0f}$ | "
              f"cháy 40$: {refills} lần | {years}")
        if sym == a.show:
            print("   10 lệnh gần nhất:")
            for x in t[-10:]:
                print(f"   {x['time']} {x['side']:5s} vào {x['entry']:.4g} dừng lỗ {x['stop']:.4g} ({x['dist'] * 100:.2f}%) "
                      f"TP1 {x['tp1']:.4g} {'(đã chốt nửa)' if x['half'] else '':14s} đóng {x['exit_time']} → {x['pnl']:+.2f}$")
    n = len(all_trades)
    tot = sum(x["pnl"] for x in all_trades)
    big_wins = sum(x["pnl"] >= 7 for x in all_trades)
    print(f"\nTỔNG {n} lệnh | thắng {sum(x['pnl'] > 0 for x in all_trades) / n:.0%} | TB {tot / n:+.2f}$/lệnh | lệnh lời ≥7$: {big_wins / n:.0%} | "
          f"lỗ TB khi thua {sum(x['pnl'] for x in all_trades if x['pnl'] < 0) / max(1, sum(x['pnl'] < 0 for x in all_trades)):.2f}$")


if __name__ == "__main__":
    main()
