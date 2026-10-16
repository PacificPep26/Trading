"""
quant_lab/hyperopt_optimizer.py
=============================================================================
ENGINE TỐI ƯU HÓA SIÊU THAM SỐ ĐỊNH LƯỢNG (BAYESIAN HYPEROPT - TƯƠNG ĐƯƠNG FREQTRADE)
=============================================================================
Thuật toán: Tree-structured Parzen Estimator (TPE) từ Optuna
Mục tiêu: Tìm bộ tham số vàng (SL, TP, Vol, Box, Trailing BE) cho chiến lược 15m
Bảo vệ chống Overfitting (Học vẹt):
- Tối ưu hóa trên tập In-Sample (2023 - 2024)
- Kiểm định mù trên tập Out-of-Sample tương lai (2025 - 2026)
- Khấu trừ toàn bộ phí sàn Taker (-0.16% round-trip)
"""
import csv
import json
import math
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import optuna

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Tắt bớt log dài của Optuna
optuna.logging.set_verbosity(optuna.logging.WARNING)

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "crypto"
OUTPUT_PARAMS_FILE = Path(__file__).resolve().parent / "models" / "optimal_hyperparams.json"
OUTPUT_PARAMS_FILE.parent.mkdir(parents=True, exist_ok=True)

@dataclass
class Candle:
    t: int
    o: float
    h: float
    l: float
    c: float
    v: float

def load_csv(filepath: Path) -> list[Candle]:
    candles = []
    if not filepath.exists():
        return candles
    with filepath.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            candles.append(Candle(
                t=int(r["open_time_ms"]),
                o=float(r["open"]),
                h=float(r["high"]),
                l=float(r["low"]),
                c=float(r["close"]),
                v=float(r["volume"]),
            ))
    return candles

def compute_ema(candles: list[Candle], period: int) -> list[float]:
    ema = [0.0] * len(candles)
    k = 2.0 / (period + 1)
    for idx, c in enumerate(candles):
        if idx == 0:
            ema[idx] = c.c
        else:
            ema[idx] = c.c * k + ema[idx - 1] * (1.0 - k)
    return ema

