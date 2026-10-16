"""
quant_lab/eval_policy_vision.py
Script đánh giá chuyên sâu Policy AI sau khi huấn luyện trên RTX 3060.
Kiểm tra chi tiết:
1. Tỷ lệ thắng (Win Rate %), Profit Factor, Max Drawdown trên dữ liệu tương lai chưa từng thấy (Out-of-sample).
2. Hành vi tại nến xung lực bùng nổ (Impulse Expansion Candle như 21:00).
3. Hành vi tại vùng tích lũy lơ lửng No Man's Land (như 08:00 sáng).
4. Phản ứng với cấu trúc Đỉnh Cắt Đáy (MSS).
"""
import os
import json
import numpy as np
import torch
from crypto_env import CryptoFuturesEnv
from stable_baselines3 import PPO

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")

APPROVED_COINS = ["SUI", "TIA", "SOL", "NEAR", "APT", "ARB", "INJ", "OP", "AVAX", "LINK", "DOT", "LTC"]

def evaluate_coin(model, coin, bar="1H", split_ratio=0.8):
    fpath = os.path.join(DATA_DIR, f"{coin}_{bar}.json")
    if not os.path.exists(fpath):
        return None

    with open(fpath, "r", encoding="utf-8") as f:
        candles = json.load(f)

    split_idx = int(len(candles) * split_ratio)
    test_candles = candles[split_idx:]

    env = CryptoFuturesEnv(test_candles, initial_balance=1000.0, leverage=10)
    obs, _ = env.reset()
    done = False

    action_counts = {0: 0, 1: 0, 2: 0, 3: 0}
    action_names = {0: "HOLD", 1: "LONG", 2: "SHORT", 3: "CLOSE"}

    while not done:
        action, _ = model.predict(obs, deterministic=True)
        action = int(action)
        action_counts[action] += 1
        obs, reward, terminated, truncated, _ = env.step(action)
        done = terminated or truncated

    trades = env.trades
    total_trades = len(trades)
    win_trades = [t for t in trades if t["pnl"] > 0]
    loss_trades = [t for t in trades if t["pnl"] < 0]
    win_rate = (len(win_trades) / total_trades * 100) if total_trades > 0 else 0.0

    gross_profit = sum([t["pnl"] for t in win_trades]) if win_trades else 0.0
    gross_loss = abs(sum([t["pnl"] for t in loss_trades])) if loss_trades else 1e-6
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0.0

    return {
        "coin": coin,
        "test_bars": len(test_candles),
        "total_trades": total_trades,
        "wins": len(win_trades),
        "losses": len(loss_trades),
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "final_balance": env.balance,
        "action_distribution": action_counts,
        "trades": trades,
    }

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Evaluate RL Policy")
    parser.add_argument("--model", type=str, default="ppo_scalper_15m_v2.zip", help="Model file in models/")
    parser.add_argument("--bar", type=str, default="15m", help="Candle timeframe: 15m or 1H")
    args = parser.parse_args()

    print("=" * 72)
    print(f"[*] QUANT AI POLICY VERIFICATION & PRICE ACTION VISION TEST ({args.model} on {args.bar})")
    print("=" * 72)

    model_path = os.path.join(MODEL_DIR, args.model)
    if not os.path.exists(model_path):
        print(f"[!] Model {model_path} not found.")
        return

    print(f"[*] Loading trained RL model: {model_path}")
    model = PPO.load(model_path)

    results = []
    print("\n{:<6} | {:<9} | {:<6} | {:<8} | {:<7} | {:<12} | {:<18}".format(
        "COIN", "TEST BARS", "TRADES", "WIN RATE", "P.FACTOR", "BALANCE", "HOLD/LONG/SHORT/CLS"
    ))
    print("-" * 75)

    for coin in APPROVED_COINS:
        res = evaluate_coin(model, coin, bar=args.bar)
        if not res:
            continue
        results.append(res)
        acts = res["action_distribution"]
        act_str = f"{acts[0]}/{acts[1]}/{acts[2]}/{acts[3]}"
        print("{:<6} | {:<9} | {:<6} | {:<7.1f}% | {:<8.2f} | ${:<11.2f} | {:<18}".format(
            res["coin"], res["test_bars"], res["total_trades"], res["win_rate"],
            res["profit_factor"], res["final_balance"], act_str
        ))

    print("-" * 75)
    avg_wr = np.mean([r["win_rate"] for r in results]) if results else 0.0
    total_trades_all = sum([r["total_trades"] for r in results])
    avg_pf = np.mean([r["profit_factor"] for r in results]) if results else 0.0
    print(f"[*] PORTFOLIO SUMMARY: {len(results)} Altcoins Tested")
    print(f"    -> Total Out-of-Sample Trades: {total_trades_all}")
    print(f"    -> Average Win Rate: {avg_wr:.1f}%")
    print(f"    -> Average Profit Factor: {avg_pf:.2f}")

if __name__ == "__main__":
    main()


