"""Funding cực đoan: đánh NGƯỢC đám đông khi funding lệch mạnh (luật chốt trước khi chạy).

- Tín hiệu tại mỗi kỳ funding (8h): funding <= -ngưỡng -> LONG, >= +ngưỡng -> SHORT.
  A: |funding| > 0.03%/8h (trùng ngưỡng EXTREME_FUNDING của engine).
  B: 5% kỳ cực đoan nhất mỗi phía của từng coin, ngưỡng tính trên 2023–2024, áp nguyên cho 2025–2026.
- Vào ở giá mở nến 1h ngay sau kỳ funding; giữ 24h hoặc 72h; SL cứng 3% (1R = 3%).
- Phí taker 0.08%/chiều + trượt 0.02%/chiều; cộng/trừ funding thực tế trong lúc giữ lệnh.
- Mỗi coin chỉ 1 lệnh một lúc. Đối chứng: cùng coin, cùng chiều, vào giờ ngẫu nhiên.
Chạy: python service/scripts/funding_extreme_study.py
"""
import csv
import json
import random
import statistics
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backtest.data import DATA_DIR, load  # noqa: E402

H = 3_600_000
COST = 2 * (0.0008 + 0.0002)  # phí + trượt khứ hồi, theo tỉ lệ notional
SL = 0.03
FUND_DIR = DATA_DIR / "funding"
SPLIT = 1735689600000  # 2025-01-01 UTC


def funding_history(sym: str) -> list[tuple[int, float]]:
    path = FUND_DIR / f"{sym}.csv"
    if not path.exists():
        FUND_DIR.mkdir(parents=True, exist_ok=True)
        rows, start = [], 1672531200000
        while True:
            url = f"https://fapi.binance.com/fapi/v1/fundingRate?symbol={sym}&startTime={start}&limit=1000"
            batch = json.load(urllib.request.urlopen(url, timeout=20))
            rows += [(int(r["fundingTime"]), float(r["fundingRate"])) for r in batch]
            if len(batch) < 1000:
                break
            start = rows[-1][0] + 1
            time.sleep(0.3)
        with path.open("w", newline="") as f:
            csv.writer(f).writerows(rows)
    with path.open() as f:
        return [(int(t), float(r)) for t, r in csv.reader(f)]


def trade(bars, idx, i, side, hold, fund):
    """Trả về R (1R = 3%) sau phí, trượt, funding."""
    entry = bars[i].o
    stop = entry * (1 - side * SL)
    end = min(i + hold, len(bars) - 1)
    exit_px, exit_i = bars[end].c, end
    for k in range(i, end + 1):
        b = bars[k]
        if (side > 0 and b.l <= stop) or (side < 0 and b.h >= stop):
            exit_px, exit_i = stop, k
            break
    ret = side * (exit_px / entry - 1) - COST
    # Funding: long trả khi rate > 0, short nhận
    t0, t1 = bars[i].t, bars[exit_i].t + H
    ret -= side * sum(r for t, r in fund if t0 < t <= t1)
    return ret / SL, exit_i


def stats(xs):
    if len(xs) < 2:
        return f"n={len(xs)}"
    m = statistics.mean(xs)
    t = m / statistics.stdev(xs) * len(xs) ** 0.5
    return f"n={len(xs):5d} avgR={m:+.3f} t={t:+.2f} win={sum(x > 0 for x in xs) / len(xs) * 100:.0f}%"


def main():
    syms = sorted(p.name.replace("-PERP_1h.csv", "") for p in DATA_DIR.glob("*-PERP_1h.csv"))
    res = {}
    rnd = random.Random(7)
    for sym in syms:
        bars = load(f"{sym}-PERP", "1h", include_holdout=True)
        if len(bars) < 2000:
            continue
        try:
            fund = funding_history(sym)
        except Exception as e:  # coin không có trên Binance
            print(sym, "bỏ qua:", e, file=sys.stderr)
            continue
        idx = {b.t: i for i, b in enumerate(bars)}
        train_rates = sorted(r for t, r in fund if t < SPLIT)
        if len(train_rates) < 200:
            continue
        lo_b, hi_b = train_rates[int(0.05 * len(train_rates))], train_rates[int(0.95 * len(train_rates))]
        for rule, lo, hi in (("A", -0.0003, 0.0003), ("B", lo_b, hi_b)):
            for hold in (24, 72):
                busy = -1
                for t, r in fund:
                    side = 1 if r <= lo else -1 if r >= hi else 0
                    if rule == "A" and abs(r) <= 0.0003:
                        side = 0
                    i = idx.get((t // H) * H + H)  # nến 1h mở ngay sau kỳ funding
                    if not side or i is None or i <= busy:
                        continue
                    R, busy = trade(bars, idx, i, side, hold, fund)
                    j = rnd.randrange(200, len(bars) - hold - 1)  # đối chứng ngẫu nhiên
                    Rr, _ = trade(bars, idx, j, side, hold, fund)
                    period = "train" if t < SPLIT else "test"
                    res.setdefault((rule, hold, period), []).append((R, Rr, side, sym))
        print(sym, "ok", file=sys.stderr)

    for rule in "AB":
        for hold in (24, 72):
            for period in ("train", "test"):
                rows = res.get((rule, hold, period), [])
                sig = [x[0] for x in rows]
                print(f"{rule} giữ {hold}h {period:5s} | tín hiệu {stats(sig)} | ngẫu nhiên {stats([x[1] for x in rows])}")
                for side, name in ((1, "LONG "), (-1, "SHORT")):
                    print(f"      {name} {stats([x[0] for x in rows if x[2] == side])}")


if __name__ == "__main__":
    main()
