"""Build compact conditional TP/SL statistics for the deployed dashboard.

The generated JSON contains counts only; raw candle CSVs remain local. Signals
use bar i after it closes, enter at bar i+1 open, and resolve SL before TP when
both are touched in one bar. Run from the repository root:

    python -m service.scripts.build_analysis_stats
"""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "crypto"
OUT = ROOT / "lib" / "analysis-stats.json"
HORIZONS = (16, 32, 96)  # 4h, 8h, 24h on 15m bars
STOP_ATR = tuple(x / 2 for x in range(1, 11))
RR = (1.0, 1.5, 2.0)
SAMPLE_EVERY = 16


def load(path: Path):
    with path.open(newline="", encoding="utf-8") as f:
        return [{"t": int(r["open_time_ms"]), "o": float(r["open"]), "h": float(r["high"]),
                 "l": float(r["low"]), "c": float(r["close"]), "v": float(r["volume"])}
                for r in csv.DictReader(f)]


def features(rows):
    out = []
    ema20 = ema200 = rows[0]["c"]
    atr = rows[0]["h"] - rows[0]["l"]
    gain = loss = 0.0
    volumes = []
    for i, c in enumerate(rows):
        if i:
            d = c["c"] - rows[i - 1]["c"]
            gain = (gain * 13 + max(d, 0)) / 14
            loss = (loss * 13 + max(-d, 0)) / 14
            tr = max(c["h"] - c["l"], abs(c["h"] - rows[i - 1]["c"]), abs(c["l"] - rows[i - 1]["c"]))
            atr = (atr * 13 + tr) / 14
            ema20 += 2 / 21 * (c["c"] - ema20)
            ema200 += 2 / 201 * (c["c"] - ema200)
        rsi = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
        vavg = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else 0
        window = rows[max(0, i - 48):i]
        out.append((ema20, ema200, atr, rsi, vavg,
                    min((x["l"] for x in window), default=c["l"]),
                    max((x["h"] for x in window), default=c["h"])))
        volumes.append(c["v"])
    return out


def key(c, f, side, btc_ret):
    ema20, ema200, atr, rsi, vavg, low48, high48 = f
    trend = "aligned" if side * (c["c"] - ema200) > 0 else "against"
    chase = (side < 0 and rsi < 30) or (side > 0 and rsi > 70)
    pullback = (side < 0 and rsi > 65) or (side > 0 and rsi < 35)
    rsi_key = "chase" if chase else "pullback" if pullback else "mid"
    body_atr = side * (c["c"] - c["o"]) / max(atr, 1e-12)
    impulse = "deep" if body_atr >= 1.5 else "reverse" if body_atr <= -1 else "normal"
    vr = c["v"] / vavg if vavg else 1
    volume = "high" if vr >= 1.5 else "low" if vr < 0.8 else "normal"
    barrier = high48 if side > 0 else low48
    near = "near" if abs(c["c"] - barrier) <= 0.5 * atr else "far"
    btc = "aligned" if side * btc_ret > 0.002 else "against" if side * btc_ret < -0.002 else "flat"
    return ":".join((trend, rsi_key, impulse, volume, near, btc))


def first_result(future, side, stop, target, horizon):
    """0=TP, 1=SL, 2=unresolved. SL deliberately wins same-bar ties."""
    for bar in future[:horizon]:
        sl = bar["l"] <= stop if side > 0 else bar["h"] >= stop
        tp = bar["h"] >= target if side > 0 else bar["l"] <= target
        if sl:
            return 1
        if tp:
            return 0
    return 2


def main():
    btc_rows = load(DATA / "BTCUSDT-PERP_15m.csv")
    btc_close = {r["t"]: r["c"] for r in btc_rows}
    counts = defaultdict(lambda: [0, 0, 0])  # win, loss, unresolved
    files = sorted(DATA.glob("*-PERP_15m.csv"))
    for path in files:
        symbol = path.name.split("USDT-PERP")[0]
        rows = load(path)
        ind = features(rows)
        for i in range(200, len(rows) - max(HORIZONS) - 1, SAMPLE_EVERY):
            c = rows[i]
            old_btc = btc_close.get(c["t"] - 4 * 15 * 60_000)
            now_btc = btc_close.get(c["t"])
            btc_ret = now_btc / old_btc - 1 if old_btc and now_btc else 0
            entry = rows[i + 1]["o"]
            atr = ind[i][2]
            future = rows[i + 1:i + 1 + max(HORIZONS)]
            for side in (1, -1):
                context = key(c, ind[i], side, btc_ret)
                for stop_atr in STOP_ATR:
                    for rr in RR:
                        stop = entry - side * stop_atr * atr
                        target = entry + side * stop_atr * rr * atr
                        for horizon in HORIZONS:
                            result = first_result(future, side, stop, target, horizon)
                            for scope in (symbol, "ALL"):
                                counts[(scope, context, horizon, stop_atr, rr)][result] += 1
                                counts[(scope, "ALL", horizon, stop_atr, rr)][result] += 1
        print(path.name, "done", flush=True)
    # The API never reports estimates below 200 resolved samples. Omitting those
    # sparse cells keeps the deployed artifact small without changing behavior.
    rows_out = [[*k, *v] for k, v in counts.items() if v[0] + v[1] >= 200]
    payload = {
        "version": 1,
        "generatedFrom": f"{len(files)} Binance USDT-M perpetuals, 2023-01 to 2026-09; every {SAMPLE_EVERY}th 15m bar",
        "horizons": list(HORIZONS), "stopAtr": list(STOP_ATR), "rr": list(RR), "rows": rows_out,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print("wrote", OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
