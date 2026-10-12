"""The live rule exactly as coded, 2025 onward, exits replayed on 15m bars.

Usage: python -m service.scripts.live_precise_study

Live rule (lib/trading-policy.ts isLiveEligible + lib/decision-engine.ts evaluateSetup, 2026-10-12):
- 4h double top/bottom, coin and BTC daily close vs EMA50 both with the trade, signal bar volume >= 2x SMA20
- stop distance 1.5%-6% (INVALID_STOP), entry within 0.25% of the signal close (RUNAWAY_PRICE)
- market entry at the next 4h open; no TP; stop trails best 4h close - 3 x ATR14(4h), updated when a 4h bar closes
Coins: the 21 the bot scans. Execution on 15m bars: stop checked every 15m bar (gap through -> fill at the open); 4h-only replay shown for comparison.
Costs: MEXC taker 0.08%/side + slippage 0.02%/side + funding 0.01%/8h. Money: 2.5$ risk per trade.
"""
import bisect
from datetime import datetime, timezone

from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import STYLES, build
from service.backtest.structure import atr_series
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts import trailing_study as T
from service.scripts.styles_study import resample

H4 = 4 * 3_600_000
START = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
MAX_BARS = 60
# lib/telegram-alerts.ts COINS (PEPE là 1000PEPE trên Binance)
LIVE_COINS = {"BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK", "DOT", "LTC", "SUI", "ARB", "OP",
              "NEAR", "APT", "INJ", "TIA", "1000PEPE", "WIF"}


def exit_15m(m15, m15_t, cs, atr, f, side, entry, stop, mult=3.0):
    """Walk 15m bars from the open of 4h bar f; trail updates at each 4h close."""
    j = bisect.bisect_left(m15_t, cs[f].t)
    last4 = min(f + MAX_BARS - 1, len(cs) - 1)
    end_t = cs[last4].t + H4
    best = entry
    k = f
    while j < len(m15) and m15[j].t < end_t:
        b = m15[j]
        if (b.l <= stop) if side > 0 else (b.h >= stop):
            px = b.o if ((b.o < stop) if side > 0 else (b.o > stop)) else stop
            return side * (px / entry - 1), b.t
        if (b.t + 900_000) % H4 == 0:  # this 15m bar closes a 4h bar
            k = bisect.bisect_right([c.t for c in cs[f:last4 + 1]], b.t) - 1 + f
            best = max(best, cs[k].c) if side > 0 else min(best, cs[k].c)
            trail = best - side * mult * atr[k]
            stop = max(stop, trail) if side > 0 else min(stop, trail)
        j += 1
    return side * (cs[last4].c / entry - 1), end_t


def main():
    btc = daily_trend(load("BTCUSDT-PERP", "1h", include_holdout=True))
    rows = []
    for fp in sorted(DATA_DIR.glob("*-PERP_15m.csv")):
        name = fp.name.split("_")[0]
        if name.replace("USDT-PERP", "") not in LIVE_COINS or not (DATA_DIR / f"{name}_1h.csv").exists():
            continue
        c1 = load(name, "1h", include_holdout=True)
        m15 = load(name, "15m", include_holdout=True)
        m15_t = [b.t for b in m15]
        own, cs = daily_trend(c1), resample(c1, 4)
        x, atr = build(cs), atr_series(cs)
        busy = 0
        for i in range(260, len(cs) - 2):
            if i <= busy or cs[i + 1].t < START:
                continue
            s = STYLES["double_top_bottom"][1](x, i)
            if not s:
                continue
            side, t = s["side"], cs[i].t + H4
            if not (trend_at(btc, t) == side and trend_at(own, t) == side):
                continue
            if not x.vol_avg[i] or cs[i].v / x.vol_avg[i] < 2.0:
                continue
            f, entry = i + 1, cs[i + 1].o
            if abs(entry / cs[i].c - 1) > 0.0025:
                continue
            risk = side * (entry - s["stop"]) / entry
            if not 0.015 <= risk <= 0.06:
                continue
            g4, k4 = T.exit_trail(cs, atr, f, side, entry, s["stop"], max_bars=MAX_BARS, mult=3.0)
            g15, t_out = exit_15m(m15, m15_t, cs, atr, f, side, entry, s["stop"])
            hold_h = (t_out - cs[f].t) / 3_600_000
            cost = T.COST + T.FUNDING_8H * hold_h / 8
            rows.append({"sym": name.replace("USDT-PERP", ""), "t": cs[f].t, "side": side,
                         "r4": (g4 - cost) / risk, "r15": (g15 - cost) / risk})
            busy = max(k4, bisect.bisect_right([c.t for c in cs], t_out) - 1)

    for key, label in (("r4", "thoát trên nến 4H"), ("r15", "thoát trên nến 15m (chính xác)")):
        rs = [r[key] for r in rows]
        print(f"2025–nay, {label:30s} {T.stats(rs)}")
    for side, nm in ((1, "LONG"), (-1, "SHORT")):
        print(f"  {nm:5s} 15m: {T.stats([r['r15'] for r in rows if r['side'] == side])}")
    by_m = {}
    for r in rows:
        m = datetime.fromtimestamp(r["t"] / 1000, timezone.utc).strftime("%Y-%m")
        by_m[m] = by_m.get(m, 0) + r["r15"] * T.RISK_USD
    print("  theo tháng (15m, 2.5$/lệnh): " + " ".join(f"{m[2:]}:{v:+.0f}$" for m, v in sorted(by_m.items())))
    eq, peak, mdd, streak, worst = 0.0, 0.0, 0.0, 0, 0
    for r in sorted(rows, key=lambda r: r["t"]):
        eq += r["r15"] * T.RISK_USD
        peak = max(peak, eq); mdd = max(mdd, peak - eq)
        streak = streak + 1 if r["r15"] < 0 else 0; worst = max(worst, streak)
    print(f"  cộng dồn {eq:+.0f}$ | sụt sâu nhất {mdd:.0f}$ | chuỗi thua dài nhất {worst} lệnh")


if __name__ == "__main__":
    main()
