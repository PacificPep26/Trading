"""Owner's idea (2026-10-13): BTC tags a big level and turns -> trade everything with it (BTC included).

Usage: python -m service.scripts.btc_level_fade_study

Trigger on BTC 15m bars:
- level = last confirmed BTC 4h swing high (short) / swing low (long)
- touch: a 15m high within 0.3% below the level or up to 0.2% above it (mirror for lows), within the last 4 bars
- turn: 2 consecutive red 15m bars, the 2nd closing below the low of the touch bar (mirror: green, above the high)
- cooldown 16 bars (4h) after a trigger
On trigger, every coin (21 the bot scans, BTC included): market at the next 15m open,
SL above the coin's highest high of the last 16 15m bars + 0.1 ATR(15m), TP a bit before the nearest
confirmed 1h swing low below entry (+0.1 ATR); skip if TP < 1.5R or risk outside 0.2%-6%. Max hold 48 bars (12h), stop first.
Costs as trailing_study. Split 2023-24 / 2025+, and with / against the coin's daily trend.
"""
import bisect

from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import W, build
from service.backtest.structure import atr_series
from service.scripts import trailing_study as T
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import resample, year_of

M15 = 900_000


def triggers(b15):
    h4 = resample(b15, 4)
    x4 = build(h4)
    h4_t = [c.t for c in h4]
    out, cool = [], 0
    for i in range(20, len(b15)):
        if i < cool:
            continue
        j = bisect.bisect_right(h4_t, b15[i].t - 4 * 3_600_000) - 1  # last 4h bar fully closed before bar i
        if j < 10:
            continue
        hi_n = bisect.bisect_right(x4.highs, j - W)
        lo_n = bisect.bisect_right(x4.lows, j - W)
        his, los = x4.highs[hi_n - 1 : hi_n], x4.lows[lo_n - 1 : lo_n]
        a, b = b15[i - 1], b15[i]
        for side, lv in ((-1, h4[his[-1]].h if his else None), (1, h4[los[-1]].l if los else None)):
            if lv is None:
                continue
            for k in range(i - 5, i - 1):  # touch bar among the 4 bars before the turn
                t = b15[k]
                touched = (lv * 0.997 <= t.h <= lv * 1.002) if side < 0 else (lv * 0.998 <= t.l <= lv * 1.003)
                if not touched:
                    continue
                if side < 0 and a.c < a.o and b.c < b.o and b.c < t.l:
                    out.append((i, -1, lv)); cool = i + 16
                elif side > 0 and a.c > a.o and b.c > b.o and b.c > t.h:
                    out.append((i, 1, lv)); cool = i + 16
                break
            if cool > i:
                break
    return out


def main():
    btc15 = load("BTCUSDT-PERP", "15m", include_holdout=True)
    trig = triggers(btc15)
    trig_t = {btc15[i].t: (side, lv) for i, side, lv in trig}
    print(f"BTC triggers: {len(trig)} ({sum(s < 0 for _, s, _ in trig)} short / {sum(s > 0 for _, s, _ in trig)} long)")
    btc_d = daily_trend(load("BTCUSDT-PERP", "1h", include_holdout=True))
    res = []
    for fp in sorted(DATA_DIR.glob("*-PERP_15m.csv")):
        name = fp.name.split("_")[0]
        coin = name.replace("USDT-PERP", "")
        if coin not in LIVE_COINS or not (DATA_DIR / f"{name}_1h.csv").exists():
            continue
        cs = load(name, "15m", include_holdout=True)
        c1 = load(name, "1h", include_holdout=True)
        own = daily_trend(c1)
        x1 = build(c1)
        t1 = [c.t for c in c1]
        atr = atr_series(cs)
        idx = {c.t: n for n, c in enumerate(cs)}
        busy = 0
        for t, (side, _) in trig_t.items():
            i = idx.get(t)
            if i is None or i + 2 >= len(cs) or i <= busy or i < 20:
                continue
            f, entry, a = i + 1, cs[i + 1].o, atr[i]
            ext = max(c.h for c in cs[i - 15 : i + 1]) if side < 0 else min(c.l for c in cs[i - 15 : i + 1])
            stop = ext + 0.1 * a if side < 0 else ext - 0.1 * a
            h = bisect.bisect_right(t1, cs[i].t - 3_600_000) - 1  # last closed 1h bar
            sw_all = x1.lows if side < 0 else x1.highs
            swings_idx = sw_all[max(0, bisect.bisect_right(sw_all, h - W) - 20) : bisect.bisect_right(sw_all, h - W)]
            tgt = None
            for k in reversed(swings_idx):
                px = c1[k].l if side < 0 else c1[k].h
                if (px < entry) if side < 0 else (px > entry):
                    tgt = px + 0.1 * a if side < 0 else px - 0.1 * a
                    break
            risk = side * (entry - stop) / entry
            if tgt is None or not 0.002 <= risk <= 0.06 or side * (tgt - entry) / entry < 1.5 * risk:
                continue
            last = min(f + 47, len(cs) - 1)
            g = None
            for k in range(f, last + 1):
                c = cs[k]
                if (c.l <= stop) if side > 0 else (c.h >= stop):
                    px = c.o if ((c.o < stop) if side > 0 else (c.o > stop)) else stop
                    g = side * (px / entry - 1); break
                if (c.h >= tgt) if side > 0 else (c.l <= tgt):
                    g = side * (tgt / entry - 1); break
            if g is None:
                g, k = side * (cs[last].c / entry - 1), last
            res.append({"coin": coin, "side": side, "year": year_of(cs[f].t), "r": (g - T.COST) / risk,
                        "aligned": trend_at(own, cs[i].t) == side and trend_at(btc_d, cs[i].t) == side})
            busy = k
    for label, sel in (("tất cả", lambda r: True), ("SHORT", lambda r: r["side"] < 0), ("LONG", lambda r: r["side"] > 0),
                       ("thuận trend", lambda r: r["aligned"]), ("ngược trend", lambda r: not r["aligned"]),
                       ("chỉ BTC", lambda r: r["coin"] == "BTC")):
        a = [r["r"] for r in res if sel(r) and r["year"] <= 2024]
        b = [r["r"] for r in res if sel(r) and r["year"] >= 2025]
        print(f"  {label:12s} 23–24 {T.stats(a)}\n  {'':12s} 25–26 {T.stats(b)}")


if __name__ == "__main__":
    main()
