import os
import glob
import csv
import math

DATA_DIR = os.path.join(os.getcwd(), "data", "crypto")

class Candle:
    def __init__(self, t, o, h, l, c, v):
        self.t = t
        self.o = o
        self.h = h
        self.l = l
        self.c = c
        self.v = v

def load_csv(path, max_bars=15000):
    candles = []
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        for row in reader:
            if not row or len(row) < 6:
                continue
            candles.append(Candle(
                int(row[0]),
                float(row[1]),
                float(row[2]),
                float(row[3]),
                float(row[4]),
                float(row[5])
            ))
    # Return last max_bars (e.g. recent months)
    return candles[-max_bars:] if max_bars and len(candles) > max_bars else candles

def detect_breakout_15m(candles, i):
    """Mô hình Nén Hộp Bùng Nổ / Phân Phối Sụp Đổ 15m"""
    if i < 15:
        return None
    last = candles[i]
    box = candles[i - 10 : i]
    box_high = max(b.h for b in box)
    box_low = min(b.l for b in box)
    box_range = box_high - box_low
    if box_range / box_low > 0.045:
        return None
    rng = last.h - last.l
    if rng <= 0:
        return None
    avg_vol = sum(b.v for b in box) / len(box)
    vol_ratio = (last.v / avg_vol) if avg_vol > 0 else 1
    if vol_ratio < 1.35:
        return None

    # Long Breakout
    if last.c > last.o and last.c > box_high:
        if (last.c - last.o) < 0.55 * rng:
            return None
        entry = last.c
        stop = box_low - 0.002 * box_low
        risk = (entry - stop) / entry
        if risk < 0.005 or risk > 0.06:
            return None
        tp = entry + 2.0 * (entry - stop)
        return {"side": 1, "entry": entry, "stop": stop, "tp": tp, "i": i}

    # Short Breakdown
    if last.c < last.o and last.c < box_low:
        if (last.o - last.c) < 0.55 * rng:
            return None
        entry = last.c
        stop = box_high + 0.002 * box_high
        risk = (stop - entry) / entry
        if risk < 0.005 or risk > 0.06:
            return None
        tp = entry - 2.0 * (stop - entry)
        return {"side": -1, "entry": entry, "stop": stop, "tp": tp, "i": i}

    return None

def backtest_coin(symbol, max_bars=15000):
    csv_15m = os.path.join(DATA_DIR, f"{symbol}USDT-PERP_15m.csv")
    if not os.path.exists(csv_15m):
        csv_15m = os.path.join(DATA_DIR, f"{symbol}USDT_15m.csv")
    if not os.path.exists(csv_15m):
        return None

    candles = load_csv(csv_15m, max_bars=max_bars)
    if len(candles) < 100:
        return None

    trades = []
    in_pos = None

    for i in range(15, len(candles)):
        c = candles[i]
        # Check active position
        if in_pos:
            side = in_pos["side"]
            entry = in_pos["entry"]
            stop = in_pos["stop"]
            tp = in_pos["tp"]
            # Expiry after 30 bars (~7.5 hours)
            if i - in_pos["i"] > 30:
                pnl_r = (c.c - entry) / abs(entry - stop) if side == 1 else (entry - c.c) / abs(entry - stop)
                trades.append({"r": pnl_r, "reason": "timeout"})
                in_pos = None
                continue

            if side == 1:
                if c.l <= stop:
                    trades.append({"r": -1.0, "reason": "sl"})
                    in_pos = None
                elif c.h >= tp:
                    trades.append({"r": 2.0, "reason": "tp"})
                    in_pos = None
            else:
                if c.h >= stop:
                    trades.append({"r": -1.0, "reason": "sl"})
                    in_pos = None
                elif c.l <= tp:
                    trades.append({"r": 2.0, "reason": "tp"})
                    in_pos = None
            continue

        # Check new signal
        sig = detect_breakout_15m(candles, i)
        if sig:
            in_pos = sig

    if not trades:
        return None

    n = len(trades)
    wins = sum(1 for t in trades if t["r"] > 0)
    win_rate = (wins / n) * 100
    sum_r = sum(t["r"] for t in trades)
    avg_r = sum_r / n
    gross_win = sum(t["r"] for t in trades if t["r"] > 0)
    gross_loss = abs(sum(t["r"] for t in trades if t["r"] < 0))
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else 99.0

    return {
        "symbol": symbol,
        "bars": len(candles),
        "trades": n,
        "win_rate": win_rate,
        "sum_r": sum_r,
        "avg_r": avg_r,
        "profit_factor": profit_factor
    }

def main():
    coins = ["TIA", "SUI", "SOL", "NEAR", "DOGE", "APT", "ARB", "WIF", "1000PEPE"]
    print("=" * 80)
    print("BACKTEST THUC TE: MO HINH NEN HOP BUNG NO WYCKOFF (15M 2 CHIEU) TREN DU LIEU THAT")
    print("=" * 80)
    print(f"{'COIN':<10} | {'BARS':<8} | {'SO LENH':<8} | {'WIN RATE':<10} | {'TONG LAI (R)':<14} | {'TB R/LENH':<10} | {'PROFIT FACTOR'}")
    print("-" * 80)

    total_trades = 0
    total_r = 0.0
    total_wins = 0

    for c in coins:
        res = backtest_coin(c, max_bars=15000) # ~15,000 nến 15m = 156 ngày (~5 tháng)
        if res:
            total_trades += res["trades"]
            total_r += res["sum_r"]
            total_wins += int(res["trades"] * res["win_rate"] / 100)
            print(f"{res['symbol']:<10} | {res['bars']:<8} | {res['trades']:<8} | {res['win_rate']:>6.1f}%    | {res['sum_r']:>+10.2f} R    | {res['avg_r']:>+7.2f} R   | {res['profit_factor']:>6.2f}")

    print("=" * 80)
    avg_wr = (total_wins / total_trades * 100) if total_trades > 0 else 0
    avg_r_all = (total_r / total_trades) if total_trades > 0 else 0
    print(f"TONG KET: {total_trades} LENH | WIN RATE: {avg_wr:.1f}% | TONG LAI: {total_r:+.2f} R | TB: {avg_r_all:+.2f} R/LENH")
    print("=" * 80)

if __name__ == "__main__":
    main()
