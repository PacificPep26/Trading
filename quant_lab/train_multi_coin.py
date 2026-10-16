"""
quant_lab/train_multi_coin.py
Huấn luyện AI Scalper trên giỏ Altcoin sạch khung 15m (Multi-Asset Scalping RL).
Tích hợp chiến thuật Pro Trader:
- Đón đáy hồi (Support Bounce) & Đỉnh đè (Resistance Cap) khi Sideway.
- Bắt nổ vol phá đỉnh (Breakout Momentum) khi Trending.
Sử dụng PPO tăng tốc bằng GPU NVIDIA GeForce RTX 3060.
"""
import os
import json
import torch
import numpy as np
from crypto_env import CryptoFuturesEnv, MultiAssetCryptoEnv
from stable_baselines3 import PPO
from stable_baselines3.common.evaluation import evaluate_policy

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
os.makedirs(MODEL_DIR, exist_ok=True)

APPROVED_COINS = [
    "TIA", "SUI", "SOL", "NEAR", "APT", "ARB",
    "INJ", "OP", "AVAX", "LINK", "DOT", "LTC", "BTC"
]

def load_clean_datasets(bar="15m", split_ratio=0.8):
    train_dataset = {}
    test_dataset = {}

    for coin in APPROVED_COINS:
        fpath = os.path.join(DATA_DIR, f"{coin}_{bar}.json")
        if not os.path.exists(fpath):
            continue
        with open(fpath, "r", encoding="utf-8") as f:
            candles = json.load(f)

        if len(candles) < 200:
            continue

        split_idx = int(len(candles) * split_ratio)
        train_dataset[coin] = candles[:split_idx]
        test_dataset[coin] = candles[split_idx:]

    return train_dataset, test_dataset

def main():
    print("=" * 70)
    print("[*] QUANT AI SCALPER LAB (15m - SIDEWAY BOUNCE & BREAKOUT)")
    print("=" * 70)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[*] Compute Device: {device.upper()}")
    if device == "cuda":
        print(f"    -> GPU: {torch.cuda.get_device_name(0)}")
        print(f"    -> VRAM Free: {torch.cuda.mem_get_info()[0] / (1024**2):.1f} MB / Total: {torch.cuda.mem_get_info()[1] / (1024**2):.1f} MB")

    # Tải dữ liệu 15m toàn bộ giỏ
    train_data, test_data = load_clean_datasets("15m", split_ratio=0.8)
    print(f"\n[*] Loaded 15m dataset for {len(train_data)} clean Altcoins:")
    for coin in train_data:
        print(f"    - {coin:<5}: Train={len(train_data[coin])} bars | Test={len(test_data[coin])} bars")

    train_env = MultiAssetCryptoEnv(train_data, initial_balance=1000.0, leverage=15)

    policy_kwargs = dict(
        net_arch=dict(pi=[128, 128], vf=[128, 128])
    )

    print("\n[*] Initializing 15m Scalping PPO Agent...")
    model = PPO(
        "MlpPolicy",
        train_env,
        learning_rate=3e-4,
        n_steps=2048,
        batch_size=64,
        n_epochs=10,
        gamma=0.98,             # Discount factor ngắn hơn phù hợp với Scalping
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=0.012,
        policy_kwargs=policy_kwargs,
        device=device,
        verbose=1,
    )

    TIMESTEPS = 120_000
    print(f"\n[*] Training Scalper Agent for {TIMESTEPS:,} timesteps on RTX 3060...")
    model.learn(total_timesteps=TIMESTEPS)

    save_path = os.path.join(MODEL_DIR, "ppo_scalper_15m_v2")
    model.save(save_path)
    print(f"\n[OK] Scalper Model saved to: {save_path}.zip")

    # Đánh giá độc lập trên tập Out-of-Sample 15m
    print("\n" + "=" * 70)
    print("[*] 15m SCALPER OUT-OF-SAMPLE EVALUATION (Unseen 15m Market Data)")
    print("=" * 70)

    for coin in ["TIA", "SUI", "APT", "INJ", "ARB"]:
        if coin not in test_data:
            continue
        eval_env = CryptoFuturesEnv(test_data[coin], initial_balance=1000.0, leverage=15)
        
        obs, _ = eval_env.reset()
        done = False
        while not done:
            action, _ = model.predict(obs, deterministic=True)
            obs, _, terminated, truncated, _ = eval_env.step(action)
            done = terminated or truncated

        trades = eval_env.trades
        win_trades = [t for t in trades if t["pnl"] > 0]
        win_rate = (len(win_trades) / len(trades) * 100) if trades else 0.0
        final_bal = eval_env.balance

        print(f"[*] Coin: {coin:<5} | 15m Trades: {len(trades):<3} | Win Rate: {win_rate:5.1f}% | Balance: ${final_bal:7.2f}")

    print("\n[+] Scalper training & evaluation finished.")

if __name__ == "__main__":
    main()
