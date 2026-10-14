"""Owner (2026-10-14): "after a base breaks, price bounces — find the version that works instead of testing one rule".

Usage: python -m service.scripts.bounce_search

Event: a red bar closes below the lowest low of the previous 12 bars (base = that low), 21 bot coins, 15m and 1H.
Variants (each a reasoned fix of the first naive test, not a blind sweep):
  context : coin daily trend down / up / any
  entry   : market   = next open
            limit    = limit 0.5 ATR below the breakdown close, filled within 4 bars
            reclaim  = wait (<= 4 bars) for a close back above the base (failed breakdown), enter next open
  stop    : tight    = lowest low since the breakdown - 0.3 ATR
            wide     = entry - 1.5 ATR
  target  : 0.5R / 1R / 1.5R, max hold 16 bars, stop first.
Fee 0 (manual), slippage 0.04% round trip. Pick on 2025 only (best avg R, n >= 150), then report 2026 untouched,
with a random-entry control (same coin/year/context, same stop % and target).
"""
import random

from service.backtest.data import DATA_DIR, load
from service.backtest.structure import atr_series
from service.scripts import trailing_study as T
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import year_of

COST, MAXB = 0.0004, 16
CTX = {"ngày giảm": -1, "ngày tăng": 1, "mọi lúc": None}
ENTRIES, STOPS, TPS = ("market", "limit", "reclaim"), ("tight", "wide"), (0.5, 1.0, 1.5)


def sim(m, f, e, sl, tp, limit_fill=False):
    for k, b in enumerate(m[f : f + MAXB]):
        if b.l <= sl:
            return (b.o if b.o < sl else sl) / e - 1
        # a limit fills on the way down: the bar's high may have come before the fill, so no TP on the fill bar
        if b.h >= tp and not (limit_fill and k == 0):
            return tp / e - 1
    return m[min(f + MAXB, len(m)) - 1].c / e - 1


def entry_of(m, a, i, base, mode):
    """(fill index, entry price) or None."""
    if mode == "market":
        return i + 1, m[i + 1].o
    if mode == "limit":
        lim = m[i].c - 0.5 * a[i]
        for j in range(i + 1, i + 5):
            if m[j].l <= lim:
                return j, min(lim, m[j].o)
        return None
    for j in range(i + 1, i + 5):
        if m[j].c > base:
            return j + 1, m[j + 1].o
    return None


def run():
    res, data = {}, {}
    for tf in ("15m", "1h"):
        for fp in sorted(DATA_DIR.glob(f"*-PERP_{tf}.csv")):
            sym = fp.name.split("_")[0]
            if sym.replace("USDT-PERP", "") not in LIVE_COINS:
                continue
            m = load(sym, tf, include_holdout=True)
            own, a = daily_trend(load(sym, "1h", include_holdout=True)), atr_series(m)
            data[(tf, sym)] = (m, own, a)
            for i in range(13, len(m) - MAXB - 6):
                y = year_of(m[i].t)
                if y < 2025:
                    continue
                base = min(b.l for b in m[i - 12 : i])
                if not (m[i].c < base and m[i].c < m[i].o):
                    continue
                tr = trend_at(own, m[i].t)
                for em in ENTRIES:
                    got = entry_of(m, a, i, base, em)
                    if not got:
                        continue
                    f, e = got
                    for sm in STOPS:
                        sl = min(min(b.l for b in m[i:f]), e) - 0.3 * a[i] if sm == "tight" else e - 1.5 * a[i]
                        risk = (e - sl) / e
                        if not 0.002 <= risk <= 0.06:
                            continue
                        for R in TPS:
                            r = (sim(m, f, e, sl, e + R * (e - sl), em == "limit") - COST) / risk
                            for cname, cv in CTX.items():
                                if cv is None or cv == tr:
                                    res.setdefault((tf, cname, em, sm, R, y), []).append((r, sym, risk, tr))
    return res, data


def control(rows, tf, cv, data, R, seed=3):
    rnd, out = random.Random(seed), []
    for _, sym, risk, tr in rows:
        m, own, _ = data[(tf, sym)]
        for _ in range(50):  # random bar in 2026 with the same daily context
            q = rnd.randrange(13, len(m) - MAXB - 2)
            if year_of(m[q].t) == 2026 and (cv is None or trend_at(own, m[q].t) == cv):
                e = m[q + 1].o
                out.append((sim(m, q + 1, e, e * (1 - risk), e * (1 + R * risk)) - COST) / risk)
                break
    return out


def main():
    res, data = run()
    mean = lambda xs: sum(x[0] for x in xs) / len(xs)
    cands = [(k[:5], mean(v), len(v)) for k, v in res.items() if k[5] == 2025 and len(v) >= 150]
    cands.sort(key=lambda c: -c[1])
    print(f"{len(cands)} biến thể (n ≥ 150 trong 2025). Top 5 chọn bằng 2025, kiểm trên 2026:\n")
    for key, m25, n25 in cands[:5]:
        tf, cname, em, sm, R = key
        rows26 = res.get(key + (2026,), [])
        rc = control(rows26, tf, CTX[cname], data, R)
        print(f"{tf:3s} {cname:9s} vào {em:7s} SL {sm:5s} TP {R}R")
        print(f"  2025 (chọn): n={n25} TB {m25:+.3f}R")
        print(f"  2026 (kiểm): {T.stats([x[0] for x in rows26])}")
        print(f"  2026 ngẫu nhiên: {T.stats(rc)}\n")
    print("Tốt nhất mỗi kiểu vào (2025):")
    for em in ENTRIES:
        best = next(c for c in cands if c[0][2] == em)
        print(f"  {em:7s}: {best[0]} 2025 TB {best[1]:+.3f}R")


if __name__ == "__main__":
    main()