def simulate_strategy(candles: list[Candle], params: dict) -> dict:
    n = len(candles)
    ema_len = params["ema_len"]
    if n < ema_len + 50:
        return {"trades": 0, "win_rate": 0, "profit_factor": 0, "net_pnl": 0, "max_dd": 100}

    ema = compute_ema(candles, ema_len)
    box_len = params["box_len"]
    vol_mult = params["vol_mult"]
    min_body = params["min_body_ratio"]
    max_wick = params["max_wick_ratio"]
    tp_mult = params["tp_multiple"]
    trail_be_r = params["trail_be_r"]
    cooldown_bars = params["cooldown_bars"]

    trades_pnl = []
    i = max(ema_len, box_len) + 5
    cooldown_until_idx = 0
    FEE_SLIPPAGE = 0.0016  # 0.16% phí hai chiều

    while i < n - 25:
        if i < cooldown_until_idx:
            i += 1
            continue

        c = candles[i]
        box = candles[i - box_len : i]
        box_hi = max(b.h for b in box)
        box_lo = min(b.l for b in box)
        box_range = box_hi - box_lo
        box_ratio = box_range / box_lo

        signal = None
        if 0.002 <= box_ratio <= 0.055:
            prev20 = candles[i - 20 : i]
            avg_vol = sum(x.v for x in prev20) / len(prev20) if prev20 else 1.0
            vol_ratio = c.v / avg_vol if avg_vol > 0 else 1.0
            rng = c.h - c.l

            if rng > 0 and vol_ratio >= vol_mult:
                # Long Breakout
                if c.c > c.o and c.c > box_hi and c.c > ema[i]:
                    body = c.c - c.o
                    upper_wick = c.h - c.c
                    if body >= min_body * rng and upper_wick <= max_wick * rng:
                        entry = candles[i + 1].o
                        sl = max(box_lo, box_hi - 0.008 * box_hi)
                        risk = (entry - sl) / entry
                        if 0.003 <= risk <= 0.035:
                            tp = entry + tp_mult * (entry - sl)
                            signal = (1, entry, sl, tp)

                # Short Breakdown
                elif c.c < c.o and c.c < box_lo and c.c < ema[i]:
                    body = c.o - c.c
                    lower_wick = c.c - c.l
                    if body >= min_body * rng and lower_wick <= max_wick * rng:
                        entry = candles[i + 1].o
                        sl = min(box_hi, box_lo + 0.008 * box_lo)
                        risk = (sl - entry) / entry
                        if 0.003 <= risk <= 0.035:
                            tp = entry - tp_mult * (sl - entry)
                            signal = (-1, entry, sl, tp)

        if signal:
            side, entry, sl, tp = signal
            risk_dist = abs(entry - sl)
            max_hold = 24
            exit_px = entry
            reason = "time"
            breakeven = False
            exit_i = i + 1

            for k in range(i + 1, min(i + 1 + max_hold, n)):
                bar = candles[k]
                if not breakeven:
                    if side == 1 and bar.h >= entry + trail_be_r * risk_dist:
                        breakeven = True
                        sl = entry
                    elif side == -1 and bar.l <= entry - trail_be_r * risk_dist:
                        breakeven = True
                        sl = entry

                hit_sl = bar.l <= sl if side == 1 else bar.h >= sl
                hit_tp = bar.h >= tp if side == 1 else bar.l <= tp

                if hit_sl and hit_tp:
                    exit_i = k
                    exit_px = sl
                    reason = "be" if breakeven else "sl"
                    break
                elif hit_sl:
                    exit_i = k
                    exit_px = sl
                    reason = "be" if breakeven else "sl"
                    break
                elif hit_tp:
                    exit_i = k
                    exit_px = tp
                    reason = "tp"
                    break
            else:
                exit_i = min(i + 1 + max_hold, n - 1)
                exit_px = candles[exit_i].c

            net_ret = side * (exit_px - entry) / entry - FEE_SLIPPAGE
            trades_pnl.append(net_ret)

            if reason == "sl":
                cooldown_until_idx = exit_i + cooldown_bars

            i = exit_i

        i += 1

    n_trades = len(trades_pnl)
    if n_trades == 0:
        return {"trades": 0, "win_rate": 0, "profit_factor": 0, "net_pnl": 0, "max_dd": 100}

    wins = [x for x in trades_pnl if x > 0]
    losses = [x for x in trades_pnl if x <= 0]
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    pf = (gross_win / gross_loss) if gross_loss > 0 else 10.0

    eq, peak, mdd = 1.0, 1.0, 0.0
    for r in trades_pnl:
        eq *= (1.0 + r * 5) # Đòn bẩy rủi ro 2-5%
        peak = max(peak, eq)
        mdd = max(mdd, (peak - eq) / peak * 100)

    win_rate = len(wins) / n_trades * 100
    net_pnl = (eq - 1.0) * 100

    return {
        "trades": n_trades,
        "win_rate": round(win_rate, 1),
        "profit_factor": round(pf, 2),
        "net_pnl": round(net_pnl, 1),
        "max_dd": round(mdd, 1),
    }

