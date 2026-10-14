"""OneR Trader style read from the owner's screenshots (2026-10-14): M1 impulse -> price comes back to where the impulse
started -> limit at that origin in the impulse direction; SL just beyond the origin, TP at the impulse's far extreme.

Usage: python -m service.scripts.impulse_origin_1m_study   (needs data/crypto/<SYM>-PERP_1m.csv, BTC/ETH/SOL from 2025-01)

Impulse ending at bar i: 1-3 same-colour 1m bars, each body >= 60% of its range, total move >= K x ATR14(1m) (K = 4, 6).
Origin = open of the first impulse bar. After the impulse, track the far extreme until price comes back to the origin
within 120 bars; limit fill at the origin (gap -> open). SL = origin -/+ (0.5 x impulse size)... no: SL beyond the highest
high / lowest low of the 5 bars before the impulse + 0.1 ATR. TP = the impulse far extreme (skip if < 1.5R). Max hold 240 bars,
stop first, fill bar touching the stop = loss. Only SL 0.15%-1%, TP capped at 4R. Filters: 1h trend (close vs EMA50 of 1h) agreeing; US session (13-20 UTC).
Costs: none / slippage only 0.04% / taker 0.2% round trip.
"""
from collections import defaultdict

from service.backtest.data import load
from service.backtest.structure import atr_series
from service.scripts import trailing_study as T
from service.scripts.styles_study import year_of


def ema_trend(cs, n=50, step=60):
    """1h close vs EMA50 of 1h closes, known at each 1h close; returned per 1m bar index."""
    out, e, last = [0] * len(cs), None, 0
    for i, c in enumerate(cs):
        if (c.t // 60_000) % step == step - 1:  # last minute of the hour
            e = c.c if e is None else e + 2 / (n + 1) * (c.c - e)
            last = 1 if c.c > e else -1
        out[i] = last
    return out


def run(sym, k):
    cs = load(f"{sym}-PERP", "1m", include_holdout=True)
    atr = atr_series(cs)
    tr1h = ema_trend(cs)
    out = []
    i, busy = 20, 0
    n = len(cs)
    while i < n - 300:
        done = False
        for m in (1, 2, 3):
            bars = cs[i - m + 1 : i + 1]
            side = 1 if bars[0].c > bars[0].o else -1
            if not all((b.c > b.o) == (side > 0) and abs(b.c - b.o) >= 0.6 * (b.h - b.l) for b in bars):
                continue
            a = atr[i - m]
            origin = bars[0].o
            if side * (bars[-1].c - origin) < k * a:
                continue
            pre = cs[i - m - 4 : i - m + 1]
            stop = min(b.l for b in pre) - 0.1 * a if side > 0 else max(b.h for b in pre) + 0.1 * a
            if side * (origin - stop) <= 0:
                continue
            ext = max(b.h for b in bars) if side > 0 else min(b.l for b in bars)
            fill = None
            for j in range(i + 1, min(i + 121, n)):
                b = cs[j]
                if (b.l <= origin) if side > 0 else (b.h >= origin):
                    fill = j
                    break
                ext = max(ext, b.h) if side > 0 else min(ext, b.l)
            if fill is None or fill <= busy:
                continue
            entry = min(origin, cs[fill].o) if side > 0 else max(origin, cs[fill].o)
            risk = abs(entry - stop) / entry
            if not 0.0015 <= risk <= 0.01 or side * (ext - entry) < 1.5 * abs(entry - stop):
                continue  # SL < 0.15%: trượt giá chiếm phần lớn R, không đánh được thật
            ext = entry + side * min(abs(ext - entry), 4 * abs(entry - stop))  # TP tối đa 4R
            g, last = None, min(fill + 239, n - 1)
            for q in range(fill, last + 1):
                b = cs[q]
                if (b.l <= stop) if side > 0 else (b.h >= stop):
                    g = side * (stop / entry - 1); last = q; break
                if q > fill and ((b.h >= ext) if side > 0 else (b.l <= ext)):
                    g = side * (ext / entry - 1); last = q; break
            if g is None:
                g = side * (cs[last].c / entry - 1)
            hour = (cs[fill].t // 3_600_000) % 24
            out.append({"year": year_of(cs[fill].t), "g": g, "risk": risk, "trend": tr1h[i] == side,
                        "us": 13 <= hour < 20, "rr": abs(ext - entry) / abs(entry - stop)})
            busy, done = last, True
            break
        i = busy + 1 if done else i + 1
    return out


def main():
    for k in (4, 6):
        allr = []
        for sym in ("BTCUSDT", "ETHUSDT", "SOLUSDT"):
            allr += [dict(r, sym=sym) for r in run(sym, k)]
        print(f"== Cú chạy ≥ {k} ATR(1m): {len(allr)} lệnh, R:R TB {sum(r['rr'] for r in allr) / len(allr):.1f}, SL TB {sum(r['risk'] for r in allr) / len(allr) * 100:.2f}%")
        for cost, cl in ((0.0, "0 phí 0 trượt"), (0.0004, "trượt 0.04%"), (0.002, "phí taker")):
            for label, sel in (("tất cả", lambda r: True), ("thuận trend 1H", lambda r: r["trend"]), ("phiên Mỹ", lambda r: r["us"]),
                               ("thuận trend + phiên Mỹ", lambda r: r["trend"] and r["us"])):
                rs = [(r["g"] - cost) / r["risk"] for r in allr if sel(r)]
                print(f"  {cl:14s} {label:24s} {T.stats(rs)}")


if __name__ == "__main__":
    main()
