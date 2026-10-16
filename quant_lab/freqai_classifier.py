"""
quant_lab/freqai_classifier.py
=============================================================================
ENGINE HỌC MÁY THÍCH ỨNG (FREQAI ADAPTIVE MACHINE LEARNING CLASSIFIER)
=============================================================================
Thuật toán: Gradient Boosting / Random Forest từ Scikit-learn
Mục tiêu:
1. Trích xuất 10 đặc trưng vi mô của nến & khối lượng (Microstructure Features)
2. Học dự đoán xác suất nến tiếp theo có chạy được >= 1.5R hay sẽ quay đầu cắn SL
3. Lọc bỏ các tín hiệu bẫy (False Breakouts / Trap)
4. Tăng vọt Win Rate từ 30% lên trên 55% - 65% bằng cách CHỈ VÀO KHI XÁC SUẤT >= 60%!
"""
import csv
import json
import math
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, roc_auc_score

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "crypto"
MODEL_FILE = Path(__file__).resolve().parent / "models" / "freqai_rules.json"
MODEL_FILE.parent.mkdir(parents=True, exist_ok=True)

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

def extract_features_and_labels(candles: list[Candle]) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    n = len(candles)
    X, y = [], []
    meta = []

    # Tính EMA50 và EMA200
    ema50 = [0.0] * n
    ema200 = [0.0] * n
    k50, k200 = 2.0 / 51, 2.0 / 201
    for i, c in enumerate(candles):
        ema50[i] = c.c if i == 0 else c.c * k50 + ema50[i - 1] * (1 - k50)
        ema200[i] = c.c if i == 0 else c.c * k200 + ema200[i - 1] * (1 - k200)

    # Quét qua từng nến và gán nhãn
    for i in range(210, n - 25):
        c = candles[i]
        rng = c.h - c.l
        if rng <= 0:
            continue

        prev20 = candles[i - 20 : i]
        avg_vol = sum(x.v for x in prev20) / 20.0 if prev20 else 1.0
        vol_surge = c.v / avg_vol if avg_vol > 0 else 1.0

        box40 = candles[i - 40 : i]
        box_hi = max(b.h for b in box40)
        box_lo = min(b.l for b in box40)

        is_breakout_long = c.c > box_hi and c.c > c.o
        is_breakdown_short = c.c < box_lo and c.c < c.o

        # Chỉ trích xuất mẫu dữ liệu tại các điểm hình thành Setup (Candidate Trades)
        if not (is_breakout_long or is_breakdown_short):
            continue

        side = 1 if is_breakout_long else -1
        body_ratio = abs(c.c - c.o) / rng
        upper_wick = (c.h - max(c.c, c.o)) / rng
        lower_wick = (min(c.c, c.o) - c.l) / rng
        dist_ema50 = (c.c - ema50[i]) / ema50[i]
        dist_ema200 = (c.c - ema200[i]) / ema200[i]
        box_width_pct = (box_hi - box_lo) / box_lo

        # 10 Đặc trưng vi mô cho FreqAI
        feats = [
            body_ratio,
            upper_wick,
            lower_wick,
            vol_surge,
            dist_ema50,
            dist_ema200,
            box_width_pct,
            side,
            1.0 if (side == 1 and c.c > ema200[i]) or (side == -1 and c.c < ema200[i]) else 0.0,
            c.v / 1e5,
        ]

        # Kiểm định tương lai 24 nến để xác định nhãn (Label = 1: Thắng >= 1.5R, 0: Thua)
        entry = candles[i + 1].o
        sl = (max(box_lo, box_hi - 0.008 * box_hi)) if side == 1 else (min(box_hi, box_lo + 0.008 * box_lo))
        risk = abs(entry - sl)
        if risk / entry < 0.003 or risk / entry > 0.035:
            continue

        tp = entry + side * 1.5 * risk
        label = 0

        for k in range(i + 1, min(i + 25, n)):
            bar = candles[k]
            hit_sl = bar.l <= sl if side == 1 else bar.h >= sl
            hit_tp = bar.h >= tp if side == 1 else bar.l <= tp
            if hit_sl and hit_tp:
                label = 0
                break
            elif hit_sl:
                label = 0
                break
            elif hit_tp:
                label = 1
                break

        X.append(feats)
        y.append(label)
        meta.append({"idx": i, "t": c.t, "side": side, "entry": entry, "sl": sl, "tp": tp, "label": label})

    return np.array(X), np.array(y), meta

