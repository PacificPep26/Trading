"""Owner's idea (2026-10-14, NEAR): place a resting limit just beyond the last swing low/high to catch the sweep wick.

Usage: python -m service.scripts.sweep_limit_study

1H bars, 21 bot coins, only with the coin's daily trend (long below swing lows in an uptrend, short above swing highs in a downtrend).
When a new 1H swing low is confirmed, rest a buy limit at swing_low - k x ATR14(1H) (k = 0.2, 0.5) for up to 24 bars
(cancel if price first closes beyond the level by more than 1.5 ATR, i.e. a real breakdown, or if TP would already be hit).
Stop: limit - s x ATR (s = 1.0, 1.5). TP: 1.8R or the swing high that preceded the low (if >= 1R). Max hold 48 bars, stop first;
a fill bar that also touches the stop counts as a loss. Costs: maker-ish entry is not assumed, taker costs as trailing_study.
"""
from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import W, build
from service.scripts import trailing_study as T
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import year_of


def run(k, s, tp_mode):
    btc = daily_trend(load("BTCUSDT-PERP", "1h", include_holdout=True))
    out = []
    for fp in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        name = fp.name.split("_")[0]
        if name.replace("USDT-PERP", "") not in LIVE_COINS:
            continue
        cs = load(name, "1h", include_holdout=True)
        own = daily_trend(cs)
        x = build(cs)
        busy = 0
        for side, idx in ((1, x.lows), (-1, x.highs)):
            prev_opp = x.highs if side > 0 else x.lows
            for sw in idx:
                start = sw + W  # swing confirmed after W bars
                if start + 2 >= len(cs) or start <= busy:
                    continue
                t = cs[start].t
                if trend_at(own, t) != side:
                    continue
                a = x.atr[start]
                level = cs[sw].l if side > 0 else cs[sw].h
                limit = level - side * k * a
                stop = limit - side * s * a
                opp = [j for j in prev_opp if j < sw]
                swing_tp = (cs[opp[-1]].h if side > 0 else cs[opp[-1]].l) if opp else None
                tp = limit + side * 1.8 * abs(limit - stop)
                if tp_mode == "swing":
                    if swing_tp is None or side * (swing_tp - limit) < abs(limit - stop):
                        continue
                    tp = swing_tp
                fill = None
                for j in range(start, min(start + 24, len(cs))):
                    b = cs[j]
                    if (b.h >= tp) if side > 0 else (b.l <= tp):
                        break  # ran away without us
                    if side * (level - b.c) > 1.5 * a:
                        break  # closed far beyond: real breakdown, cancel
                    if (b.l <= limit) if side > 0 else (b.h >= limit):
                        fill = j
                        break
                if fill is None:
                    continue
                entry = min(limit, cs[fill].o) if side > 0 else max(limit, cs[fill].o)
                risk = abs(entry - stop) / entry
                if not 0.003 <= risk <= 0.06:
                    continue
                g, kk = None, min(fill + 47, len(cs) - 1)
                for j in range(fill, kk + 1):
                    b = cs[j]
                    if (b.l <= stop) if side > 0 else (b.h >= stop):
                        g = side * (stop / entry - 1); kk = j; break
                    if j > fill and ((b.h >= tp) if side > 0 else (b.l <= tp)):
                        g = side * (tp / entry - 1); kk = j; break
                if g is None:
                    g = side * (cs[kk].c / entry - 1)
                out.append({"year": year_of(cs[fill].t), "r": (g - T.COST) / risk, "btc": trend_at(btc, t) == side})
                busy = kk
    return out


def main():
    for tp_mode in ("1.8R", "swing"):
        for k in (0.2, 0.5):
            for s in (1.0, 1.5):
                tr = run(k, s, tp_mode)
                for label, sel in (("thuận coin", lambda r: True), ("+BTC cùng chiều", lambda r: r["btc"])):
                    a = [r["r"] for r in tr if sel(r) and r["year"] <= 2024]
                    b = [r["r"] for r in tr if sel(r) and r["year"] >= 2025]
                    print(f"TP {tp_mode:5s} limit {k} ATR dưới đáy, SL {s} ATR, {label:16s} | 23–24 {T.stats(a)} || 25–26 {T.stats(b)}")


if __name__ == "__main__":
    main()
