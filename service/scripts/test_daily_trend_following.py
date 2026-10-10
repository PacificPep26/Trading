"""
Backtest ý tưởng Trend Following khung Ngày (Daily Donchian / Moving Average Breakout)
trên toàn bộ 39 coin từ 2023 đến 2026 với phí Taker thực tế MEXC (0.16% khứ hồi) + Trượt giá.

Quy tắc kinh điển (Turtle Trading / Donchian Breakout):
- Khung: 1 Ngày (24h)
- Vào lệnh:
  + LONG khi giá nến Ngày đóng cửa vượt đỉnh cao nhất của N ngày trước (ví dụ N=20 ngày).
  + Stoploss ban đầu: Đặt cách Entry 2 * ATR(20) ngày.
- Thoát lệnh:
  + Dính Stoploss ban đầu: Cắt lỗ.
  + Thoát khi giá đóng cửa thủng đáy thấp nhất của M ngày (ví dụ M=10 ngày) để ăn trọn sóng lớn (Trailing exit).
- Phí: Taker 0.16% khứ hồi + Trượt giá 0.04% + Funding rate.
"""

import math
from pathlib import Path
from collections import defaultdict
from service.backtest.data import DATA_DIR, load, Candle
from service.scripts.styles_study import resample

FEE_TAKER = 0.0016
SLIPPAGE = 0.0004
FUNDING_DAILY = 0.0003 # 0.01% mỗi 8h = 0.03% mỗi ngày

def run_daily_trend_study(lookback_entry=20, lookback_exit=10, atr_mult=2.0):
    trades = []
    
    for f in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        sym = f.name.split("-PERP")[0]
        c1 = load(f.name.split("_")[0], "1h", include_holdout=True)
        cd = resample(c1, 24) # Resample sang nến 1 Ngày
        n = len(cd)
        if n < lookback_entry + 50:
            continue
            
        # Tính ATR(20) ngày
        atr = [0.0] * n
        for i in range(1, n):
            tr = max(cd[i].h - cd[i].l, abs(cd[i].h - cd[i-1].c), abs(cd[i].l - cd[i-1].c))
            atr[i] = (atr[i-1] * 19 + tr) / 20 if i >= 20 else tr

        in_pos = False
        entry_price = 0.0
        stop_price = 0.0
        entry_i = 0
        risk_fraction = 0.0

        for i in range(lookback_entry, n - 1):
            c = cd[i]
            
            if not in_pos:
                # Tìm đỉnh cao nhất của lookback_entry ngày trước
                past_high = max(cd[k].h for k in range(i - lookback_entry, i))
                
                # Điều kiện Long: Nến ngày hôm nay đóng cửa vượt đỉnh 20 ngày
                if c.c > past_high:
                    entry_i = i + 1
                    entry_price = cd[entry_i].o
                    current_atr = atr[i]
                    stop_price = entry_price - atr_mult * current_atr
                    risk_dist = entry_price - stop_price
                    if risk_dist <= 0:
                        continue
                    risk_fraction = risk_dist / entry_price
                    in_pos = True
            else:
                # Đang giữ vị thế Long
                # 1. Kiểm tra dính SL ban đầu
                if c.l <= stop_price:
                    exit_price = min(c.o, stop_price)
                    gross = exit_price / entry_price - 1.0
                    hold_days = i - entry_i + 1
                    trades.append({
                        "sym": sym,
                        "entry": entry_price,
                        "exit": exit_price,
                        "gross": gross,
                        "risk": risk_fraction,
                        "hold_days": hold_days,
                        "year": cd[entry_i].t // 31_557_600_000 + 1970,
                        "type": "sl"
                    })
                    in_pos = False
                    continue
                    
                # 2. Kiểm tra trailing exit: thủng đáy 10 ngày gần nhất
                past_low = min(cd[k].l for k in range(max(0, i - lookback_exit), i))
                if c.c < past_low:
                    exit_price = cd[i + 1].o if i + 1 < n else c.c
                    gross = exit_price / entry_price - 1.0
                    hold_days = (i + 1) - entry_i
                    trades.append({
                        "sym": sym,
                        "entry": entry_price,
                        "exit": exit_price,
                        "gross": gross,
                        "risk": risk_fraction,
                        "hold_days": hold_days,
                        "year": cd[entry_i].t // 31_557_600_000 + 1970,
                        "type": "trend_exit"
                    })
                    in_pos = False

    return trades

def evaluate(trades):
    if not trades:
        print("Không có lệnh nào!")
        return
        
    rs = []
    for t in trades:
        cost = FEE_TAKER + SLIPPAGE + FUNDING_DAILY * t["hold_days"]
        r = (t["gross"] - cost) / t["risk"]
        rs.append(r)
        
    n = len(rs)
    win_cnt = sum(x > 0 for x in rs)
    mean_r = sum(rs) / n
    sd = math.sqrt(sum((x - mean_r) ** 2 for x in rs) / (n - 1)) if n > 1 else 0
    t_stat = mean_r / (sd / math.sqrt(n)) if sd > 0 else 0
    
    print(f"\n=======================================================")
    print(f"📊 KẾT QUẢ TREND FOLLOWING KHUNG NGÀY (DONCHIAN 20/10)")
    print(f"=======================================================")
    print(f"• Tổng số lệnh: {n} lệnh (trên 39 coin trong ~4 năm)")
    print(f"• Tỷ lệ thắng: {win_cnt/n*100:.1f}%")
    print(f"• Kỳ vọng ròng (ExpR sau phí thật): {mean_r:+.3f}R / lệnh")
    print(f"• Độ tin cậy t-statistic: {t_stat:+.2f}")
    
    # Phân bổ theo năm
    years = sorted(list({t["year"] for t in trades}))
    print(f"\n--- Kết quả từng năm ---")
    for y in years:
        y_rs = [(t["gross"] - (FEE_TAKER + SLIPPAGE + FUNDING_DAILY * t["hold_days"])) / t["risk"] for t in trades if t["year"] == y]
        if y_rs:
            y_win = sum(x > 0 for x in y_rs) / len(y_rs)
            y_mean = sum(y_rs) / len(y_rs)
            print(f"  Năm {y}: {len(y_rs):4d} lệnh | Thắng {y_win*100:.1f}% | TB {y_mean:+.3f}R")

    # Giả lập tài khoản $52 (Risk $2.5/lệnh)
    eq = 52.0
    peak = eq
    max_dd = 0.0
    for r in rs:
        eq += 2.5 * r
        peak = max(peak, eq)
        max_dd = max(max_dd, 1.0 - eq / peak)
    print(f"\n--- Giả lập tài khoản $52 USDT ---")
    print(f"• Vốn cuối: ${eq:.2f} ({((eq-52)/52)*100:+.1f}%)")
    print(f"• Max Drawdown: {max_dd*100:.1f}%")

if __name__ == "__main__":
    t = run_daily_trend_study()
    evaluate(t)

