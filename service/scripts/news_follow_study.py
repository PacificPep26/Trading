"""Owner (2026-10-15): "after US news the first candle shows good/bad — trade that direction for 2–3 candles".

Usage: python -m service.scripts.news_follow_study

Events: lib/us-events.json (CPI, NFP 08:30 New York; FOMC 14:00), 2025-01 → 2026-09, times checked against the
BTC 1m spike at the release minute. First candle = the bar opening at the release time, on 1m / 5m / 15m
(BTC, ETH, SOL from 1m data) and 15m for the 21 bot coins. Direction = its colour; only if body >= k x ATR14 (k=0,1,2).
Entry next open; SL = the other end of the first candle; exit after 2 or 3 bars, or TP 1R / 1.5R (max 8 bars);
stop first. Fee 0 (manual), slippage 0.04% or 0.1% round trip, 2.5$/trade.
Control: the same rule at the same New York time on weekdays without an event.
Pick the variant on 2025, report 2026 untouched.
"""
import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from service.backtest.data import DATA_DIR
from service.scripts import trailing_study as T
from service.scripts.live_precise_study import LIVE_COINS

M1, DAY = 60_000, 86_400_000
EVENTS = Path(__file__).resolve().parents[2] / "lib" / "us-events.json"
EXITS = (("giữ 2 nến", 2, None), ("giữ 3 nến", 3, None), ("TP 1R", 8, 1.0), ("TP 1.5R", 8, 1.5))


def ny_to_utc_ms(s):
    """New York wall time -> UTC ms (US DST: 2nd Sunday of March to 1st Sunday of November)."""
    d = datetime.fromisoformat(s)

    def sunday(y, m, n):
        x = datetime(y, m, 1)
        return x + timedelta(days=(6 - x.weekday()) % 7, weeks=n - 1)

    dst = sunday(d.year, 3, 2) <= d < sunday(d.year, 11, 1)
    return int((d + timedelta(hours=4 if dst else 5)).replace(tzinfo=timezone.utc).timestamp() * 1000)


def load_bars(path):
    with open(path) as f:
        return [(int(r["open_time_ms"]), float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]))
                for r in csv.DictReader(f)]


def resample(bars, ms):
    out = []
    for t, o, h, l, c in bars:
        k = t // ms * ms
        if out and out[-1][0] == k:
            _, o0, h0, l0, _ = out[-1]
            out[-1] = (k, o0, max(h0, h), min(l0, l), c)
        else:
            out.append((k, o, h, l, c))
    return out


def atr_at(bars, i, n=14):
    trs = [max(bars[j][2] - bars[j][3], abs(bars[j][2] - bars[j - 1][4]), abs(bars[j][3] - bars[j - 1][4]))
           for j in range(i - n, i)]
    return sum(trs) / n


def trade(bars, i, k, slip, hold, tp_r):
    """Rule on first candle i; returns R or None (no trade)."""
    t, o, h, l, c = bars[i]
    if i < 15 or i + 1 + hold > len(bars) or c == o or abs(c - o) < k * atr_at(bars, i):
        return None
    side = 1 if c > o else -1
    entry = bars[i + 1][1]
    stop = l if side > 0 else h
    r = side * (entry - stop)
    if r <= 0:
        return None
    tp = entry + side * tp_r * r if tp_r else None
    exit_px = bars[i + hold][4]
    for b in bars[i + 1 : i + 1 + hold]:
        if (b[3] <= stop) if side > 0 else (b[2] >= stop):
            exit_px = stop
            break
        if tp and ((b[2] >= tp) if side > 0 else (b[3] <= tp)):
            exit_px = tp
            break
    return (side * (exit_px - entry) - slip * entry) / r


def main():
    raw = json.load(open(EVENTS, encoding="utf-8"))["events"]
    events = [(ny_to_utc_ms(t), kind, t[11:]) for t, kind in raw]
    ev_days = {datetime.fromtimestamp(e / 1000, timezone.utc).date() for e, _, _ in events}
    series = []
    for sym in ("BTC", "ETH", "SOL"):
        b1 = load_bars(DATA_DIR / f"{sym}USDT-PERP_1m.csv")
        series += [(sym, "1m", b1), (sym, "5m", resample(b1, 5 * M1)), (sym, "15m", resample(b1, 15 * M1))]
    for fp in sorted(DATA_DIR.glob("*-PERP_15m.csv")):
        sym = fp.name.split("USDT")[0]
        if sym in LIVE_COINS and sym not in ("BTC", "ETH", "SOL"):
            series.append((sym, "15m-alt", load_bars(fp)))

    res = {}  # (tf, k, exit, slip, year, "tin"/"thường", kind) -> [R]
    for sym, tf, bars in series:
        idx = {b[0]: i for i, b in enumerate(bars)}
        first, last = bars[0][0], bars[-1][0]
        # control: same NY clock time on event-free weekdays
        ctrl = []
        d = datetime.fromtimestamp(first / 1000, timezone.utc).date()
        while datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000 < last:
            if d.weekday() < 5 and d not in ev_days:
                for clock, kind in (("08:30", "CPI/NFP"), ("14:00", "FOMC")):
                    ctrl.append((ny_to_utc_ms(f"{d.isoformat()}T{clock}"), kind))
            d += timedelta(days=1)
        for group, pts in (("tin", [(e, k) for e, k, _ in events]), ("thường", ctrl)):
            for t, kind in pts:
                i = idx.get(t)
                if i is None:
                    continue
                y = datetime.fromtimestamp(t / 1000, timezone.utc).year
                for k in (0, 1, 2):
                    for name, hold, tp_r in EXITS:
                        for slip in (0.0004, 0.001):
                            r = trade(bars, i, k, slip, hold, tp_r)
                            if r is not None:
                                res.setdefault((tf, k, name, slip, y, group), []).append(r)
                                if group == "tin":
                                    res.setdefault((tf, k, name, slip, y, kind), []).append(r)

    mean = lambda xs: sum(xs) / len(xs) if xs else float("-inf")
    keys = sorted({k[:4] for k in res if k[4] == 2025 and k[5] == "tin" and len(res[k]) >= 30})
    keys.sort(key=lambda k: -mean(res[k + (2025, "tin")]))
    print(f"{len(keys)} biến thể. Top 5 chọn bằng 2025 (tin), kiểm 2026:\n")
    for key in keys[:5]:
        tf, k, name, slip = key
        print(f"{tf:8s} thân ≥ {k} ATR · {name} · trượt {slip * 100:.2f}%")
        for y in (2025, 2026):
            print(f"  {y} tin   : {T.stats(res.get(key + (y, 'tin'), []))}")
            print(f"  {y} thường: {T.stats(res.get(key + (y, 'thường'), []))}")
        for kind in ("CPI", "NFP", "FOMC"):
            print(f"  {kind:4s} 25–26: {T.stats(res.get(key + (2025, kind), []) + res.get(key + (2026, kind), []))}")
        print()
    best_owner = ("1m", 0, "giữ 3 nến", 0.0004)  # đúng câu chủ dự án: nến đầu, theo màu, ăn 2–3 cây
    print("Đúng ý chủ dự án (nến 1m đầu tiên, theo màu, giữ 3 nến, trượt 0.04%):")
    for y in (2025, 2026):
        print(f"  {y} tin   : {T.stats(res.get(best_owner + (y, 'tin'), []))}")
        print(f"  {y} thường: {T.stats(res.get(best_owner + (y, 'thường'), []))}")


if __name__ == "__main__":
    main()