def optimize_coin(coin: str, candles: list[Candle], n_trials: int = 40):
    print(f"\n{'='*75}")
    print(f"🔥 BẮT ĐẦU HYPEROPT CHO {coin}: TÌM BỘ THAM SỐ TỐI ƯU BẰNG BAYESIAN TPE")
    print(f"{'='*75}")

    # Chia dữ liệu: 60% Train (In-Sample), 40% Test bí mật (Out-of-Sample)
    split_idx = int(len(candles) * 0.6)
    train_candles = candles[:split_idx]
    test_candles = candles[split_idx:]

    train_start_yr = datetime.fromtimestamp(train_candles[0].t/1000).year
    train_end_yr = datetime.fromtimestamp(train_candles[-1].t/1000).year
    test_start_yr = datetime.fromtimestamp(test_candles[0].t/1000).year
    test_end_yr = datetime.fromtimestamp(test_candles[-1].t/1000).year

    print(f"[*] Tập Train In-Sample: {len(train_candles):,} nến ({train_start_yr} - {train_end_yr})")
    print(f"[*] Tập Test Out-of-Sample: {len(test_candles):,} nến ({test_start_yr} - {test_end_yr})")
    print(f"[*] Số vòng thử nghiệm Bayesian: {n_trials} trials...\n")

    def objective(trial):
        params = {
            "box_len": trial.suggest_int("box_len", 28, 56, step=4),
            "vol_mult": trial.suggest_float("vol_mult", 1.4, 2.4, step=0.1),
            "min_body_ratio": trial.suggest_float("min_body_ratio", 0.50, 0.70, step=0.05),
            "max_wick_ratio": trial.suggest_float("max_wick_ratio", 0.15, 0.25, step=0.05),
            "tp_multiple": trial.suggest_float("tp_multiple", 1.3, 2.2, step=0.1),
            "trail_be_r": trial.suggest_float("trail_be_r", 0.8, 1.3, step=0.1),
            "ema_len": trial.suggest_int("ema_len", 100, 250, step=25),
            "cooldown_bars": trial.suggest_int("cooldown_bars", 2, 8, step=1),
        }

        res = simulate_strategy(train_candles, params)
        # Hàm mục tiêu: Tối đa hóa Profit Factor + Thưởng số lệnh hợp lý (30-200 kèo) - Phạt nặng Drawdown
        if res["trades"] < 25:
            return -10.0 # Quá ít kèo -> loại
        if res["max_dd"] > 50:
            return -5.0  # Cháy tài khoản -> loại

        # Điểm số kết hợp (Calmar-adjusted Profit Factor)
        score = res["profit_factor"] * 2.0 + (res["win_rate"] / 20.0) - (res["max_dd"] / 25.0)
        return score

    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=42))
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

    best_p = study.best_params
    print(f"[✓] TỐI ƯU HOÀN TẤT! Điểm số In-Sample cao nhất: {study.best_value:.2f}")
    print(f"    Bộ tham số vàng tìm được:")
    for k, v in best_p.items():
        print(f"    • {k:<15}: {v}")

    # KIỂM ĐỊNH MÙ TRÊN TẬP TEST (OUT-OF-SAMPLE TƯƠNG LAI)
    train_res = simulate_strategy(train_candles, best_p)
    test_res = simulate_strategy(test_candles, best_p)

    print(f"\n{'-'*75}")
    print(f"📊 ĐỐI CHIẾU TRAIN VÀ TEST (OUT-OF-SAMPLE):")
    print(f"{'-'*75}")
    print(f"{'TIÊU CHÍ':<20} | {'TẬP TRAIN (IN-SAMPLE)':<22} | {'TẬP TEST (OUT-OF-SAMPLE)'}")
    print(f"{'-'*75}")
    print(f"{'Số lệnh':<20} | {train_res['trades']:<22} | {test_res['trades']}")
    print(f"{'Tỷ lệ thắng (Win Rate)':<20} | {train_res['win_rate']:>5.1f}%{'':<16} | {test_res['win_rate']:>5.1f}%")
    print(f"{'Profit Factor':<20} | {train_res['profit_factor']:>5.2f}{'':<17} | {test_res['profit_factor']:>5.2f}")
    print(f"{'Max Drawdown':<20} | {train_res['max_dd']:>5.1f}%{'':<16} | {test_res['max_dd']:>5.1f}%")
    print(f"{'-'*75}")

    return {
        "coin": coin,
        "best_params": best_p,
        "train_metrics": train_res,
        "test_metrics": test_res,
    }

if __name__ == "__main__":
    btc_path = DATA_DIR / "BTCUSDT-PERP_15m.csv"
    sol_path = DATA_DIR / "SOLUSDT-PERP_15m.csv"

    results = {}
    if btc_path.exists():
        btc_candles = load_csv(btc_path)
        results["BTC"] = optimize_coin("BTC", btc_candles, n_trials=35)

    if sol_path.exists():
        sol_candles = load_csv(sol_path)
        results["SOL"] = optimize_coin("SOL", sol_candles, n_trials=35)

    # Lưu lại bộ tham số vàng để Railway nạp vào chạy trực tiếp
    with open(OUTPUT_PARAMS_FILE, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    print(f"\n[✓] ĐÃ LƯU BỘ THAM SỐ VÀNG VÀO FILE: {OUTPUT_PARAMS_FILE}")

