"""SMC video rules (owner's TikTok, 2026-10-14): H1 FVG -> wait for the pullback -> drop to the small timeframe,
wait for a sweep that closes back -> enter; at most one re-entry per idea; no pullback = no trade.

Usage: python -m service.scripts.fvg_mtf_study

H1 (21 bot coins): bullish FVG on bar i (low[i] > high[i-2], gap >= 0.3 ATR) while H1 structure and the coin's daily trend
are up (mirror for shorts). Target = the impulse extreme (highest high from i-2 to the first touch of the zone).
Small timeframe = 15m (no 5m data in the repo). Within 48h after the FVG, once a 15m bar trades into the zone:
trigger = a 15m bar sweeps below the lowest low of the previous 8 bars and closes back above it -> enter next 15m open,
stop = sweep low - 0.1 ATR(15m), TP = impulse high (skip if < 1.5R). Stop first, max 96 bars (24h).
The FVG is dead after 2 trades (1 re-entry), when the 15m closes below the zone by 1 ATR(1h), or after 48h.
Costs: zero fee (slippage 0.04%) and taker (0.2%).
"""
import bisect

from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import build, trend
from service.backtest.structure import atr_series
from service.scripts import trailing_study as T
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import year_of

H1, M15 = 3_600_000, 900_000


def run():
    out = []
    for fp in sorted(DATA_DIR.glob("*-PERP_15m.csv")):
        name = fp.name.split("_")[0]
        if name.replace("USDT-PERP", "") not in LIVE_COINS or not (DATA_DIR / f"{name}_1h.csv").exists():
            continue
        h1 = load(name, "1h", include_holdout=True)
        m = load(name, "15m", include_holdout=True)
        own = daily_trend(h1)
        x = build(h1)
        a15 = atr_series(m)
        mt = [b.t for b in m]
        busy_until = 0
        for i in range(30, len(h1) - 2):
            c, p2 = h1[i], h1[i - 2]
            a = x.atr[i]
            side = 1 if c.l > p2.h and c.l - p2.h >= 0.3 * a else -1 if c.h < p2.l and p2.l - c.h >= 0.3 * a else 0
            if not side or trend(x, i) != side or trend_at(own, c.t + H1) != side:
                continue
            top, bot = (c.l, p2.h) if side > 0 else (p2.l, c.h)  # zone edges: top = first touched edge
            start = bisect.bisect_left(mt, c.t + H1)
            end = bisect.bisect_left(mt, c.t + H1 + 48 * H1)
            extreme = max(b.h for b in h1[i - 2 : i + 1]) if side > 0 else min(b.l for b in h1[i - 2 : i + 1])
            in_zone, trades, j = False, 0, max(start, busy_until)
            while j < min(end, len(m) - 2) and trades < 2:
                b = m[j]
                if not in_zone:
                    extreme = max(extreme, b.h) if side > 0 else min(extreme, b.l)
                    if (b.l <= top) if side > 0 else (b.h >= top):
                        in_zone = True
                    j += 1
                    continue
                if (b.c < bot - a) if side > 0 else (b.c > bot + a):
                    break  # zone failed
                prev = m[j - 8 : j]
                ref = min(q.l for q in prev) if side > 0 else max(q.h for q in prev)
                swept = (b.l < ref and b.c > ref) if side > 0 else (b.h > ref and b.c < ref)
                if not swept:
                    j += 1
                    continue
                entry = m[j + 1].o
                stop = b.l - 0.1 * a15[j] if side > 0 else b.h + 0.1 * a15[j]
                risk = side * (entry - stop) / entry
                if not 0.002 <= risk <= 0.06 or side * (extreme - entry) < 1.5 * abs(entry - stop):
                    j += 1
                    continue
                g, k = None, min(j + 96, len(m) - 1)
                for q in range(j + 1, k + 1):
                    bb = m[q]
                    if (bb.l <= stop) if side > 0 else (bb.h >= stop):
                        px = bb.o if ((bb.o < stop) if side > 0 else (bb.o > stop)) else stop
                        g = side * (px / entry - 1); k = q; break
                    if (bb.h >= extreme) if side > 0 else (bb.l <= extreme):
                        g = side * (extreme / entry - 1); k = q; break
                if g is None:
                    g = side * (m[k].c / entry - 1)
                out.append({"year": year_of(m[j].t), "g": g, "risk": risk, "re": trades == 1, "side": side, "sym": name, "tp": side * (extreme / entry - 1)})
                trades += 1
                busy_until = k + 1
                if g > 0:
                    break  # idea done after a win
                j = k + 1
    return out


def main():
    tr = run()
    for cost, label in ((0.0004, "phí 0%"), (0.002, "phí taker")):
        for name, sel in (("tất cả", lambda t: True), ("chỉ lần vào đầu", lambda t: not t["re"]), ("lần vào lại", lambda t: t["re"])):
            a = [(t["g"] - cost) / t["risk"] for t in tr if sel(t) and t["year"] <= 2024]
            b = [(t["g"] - cost) / t["risk"] for t in tr if sel(t) and t["year"] >= 2025]
            print(f"{label:9s} {name:16s} 23–24 {T.stats(a)} || 25–26 {T.stats(b)}")


if __name__ == "__main__":
    main()
