"""Download free historical klines from Binance Data Vision (no API key).

Usage: python service/scripts/download_klines.py [SYMBOL ...] [--interval 1h] [--start 2022-01]
Output: data/crypto/<SYMBOL>_<interval>.csv and data/crypto/manifest.json (source + download time).
"""
import argparse
import csv
import io
import json
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

BASES = {
    "spot": "https://data.binance.vision/data/spot/monthly/klines",
    "futures": "https://data.binance.vision/data/futures/um/monthly/klines",
}
BASE = BASES["spot"]
OUT = Path(__file__).resolve().parents[2] / "data" / "crypto"
HEADER = ["open_time_ms", "open", "high", "low", "close", "volume", "close_time_ms", "quote_volume", "trades"]


def months(start: str):
    y, m = map(int, start.split("-"))
    now = datetime.now(timezone.utc)
    while (y, m) < (now.year, now.month):  # only completed months
        yield f"{y:04d}-{m:02d}"
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def fetch_month(symbol: str, interval: str, month: str, base: str = BASE):
    url = f"{base}/{symbol}/{interval}/{symbol}-{interval}-{month}.zip"
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return list(csv.reader(io.TextIOWrapper(z.open(z.namelist()[0]))))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("symbols", nargs="*", default=["BTCUSDT", "ETHUSDT"])
    p.add_argument("--interval", default="1h")
    p.add_argument("--start", default="2022-01")
    p.add_argument("--market", choices=list(BASES), default="spot")
    a = p.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for sym in a.symbols:
        rows, got = [], []
        for mo in months(a.start):
            r = fetch_month(sym, a.interval, mo, BASES[a.market])
            if r is None:
                continue
            got.append(mo)
            for x in r:
                if not x[0].isdigit():
                    continue
                t = int(x[0])
                if t > 10**14:  # newer spot files use microseconds
                    t //= 1000
                ct = int(x[6])
                if ct > 10**14:
                    ct //= 1000
                rows.append([t, x[1], x[2], x[3], x[4], x[5], ct, x[7], x[8]])
        rows.sort(key=lambda r: r[0])
        name = f"{sym}-PERP" if a.market == "futures" else sym
        path = OUT / f"{name}_{a.interval}.csv"
        with path.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(HEADER)
            w.writerows(rows)
        manifest[f"{name}_{a.interval}"] = {
            "source": f"{BASES[a.market]}/{sym}/{a.interval}/",
            "downloaded_at": datetime.now(timezone.utc).isoformat(),
            "months": [got[0], got[-1]] if got else None,
            "rows": len(rows),
        }
        print(f"{sym} {a.interval}: {len(rows)} rows -> {path}")
    manifest_path.write_text(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