def train_freqai_model(coin: str, candles: list[Candle]):
    print(f"\n{'='*75}")
    print(f"🧠 HUẤN LUYỆN FREQAI MACHINE LEARNING CLASSIFIER CHO {coin}")
    print(f"{'='*75}")

    X, y, meta = extract_features_and_labels(candles)
    total_samples = len(y)
    print(f"[*] Trích xuất thành công {total_samples:,} mẫu setup nến có nhãn")
    if total_samples < 50:
        print("[!] Không đủ dữ liệu mẫu để huấn luyện.")
        return

    # Chia 70% Train, 30% Out-of-sample Test
    split_idx = int(total_samples * 0.7)
    X_train, y_train = X[:split_idx], y[:split_idx]
    X_test, y_test = X[split_idx:], y[split_idx:]
    meta_test = meta[split_idx:]

    print(f"    -> Tập Train: {len(y_train)} mẫu | Tỷ lệ thắng cơ bản: {np.mean(y_train)*100:.1f}%")
    print(f"    -> Tập Test bí mật: {len(y_test)} mẫu | Tỷ lệ thắng cơ bản: {np.mean(y_test)*100:.1f}%\n")

    # Huấn luyện mô hình Gradient Boosting (mô hình chuẩn giống LightGBM trong FreqAI)
    clf = HistGradientBoostingClassifier(
        max_iter=100,
        learning_rate=0.05,
        max_leaf_nodes=15,
        min_samples_leaf=10,
        random_state=42,
    )
    clf.fit(X_train, y_train)

    # Dự đoán xác suất trên tập Test Out-of-sample
    probs_test = clf.predict_proba(X_test)[:, 1] # Xác suất thắng (0.0 đến 1.0)

    # ĐỐI CHIẾU HIỆU SUẤT: TRƯỚC VÀ SAU KHI CÓ BỘ LỌC FREQAI
    print(f"{'-'*75}")
    print(f"📊 HIỆU QUẢ CỦA BỘ LỌC XÁC SUẤT FREQAI TRÊN DỮ LIỆU TƯƠNG LAI (TEST SET):")
    print(f"{'-'*75}")
    print(f"{'NGƯỠNG LỌC XÁC SUẤT':<25} | {'SỐ KÈO VÀO':<12} | {'TỶ LỆ THẮNG (WIN RATE)':<24} | {'ĐÁNH GIÁ'}")
    print(f"{'-'*75}")

    thresholds = [0.0, 0.45, 0.50, 0.55, 0.60, 0.65]
    for th in thresholds:
        accepted_idx = [i for i, p in enumerate(probs_test) if p >= th]
        n_acc = len(accepted_idx)
        if n_acc == 0:
            continue
        accepted_labels = [y_test[i] for i in accepted_idx]
        acc_wr = np.mean(accepted_labels) * 100
        desc = "Không lọc (Vào bừa bãi)" if th == 0.0 else f"Chỉ vào khi AI tự tin >= {int(th*100)}%"
        print(f"P(Win) >= {th:<4.2f} ({desc:<20}) | {n_acc:<12} | {acc_wr:>6.1f}%{'':<17} | {'⭐⭐ TỐI ƯU' if acc_wr >= 55 else 'Bình thường'}")

    print(f"{'-'*75}\n")

if __name__ == "__main__":
    btc_path = DATA_DIR / "BTCUSDT-PERP_15m.csv"
    if btc_path.exists():
        btc_candles = load_csv(btc_path)
        train_freqai_model("BTC", btc_candles)

