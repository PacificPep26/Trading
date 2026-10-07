import csv
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "crypto"

# Data from this date on is the final holdout: run it once, at the very end.
HOLDOUT_START = datetime(2026, 1, 1, tzinfo=timezone.utc)


@dataclass(frozen=True)
class Candle:
    t: int  # open time, ms UTC
    o: float
    h: float
    l: float
    c: float
    v: float


def load(symbol: str, interval: str = "1h", include_holdout: bool = False) -> list[Candle]:
    path = DATA_DIR / f"{symbol}_{interval}.csv"
    cut = HOLDOUT_START.timestamp() * 1000
    out = []
    with path.open() as f:
        for r in csv.DictReader(f):
            t = int(r["open_time_ms"])
            if not include_holdout and t >= cut:
                break
            out.append(Candle(t, float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]), float(r["volume"])))
    return out


def ts(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M")
