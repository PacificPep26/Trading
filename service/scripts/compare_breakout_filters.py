import os
import csv

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
        next(reader)
        for row in reader:
            if not row or len(row) < 6:
                continue
            candles.append(Candle(
                int(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5])
            ))
    return candles[-max_bars:] if max_bars and len(candles) > max_bars else candles

def backtest_with_filters(symbol, trend_filter=True, volume_mult=1.8, max_bars=15000):
    csv_15m = os.path.join(DATA_DIR, f"{symbol}USDT-PERP_15m.csv")
    if not os.path.exists(csv_15m):
        csv_15m = os.path.join(DATA_DIR, f"{symbol}USDT_15m.csv")
    if not os.path.exists(csv_15m):
        return None

    candles = load_csv(csv_15m, max_bars=max_bars)
    if len(candles) < 250:
        return None

    # Calculate EMA200 (trend benchmark)
    closes = [c.c for c in candles]
    ema200 = [closes[0]] * len(candles)
    k = 2 / (200 + 1)
    for idx in range(1, len(candles)):
        ema200[idx] = closes[idx] * k + ema200[idx - 1] * (1 - k)

    trades = []
    in_pos = None

    for i in range(200, len(candles)):
        c = candles[i]
        if in_pos:
            side = in_pos["side"]
            entry = in_pos["entry"]
            stop = in_pos["stop"]
            tp = in_pos["tp"]
            # Timeout 32 bars (~8h)
            if i - in_pos["i"] > 32:
                pnl_r = (c.c - entry) / abs(entry - stop) if side == 1 else (entry - c.c) / abs(entry - stop)
                trades.append({"r": pnl_r})
                in_pos = None
                continue

            if side == 1:
                if c.l <= stop:
                    trades.append({"r": -1.0})
                    in_pos = None
                elif c.h >= tp:
                    trades.append({"r": 2.0})
                    in_pos = None
            else:
                if c.h >= stop:
                    trades.append({"r": -1.0})
                    in_pos = None
                elif c.l <= tp:
                    trades.append({"r": 2.0})
                    in_pos = None
            continue

        # Check setup at i
        last = candles[i]
        box = candles[i - 10 : i]
        box_high = max(b.h for b in box)
        box_low = min(b.l for b in box)
        box_range = box_high - box_low
        if box_range / box_low > 0.040:
            continue
        rng = last.h - last.l
        if rng <= 0:
            continue

        avg_vol = sum(b.v for b in box) / len(box)
        vol_ratio = (last.v / avg_vol) if avg_vol > 0 else 1
        if vol_ratio < volume_mult:
            continue

        # Trend filter: only Long if above EMA200, only Short if below EMA200
        trend_up = last.c > ema200[i]
        trend_down = last.c < ema200[i]

        # Long Breakout
        if last.c > last.o and last.c > box_high:
            if trend_filter and not trend_up:
                continue
            if (last.c - last.o) < 0.60 * rng:
                continue
            entry = last.c
            stop = box_low - 0.002 * box_low
            risk = (entry - stop) / entry
            if risk < 0.005 or risk > 0.045:
                continue
            tp = entry + 2.0 * (entry - stop)
            in_pos = {"side": 1, "entry": entry, "stop": stop, "tp": tp, "i": i}

        # Short Breakdown
        elif last.c < last.o and last.c < box_low:
            if trend_filter and not trend_down:
                continue
            if (last.o - last.c) < 0.60 * rng:
                continue
            entry = last.c
            stop = box_high + 0.002 * box_high
            risk = (stop - entry) / entry
            if risk < 0.005 or risk > 0.045:
                continue
            tp = entry - 2.0 * (stop - entry)
            in_pos = {"side": -1, "entry": entry, "stop": stop, "tp": tp, "i": i}

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
        "trades": n,
        "win_rate": win_rate,
        "sum_r": sum_r,
        "avg_r": avg_r,
        "profit_factor": profit_factor
    }

def main():
    coins = ["TIA", "SUI", "SOL", "NEAR", "DOGE", "APT", "ARB", "WIF", "1000PEPE"]
    print("=" * 80)
    print("SO SANH BACKTEST: KHONG LOC TREND vs CO LOC TREND LON + VOL >= 1.8X (ANTI-BOM)")
    print("=" * 80)
    
    print("--- [CHE DO 1: RAW BREAKOUT - KHONG LOC TREND, VOL THAP 1.35x] ---")
    tot_trades_raw = 0
    tot_r_raw = 0.0
    for c in coins:
        r = backtest_with_filters(c, trend_filter=False, volume_mult=1.35)
        if r:
            tot_trades_raw += r["trades"]
            tot_r_raw += r["sum_r"]
    print(f"Ket qua RAW: {tot_trades_raw} lenh | Tong PnL: {tot_r_raw:+.2f} R (THUA LO VI BOM HANG)\n")

    print("--- [CHE DO 2: LOC TREND LON (EMA200) + VOL >= 1.8X (ANTI-BOM HANG)] ---")
    print(f"{'COIN':<10} | {'SO LENH':<8} | {'WIN RATE':<10} | {'TONG LAI (R)':<14} | {'TB R/LENH':<10} | {'PROFIT FACTOR'}")
    print("-" * 80)
    tot_trades_opt = 0
    tot_r_opt = 0.0
    tot_wins_opt = 0
    for c in coins:
        r = backtest_with_filters(c, trend_filter=True, volume_mult=1.80)
        if r:
            tot_trades_opt += r["trades"]
            tot_r_opt += r["sum_r"]
            tot_wins_opt += int(r["trades"] * r["win_rate"] / 100)
            print(f"{r['symbol']:<10} | {r['trades']:<8} | {r['win_rate']:>6.1f}%    | {r['sum_r']:>+10.2f} R    | {r['avg_r']:>+7.2f} R   | {r['profit_factor']:>6.2f}")

    print("=" * 80)
    avg_wr = (tot_wins_opt / tot_trades_opt * 100) if tot_trades_opt > 0 else 0
    avg_r_all = (tot_r_opt / tot_trades_opt) if tot_trades_opt > 0 else 0
    print(f"TONG KET OPTIMIZED: {tot_trades_opt} LENH | WIN RATE: {avg_wr:.1f}% | TONG LAI: {tot_r_opt:+.2f} R | TB: {avg_r_all:+.2f} R/LENH")
    print("=" * 80)

if __name__ == "__main__":
    main()

