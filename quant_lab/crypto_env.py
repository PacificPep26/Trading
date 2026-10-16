"""
quant_lab/crypto_env.py
Môi trường giả lập Scalping Crypto Futures chuẩn Gymnasium (Reinforcement Learning).
Tích hợp trực tiếp 2 chế độ thị trường theo chuẩn Pro Trader:
1. Chế độ SIDEWAY (Biên độ nén hộp):
   - ĐÓN ĐÁY HỒI: Mua tại hỗ trợ đáy hộp khi có râu rút chân (Support Bounce).
   - ĐỈNH ĐÈ: Bán tại kháng cự đỉnh hộp khi có râu trên đạp xuống (Resistance Cap).
2. Chế độ TRENDING / BREAKOUT (Phá hộp xung lực):
   - Mua bùng nổ khi nến phá đỉnh kèm Volume lớn hoặc nhịp test cạn cung (No Supply Pullback).
3. Khớp lệnh Scalping 15m: SL dứt khoát 1.0%, TP ăn nhanh 2.0% (đòn bẩy x15 -> lãi +30%/nhịp).
"""
import random
import gymnasium as gym
from gymnasium import spaces
import numpy as np

def find_swings(candles, start_idx, end_idx):
    swing_highs = []
    swing_lows = []
    for i in range(start_idx + 2, end_idx - 2):
        h = candles[i]["h"]
        if (h > candles[i-1]["h"] and h > candles[i-2]["h"] and
            h > candles[i+1]["h"] and h > candles[i+2]["h"]):
            swing_highs.append((i, h))
        l = candles[i]["l"]
        if (l < candles[i-1]["l"] and l < candles[i-2]["l"] and
            l < candles[i+1]["l"] and l < candles[i+2]["l"]):
            swing_lows.append((i, l))
    return swing_highs, swing_lows

