"""Owner (2026-10-15): "I'd only be in for a few seconds after the release" — does the first 5–10 s spike keep going?

Usage: python -m service.scripts.news_seconds_study

Tick data: Binance USDT-M futures aggTrades (free, ms timestamps) for BTCUSDT on every event day in lib/us-events.json
(2025-01 → 2026-09). Only trades from 60 s before to 180 s after the release are kept
(data/crypto/aggtrades/BTCUSDT-<event ms>.csv); the daily zip is deleted after extraction.
p0 = last trade before the release. After d = 5 / 10 s the move m = p(d)/p0 − 1 gives the direction (only if |m| >= 0.1 / 0.3 %).
Then follow it for h = 10 / 30 / 60 s: gain = sign(m) x (p(d+h)/p(d) − 1), minus a round-trip slippage of 0.05 / 0.1 / 0.2 %.
Also: price range in the first second (how wide prices jump while the order is being filled).
"""
import csv
import io
import json
import statistics
import urllib.request
import zipfile
from datetime import datetime, timezone

from service.backtest.data import DATA_DIR
from service.scripts.news_follow_study import EVENTS, ny_to_utc_ms

SYM = "BTCUSDT"
OUT = DATA_DIR / "aggtrades"
URL = "https://data.binance.vision/data/futures/um/daily/aggTrades/{s}/{s}-aggTrades-{d}.zip"


def window(t):
    """[(ms, price)] from t-60s to t+180s, cached."""
    path = OUT / f"{SYM}-{t}.csv"
    if not path.exists():
        day = datetime.fromtimestamp(t / 1000, timezone.utc).strftime("%Y-%m-%d")
        with urllib.request.urlopen(URL.format(s=SYM, d=day), timeout=300) as r:
            z = zipfile.ZipFile(io.BytesIO(r.read()))
        rows = []
        with z.open(z.namelist()[0]) as f:
            for line in io.TextIOWrapper(f):
                p = line.split(",")
                if not p[0].isdigit():
                    continue  # header
                ms = int(p[5])
                if t - 60_000 <= ms <= t + 180_000:
                    rows.append((ms, p[1]))
        OUT.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="") as f:
            csv.writer(f).writerows(rows)
    with path.open() as f:
        return [(int(ms), float(px)) for ms, px in csv.reader(f)]


def price_at(ticks, ms):
    last = None
    for t, p in ticks:
        if t > ms:
            break
        last = p
    return last


def main():
    events = [(ny_to_utc_ms(t), k) for t, k in json.load(open(EVENTS, encoding="utf-8"))["events"]]
    events = [e for e in events if e[0] < datetime(2026, 10, 1, tzinfo=timezone.utc).timestamp() * 1000]
    res, spread = {}, []
    for n, (t, kind) in enumerate(events, 1):
        ticks = window(t)
        p0 = price_at(ticks, t - 1)
        first = [p for ms, p in ticks if t <= ms < t + 1000]
        if not p0 or not first:
            continue
        spread.append((max(first) - min(first)) / p0 * 100)
        for d in (5, 10):
            pd = price_at(ticks, t + d * 1000)
            m = pd / p0 - 1
            for thr in (0.001, 0.003):
                if abs(m) < thr:
                    continue
                side = 1 if m > 0 else -1
                for h in (10, 30, 60):
                    g = side * (price_at(ticks, t + (d + h) * 1000) / pd - 1)
                    res.setdefault((d, thr, h), []).append((g, abs(m), kind))
        print(f"\r{n}/{len(events)} tin", end="", flush=True)
    print(f"\n\nBiên độ giá trong 1 giây đầu sau tin: trung vị {statistics.median(spread):.2f}%, lớn nhất {max(spread):.2f}%")
    print("(lệnh Market đặt trong giây đó có thể khớp lệch cỡ này)\n")
    for (d, thr, h), xs in sorted(res.items()):
        gs = [g for g, _, _ in xs]
        cont = sum(g > 0 for g in gs) / len(gs)
        line = f"Giật ≥ {thr * 100:.1f}% sau {d:2d}s, giữ thêm {h:2d}s: n={len(gs):2d}  đi tiếp {cont:4.0%}  TB {statistics.mean(gs) * 100:+.3f}%"
        for slip in (0.0005, 0.001, 0.002):
            line += f" | trượt {slip * 100:.2f}%: {statistics.mean(gs) * 100 - slip * 100:+.3f}%"
        print(line)
    print("\nGiá trị % là lời/lỗ trên giá (x30 → nhân 30 ra % ký quỹ).")


if __name__ == "__main__":
    main()
