"""
quant_lab/train_ppo.py
Huấn luyện AI Agent giao dịch bằng thuật toán PPO (Proximal Policy Optimization)
Tận dụng sức mạnh card đồ họa GPU NVIDIA RTX 3060.
"""
import os
import json
import torch
from crypto_env import CryptoFuturesEnv
from stable_baselines3 import PPO
from stable_baselines3.common.evaluation import evaluate_policy

DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "BTC_1H.json")
MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
os.makedirs(MODEL_DIR, exist_ok=True)

def main():
    print("=" * 60)
    print("🚀 KHỞI ĐỘNG PHÒNG THÍ NGHIỆM AI TRADING ĐỊNH LƯỢNG (QUANT LAB)")
    print("=" * 60)

    # 1. Kiểm tra GPU
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[*] Thiết bị tính toán (Device): {device.upper()}")
    if device == "cuda":
        print(f"    -> GPU: {torch.cuda.get_device_name(0)}")
        print(f"    -> VRAM khả dụng: {torch.cuda.get_device_properties(0).total_memory / (1024**3):.2f} GB")

    # 2. Tải dữ liệu nến
    if not os.path.exists(DATA_PATH):
        print(f"[!] Không tìm thấy {DATA_PATH}. Đang tải dữ liệu mẫu...")
        from fetch_data import main as fetch_main
        fetch_main()

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        all_candles = json.load(f)

    n_total = len(all_candles)
    split_idx = int(n_total * 0.8) # 80% Train, 20% Test
    train_candles = all_candles[:split_idx]
    test_candles = all_candles[split_idx:]

    print(f"[*] Tổng số nến: {n_total} nến")
    print(f"    -> Tập Train (Huấn luyện): {len(train_candles)} nến")
    print(f"    -> Tập Test (Kiểm tra bí mật): {len(test_candles)} nến")

    # 3. Khởi tạo môi trường
    env_train = CryptoFuturesEnv(train_candles, initial_balance=1000.0, leverage=10)
    env_test = CryptoFuturesEnv(test_candles, initial_balance=1000.0, leverage=10)

    # 4. Cấu hình Mạng Nơ-ron PPO
    print("\n[*] Đang khởi tạo mô hình PPO Neural Network...")
    policy_kwargs = dict(net_arch=dict(pi=[128, 128], vf=[128, 128])) # 2 tầng nơ-ron sâu 128 nodes
    model = PPO(
        "MlpPolicy",
        env_train,
        learning_rate=3e-4,
        n_steps=2048,
        batch_size=64,
        n_epochs=10,
        gamma=0.99,
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=0.01, # Khuyến khích khám phá chiến thuật mới
        policy_kwargs=policy_kwargs,
        device=device,
        verbose=1,
    )

    # 5. Huấn luyện Agent trên GPU
    TOTAL_TIMESTEPS = 100_000
    print(f"\n[🔥] Bắt đầu huấn luyện {TOTAL_TIMESTEPS:,} bước trên GPU...")
    model.learn(total_timesteps=TOTAL_TIMESTEPS)

    # 6. Lưu mô hình đã học
    save_path = os.path.join(MODEL_DIR, "ppo_crypto_agent")
    model.save(save_path)
    print(f"\n[✅] Đã lưu mô hình AI vào {save_path}.zip")

    # 7. Đánh giá kiểm thử trên tập dữ liệu chưa từng thấy (Out-of-sample Test)
    print("\n[*] Đang kiểm thử trên tập dữ liệu kiểm tra bí mật (Test Set)...")
    mean_reward, std_reward = evaluate_policy(model, env_test, n_eval_episodes=5)
    print(f"    -> Điểm thưởng trung bình (Mean Reward): {mean_reward:.2f} +/- {std_reward:.2f}")

if __name__ == "__main__":
    main()