class CryptoFuturesEnv(gym.Env):
    metadata = {"render_modes": ["human"]}

    def __init__(
        self,
        candles,
        initial_balance=1000.0,
        leverage=15,          # Đòn bẩy x15 chuẩn của Victor
        fee_rate=0.0004,      # Phí Taker 0.04%
        sl_pct=0.010,         # Stop Loss nhanh 1.0% (mất 15% margin)
        tp_pct=0.020,         # Take Profit 2.0% (ăn 30% margin)
    ):
        super().__init__()
        self.candles = candles
        self.n = len(candles)
        self.initial_balance = initial_balance
        self.leverage = leverage
        self.fee_rate = fee_rate
        self.sl_pct = sl_pct
        self.tp_pct = tp_pct

        # Actions: 0 = HOLD, 1 = BUY/LONG, 2 = SELL/SHORT, 3 = CLOSE
        self.action_space = spaces.Discrete(4)

        # Observation space:
        # 10 nến x 10 đặc trưng hình học nến & VPA = 100
        # + 5 đặc trưng Regime Sideway / Breakout hiện tại
        # + 3 đặc trưng trạng thái lệnh = 108 chiều
        self.feature_dim = 10 * 10 + 5 + 3
        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(self.feature_dim,), dtype=np.float32
        )

        self.reset()

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.current_step = 30
        self.balance = self.initial_balance
        self.position = 0       # 0: Flat, 1: Long, -1: Short
        self.entry_price = 0.0
        self.entry_step = 0
        self.trades = []

        return self._get_observation(), {}

    def _get_observation(self):
        obs = []
        window = self.candles[self.current_step - 10 : self.current_step]
        prev_20 = self.candles[self.current_step - 20 : self.current_step]
        avg_vol20 = float(np.mean([c["v"] for c in prev_20])) if prev_20 else 1.0

        highs20 = [c["h"] for c in prev_20]
        lows20 = [c["l"] for c in prev_20]
        max_h20 = max(highs20) if highs20 else 1.0
        min_l20 = min(lows20) if lows20 else 1.0

        for c in window:
            rng = max(c["h"] - c["l"], 1e-8)
            ret = (c["c"] - c["o"]) / c["o"]
            body_ratio = (c["c"] - c["o"]) / rng
            upper_wick = (c["h"] - max(c["o"], c["c"])) / rng
            lower_wick = (min(c["o"], c["c"]) - c["l"]) / rng
            vol_ratio = (c["v"] / avg_vol20) if avg_vol20 > 0 else 1.0
            range_pct = rng / c["c"]
            dist_h = (max_h20 - c["c"]) / c["c"]
            dist_l = (c["c"] - min_l20) / c["c"]

            is_impulse = 1.0 if (abs(body_ratio) >= 0.55 and vol_ratio >= 1.6) else 0.0
            effort_result = float(body_ratio * min(vol_ratio, 3.5))

            obs.extend([
                ret, body_ratio, upper_wick, lower_wick,
                vol_ratio, range_pct, dist_h, dist_l,
                is_impulse, effort_result
            ])

        # Đánh giá Regime hiện tại (Sideway Đón Đáy / Đỉnh Đè vs Breakout)
        cur_c = self.candles[self.current_step - 1]
        rng_20 = (max_h20 - min_l20) / max_h20
        is_sideway = 1.0 if rng_20 <= 0.035 else 0.0 # Hộp nén <= 3.5%

        dist_to_h = (max_h20 - cur_c["c"]) / cur_c["c"]
        dist_to_l = (cur_c["c"] - min_l20) / cur_c["c"]
        cur_rng = max(cur_c["h"] - cur_c["l"], 1e-8)
        cur_lower_wick = (min(cur_c["o"], cur_c["c"]) - cur_c["l"]) / cur_rng
        cur_upper_wick = (cur_c["h"] - max(cur_c["o"], cur_c["c"])) / cur_rng

        # Đón đáy hồi: sát đáy hộp + có râu dưới rút chân
        at_support_bounce = 1.0 if (dist_to_l <= 0.006 and cur_lower_wick >= 0.35) else 0.0
        # Đỉnh đè: sát đỉnh hộp + có râu trên đè xuống
        at_resistance_cap = 1.0 if (dist_to_h <= 0.006 and cur_upper_wick >= 0.35) else 0.0

        # Breakout phá hộp
        vol_ratio_now = cur_c["v"] / avg_vol20 if avg_vol20 > 0 else 1.0
        is_breakout = 1.0 if (cur_c["c"] > max_h20 and vol_ratio_now >= 1.6) else 0.0

        obs.extend([
            float(is_sideway), float(dist_to_h), float(dist_to_l),
            float(at_support_bounce), float(at_resistance_cap)
        ])

        # Trạng thái vị thế
        pnl_pct = (
            ((cur_c["c"] - self.entry_price) / self.entry_price * self.position)
            if self.position != 0
            else 0.0
        )
        bars_held = (self.current_step - self.entry_step) / 20.0 if self.position != 0 else 0.0

        obs.extend([float(self.position), float(pnl_pct), float(bars_held)])
        return np.array(obs, dtype=np.float32)

    def step(self, action):
        c = self.candles[self.current_step]
        price = c["c"]
        reward = 0.0
        terminated = False
        truncated = False

        # Phân tích điều kiện thị trường
        prev_20 = self.candles[self.current_step - 20 : self.current_step]
        max_h20 = max([x["h"] for x in prev_20])
        min_l20 = min([x["l"] for x in prev_20])
        dist_to_h = (max_h20 - price) / price
        dist_to_l = (price - min_l20) / price

        rng_20 = (max_h20 - min_l20) / max_h20
        is_sideway = (rng_20 <= 0.035)

        cur_rng = max(c["h"] - c["l"], 1e-8)
        lower_wick = (min(c["o"], c["c"]) - c["l"]) / cur_rng
        upper_wick = (c["h"] - max(c["o"], c["c"])) / cur_rng

        at_support_bounce = (dist_to_l <= 0.006 and lower_wick >= 0.30)
        at_resistance_cap = (dist_to_h <= 0.006 and upper_wick >= 0.30)
        is_middle_chop = (dist_to_h > 0.008 and dist_to_l > 0.008)

        # 1. Xử lý hành động
        if action == 0:  # HOLD / ĐỨNG NGOÀI
            if self.position == 0:
                if is_middle_chop:
                    reward += 0.003  # Thưởng kiên nhẫn không vào lệnh ở giữa hộp
            else:
                # Đang giữ lệnh có lãi -> Khuyến khích giữ đến TP
                cur_pnl = (
                    (price - self.entry_price) / self.entry_price
                    if self.position == 1
                    else (self.entry_price - price) / self.entry_price
                ) * self.leverage
                if cur_pnl > 0.08:
                    reward += 0.006

        elif action == 1:  # MỞ VỊ THẾ LONG
            if self.position == 0:
                self.position = 1
                self.entry_price = price
                self.entry_step = self.current_step
                reward -= self.fee_rate
                # THƯỞNG LỚN: Bắt đúng nhịp ĐÓN ĐÁY HỒI ở hỗ trợ
                if at_support_bounce:
                    reward += 0.15
                elif is_sideway and is_middle_chop:
                    reward -= 0.10  # Phạt mua ở lưng chừng hộp
            elif self.position == -1:  # Đảo vị thế
                pnl = (self.entry_price - price) / self.entry_price * self.leverage
                reward += (pnl * 1.2) - (2 * self.fee_rate)
                self.balance += self.balance * pnl
                self.position = 1
                self.entry_price = price
                self.entry_step = self.current_step

        elif action == 2:  # MỞ VỊ THẾ SHORT
            if self.position == 0:
                self.position = -1
                self.entry_price = price
                self.entry_step = self.current_step
                reward -= self.fee_rate
                # THƯỞNG LỚN: Bắt đúng nhịp ĐỈNH ĐÈ ở kháng cự
                if at_resistance_cap:
                    reward += 0.15
                elif is_sideway and is_middle_chop:
                    reward -= 0.10
            elif self.position == 1:
                pnl = (price - self.entry_price) / self.entry_price * self.leverage
                reward += (pnl * 1.2) - (2 * self.fee_rate)
                self.balance += self.balance * pnl
                self.position = -1
                self.entry_price = price
                self.entry_step = self.current_step

        elif action == 3:  # CHỦ ĐỘNG ĐÓNG LỆNH
            if self.position != 0:
                pnl = (
                    (price - self.entry_price) / self.entry_price
                    if self.position == 1
                    else (self.entry_price - price) / self.entry_price
                ) * self.leverage
                reward += (pnl * 1.5) - self.fee_rate
                self.balance += self.balance * pnl
                self.trades.append({"pnl": pnl, "step": self.current_step, "reason": "MANUAL"})
                self.position = 0
                self.entry_price = 0.0

        # 2. Quét Stop-Loss và Take-Profit Scalping theo Low/High nến 15m
        if self.position != 0:
            if self.position == 1:  # LONG
                if c["l"] <= self.entry_price * (1.0 - self.sl_pct):
                    loss_pnl = -self.sl_pct * self.leverage
                    reward -= 0.30
                    self.balance += self.balance * loss_pnl
                    self.trades.append({"pnl": loss_pnl, "step": self.current_step, "reason": "SL"})
                    self.position = 0
                    self.entry_price = 0.0
                elif c["h"] >= self.entry_price * (1.0 + self.tp_pct):
                    win_pnl = self.tp_pct * self.leverage
                    reward += 0.60
                    self.balance += self.balance * win_pnl
                    self.trades.append({"pnl": win_pnl, "step": self.current_step, "reason": "TP"})
                    self.position = 0
                    self.entry_price = 0.0

            elif self.position == -1:  # SHORT
                if c["h"] >= self.entry_price * (1.0 + self.sl_pct):
                    loss_pnl = -self.sl_pct * self.leverage
                    reward -= 0.30
                    self.balance += self.balance * loss_pnl
                    self.trades.append({"pnl": loss_pnl, "step": self.current_step, "reason": "SL"})
                    self.position = 0
                    self.entry_price = 0.0
                elif c["l"] <= self.entry_price * (1.0 - self.tp_pct):
                    win_pnl = self.tp_pct * self.leverage
                    reward += 0.60
                    self.balance += self.balance * win_pnl
                    self.trades.append({"pnl": win_pnl, "step": self.current_step, "reason": "TP"})
                    self.position = 0
                    self.entry_price = 0.0

        self.current_step += 1
        if self.current_step >= self.n - 1 or self.balance <= 200.0:
            terminated = True

        return self._get_observation(), reward, terminated, truncated, {}

class MultiAssetCryptoEnv(gym.Env):
    metadata = {"render_modes": ["human"]}

    def __init__(self, dataset: dict, initial_balance=1000.0, leverage=15):
        super().__init__()
        self.dataset = dataset
        self.coins = list(dataset.keys())
        self.initial_balance = initial_balance
        self.leverage = leverage

        first_coin = self.coins[0]
        self.active_env = CryptoFuturesEnv(self.dataset[first_coin], initial_balance, leverage)
        self.action_space = self.active_env.action_space
        self.observation_space = self.active_env.observation_space

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        chosen_coin = random.choice(self.coins)
        candles = self.dataset[chosen_coin]
        self.active_env = CryptoFuturesEnv(candles, self.initial_balance, self.leverage)
        return self.active_env.reset(seed=seed, options=options)

    def step(self, action):
        return self.active_env.step(action)
