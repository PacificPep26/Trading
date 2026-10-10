"""
Nghiên cứu & Backtest thực nghiệm mô phỏng chính xác 100% logic Live của bot:
1. Phí Taker MEXC 0.08% / chiều (0.16% khứ hồi) + Trượt giá 0.04% + Funding 0.01%/8h.
2. Cơ chế thoát lệnh Live 2 bước:
   - TP1 ở 1.0R: Chốt 50% khối lượng, đồng thời DỜI SL VỀ HÒA VỐN (Breakeven).
   - TP2 ở 2.0R: Chốt 50% khối lượng còn lại.
   - Nếu chạm SL trước khi chạm TP1: Thua -1.0R.
   - Nếu chạm TP1 xong quay đầu cắn SL hòa vốn: Ăn trọn 50% TP1 (+0.50R), nửa sau hòa vốn (0R) -> Tổng lời: +0.50R (trừ phí).
   - Nếu cắn trọn cả TP1 và TP2: Ăn 50% ở 1.0R (+0.50R) + 50% ở 2.0R (+1.00R) -> Tổng lời: +1.50R.
3. Bộ lọc bão vĩ mô BTC Ngày: Tuyệt đối không Short khi BTC Ngày Uptrend, không Long khi BTC Downtrend.
4. Tài khoản thực tế $52 với rủi ro $2.5 / lệnh (Tầng Khởi Động).
"""

import bisect
import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from service.backtest.data import DATA_DIR, load, Candle
from service.backtest.patterns import STYLES, build
from service.scripts.styles_study import resample

VN = timezone(timedelta(hours=7))

# Phí sàn MEXC thực tế hiện hành (từ 01/06/2026): Taker 0.08%/chiều -> 0.16% khứ hồi
FEE_TAKER_MEXC = 0.0016
# Phí Maker Limit nếu vào bằng limit: Maker 0.02%/chiều -> 0.04% khứ hồi
FEE_MAKER_MEXC = 0.0004
# Trượt giá thực tế khứ hồi
SLIPPAGE = 0.0004
# Funding rate trung bình
FUNDING_8H = 0.0001


def daily_trend(c1):
    d = resample(c1, 24)
    ema, ts, st = d[0].c, [], []
    for c in d:
        ema += 2 / 51 * (c.c - ema)
        ts.append(c.t + 86_400_000)
        st.append(1 if c.c > ema else -1)
    return ts, st


def trend_at(tr, t):
    i = bisect.bisect_right(tr[0], t) - 1
    return tr[1][i] if i >= 50 else 0


def simulate_live_exit(cs, fill_i, side, entry, stop, tp1, tp2, hold_bars):
    """
    Mô phỏng chính xác logic 2 bước:
    - TP1 ở 1.0R: chốt 50%, dời SL về entry
    - TP2 ở 2.0R: chốt 50% còn lại
    - Trả về: (gross_return_fraction, risk_fraction, exit_bars, exit_type)
    """
    n = len(cs)
    risk_dist = abs(entry - stop)
    risk_fraction = risk_dist / entry
    
    last = min(fill_i + hold_bars - 1, n - 1)
    hit_tp1 = False
    current_stop = stop
    
    pnl_tp1 = 0.0
    pnl_tp2 = 0.0
    exit_type = "time"
    exit_i = last

    for k in range(fill_i, last + 1):
        c = cs[k]
        
        # 1. Kiểm tra dính Stop Loss (SL)
        hit_sl = (c.l <= current_stop) if side > 0 else (c.h >= current_stop)
        if hit_sl:
            if not hit_tp1:
                # Chạm SL ban đầu: thua toàn bộ vị thế (-1.0R)
                sl_fill = c.o if ((c.o < current_stop) if side > 0 else (c.o > current_stop)) else current_stop
                gross = side * (sl_fill / entry - 1)
                return gross, risk_fraction, (k - fill_i), "sl_initial"
            else:
                # Đã khớp TP1 và dời SL về hòa vốn: nửa sau thoát ở giá hòa vốn (entry)
                sl_fill = c.o if ((c.o < current_stop) if side > 0 else (c.o > current_stop)) else current_stop
                pnl_tp2 = 0.5 * side * (sl_fill / entry - 1)
                total_gross = pnl_tp1 + pnl_tp2
                return total_gross, risk_fraction, (k - fill_i), "tp1_then_be"

        # 2. Kiểm tra Take Profit
        if not hit_tp1:
            hit_tp1_now = (c.h >= tp1) if side > 0 else (c.l <= tp1)
            if hit_tp1_now:
                hit_tp1 = True
                # Chốt 50% ở TP1
                pnl_tp1 = 0.5 * side * (tp1 / entry - 1)
                # Dời SL về entry (hòa vốn)
                current_stop = entry

        # Nếu đã hit TP1, kiểm tra tiếp TP2
        if hit_tp1:
            hit_tp2_now = (c.h >= tp2) if side > 0 else (c.l <= tp2)
            if hit_tp2_now:
                # Chốt 50% còn lại ở TP2
                pnl_tp2 = 0.5 * side * (tp2 / entry - 1)
                total_gross = pnl_tp1 + pnl_tp2
                return total_gross, risk_fraction, (k - fill_i), "full_tp"

    # Hết thời gian giữ tối đa (Time exit)
    c_last = cs[last]
    if hit_tp1:
        pnl_tp2 = 0.5 * side * (c_last.c / entry - 1)
        total_gross = pnl_tp1 + pnl_tp2
        return total_gross, risk_fraction, (last - fill_i), "tp1_then_time"
    else:
        total_gross = side * (c_last.c / entry - 1)
        return total_gross, risk_fraction, (last - fill_i), "time_exit"


def run_full_simulation():
    btc_cs = load("BTCUSDT-PERP", "1h", include_holdout=True)
    btc_trend = daily_trend(btc_cs)
    
    trades = []
    
    for f in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        sym = f.name.split("-PERP")[0]
        c1 = load(f.name.split("_")[0], "1h", include_holdout=True)
        own_trend = daily_trend(c1)
        cs4 = resample(c1, 4)
        x = build(cs4)
        n = len(cs4)
        hold_bars = 12 # 48 tiếng
        busy_until = 0

        for i in range(260, n - 2):
            if i <= busy_until:
                continue
            
            t = cs4[i].t + 4 * 3_600_000
            btc_d = trend_at(btc_trend, t)
            own_d = trend_at(own_trend, t)

            for key in ("bos", "double_top_bottom"):
                sig = STYLES[key][1](x, i)
                if not sig:
                    continue
                
                side = sig["side"]
                
                # BỘ LỌC BẢO VỆ VĨ MÔ
                # 1. Không bao giờ Short khi BTC Ngày là Uptrend (+1)
                if side < 0 and btc_d > 0:
                    continue
                # 2. Không bao giờ Long khi BTC Ngày là Downtrend (-1)
                if side > 0 and btc_d < 0:
                    continue
                # 3. BOS chỉ đánh thuận xu hướng ngày của chính coin đó
                if key == "bos":
                    if side > 0 and own_d < 0:
                        continue
                    if side < 0 and own_d > 0:
                        continue
                # 4. Double top/bottom phải thuận cả 2
                if key == "double_top_bottom":
                    if not (btc_d == side and own_d == side):
                        continue

                fill_i = i + 1
                entry = cs4[fill_i].o
                stop = sig["stop"]
                risk_pct = abs(entry - stop) / entry
                
                # Khoảng SL hợp lệ theo đúng policy (1.5% đến 6.0%)
                if risk_pct < 0.015 or risk_pct > 0.060:
                    continue

                r_dist = abs(entry - stop)
                tp1 = entry + side * 1.0 * r_dist
                tp2 = entry + side * 2.0 * r_dist

                res = simulate_live_exit(cs4, fill_i, side, entry, stop, tp1, tp2, hold_bars)
                if not res:
                    continue
                
                gross, r_fraction, hold_cnt, exit_type = res
                year = cs4[fill_i].t // 31_557_600_000 + 1970
                hold_h = hold_cnt * 4
                
                trades.append({
                    "sym": sym,
                    "style": key,
                    "side": side,
                    "gross": gross,
                    "risk": r_fraction,
                    "year": year,
                    "t_in": cs4[fill_i].t,
                    "t_out": cs4[fill_i + hold_cnt].t,
                    "hold_h": hold_h,
                    "exit_type": exit_type,
                })
                
                busy_until = fill_i + hold_cnt
                break

    return trades


def net_r(tr, fee_round_trip):
    cost = fee_round_trip + SLIPPAGE + FUNDING_8H * tr["hold_h"] / 8
    return (tr["gross"] - cost) / tr["risk"]


def print_stats(trades, fee_name, fee_val):
    rs = [net_r(t, fee_val) for t in trades]
    n = len(rs)
    if n == 0:
        print("Không có lệnh nào!")
        return
    win_cnt = sum(x > 0 for x in rs)
    mean_r = sum(rs) / n
    sd = math.sqrt(sum((x - mean_r) ** 2 for x in rs) / (n - 1)) if n > 1 else 0
    t_stat = mean_r / (sd / math.sqrt(n)) if sd > 0 else 0
    
    print(f"\n=======================================================")
    print(f"📊 KẾT QUẢ VỚI PHÍ: {fee_name} ({fee_val*100:.2f}% khứ hồi)")
    print(f"=======================================================")
    print(f"• Tổng số lệnh: {n} lệnh")
    print(f"• Tỷ lệ thắng (Winrate): {win_cnt/n*100:.1f}%")
    print(f"• Kỳ vọng ròng (ExpR): {mean_r:+.3f}R / lệnh")
    print(f"• Độ tin cậy t-statistic: {t_stat:+.2f}")
    
    # Phân loại theo cơ chế thoát
    exits = defaultdict(int)
    for t in trades:
        exits[t["exit_type"]] += 1
    print(f"\n--- Phân bổ kết quả các lệnh ---")
    print(f"  + Thua cắn SL ban đầu (-1R): {exits['sl_initial']} ({exits['sl_initial']/n*100:.1f}%)")
    print(f"  + Cắn TP1 rồi dời hòa vốn (+0.5R): {exits['tp1_then_be']} ({exits['tp1_then_be']/n*100:.1f}%)")
    print(f"  + Ăn trọn cả TP1 và TP2 (+1.5R): {exits['full_tp']} ({exits['full_tp']/n*100:.1f}%)")
    print(f"  + Thoát hết giờ (Time exit): {exits['time_exit'] + exits['tp1_then_time']}")

    # Kết quả theo từng năm
    years = sorted(list({t["year"] for t in trades}))
    print(f"\n--- Kết quả từng năm ---")
    for y in years:
        y_rs = [net_r(t, fee_val) for t in trades if t["year"] == y]
        y_n = len(y_rs)
        y_win = sum(x > 0 for x in y_rs) / y_n if y_n else 0
        y_m = sum(y_rs) / y_n if y_n else 0
        print(f"  Năm {y}: {y_n:4d} lệnh | Thắng {y_win*100:.1f}% | TB {y_m:+.3f}R")

    # Giả lập tài khoản thực tế $52 với rủi ro $2.5/lệnh (Tầng Khởi Động)
    simulate_account(trades, fee_val, 52.0, 2.5)


def simulate_account(trades, fee_val, start_eq=52.0, risk_usd=2.5):
    eq = start_eq
    peak = start_eq
    low = start_eq
    max_dd = 0.0
    streak = 0
    worst_streak = 0
    
    for tr in sorted(trades, key=lambda x: x["t_out"]):
        pnl = risk_usd * net_r(tr, fee_val)
        eq += pnl
        peak = max(peak, eq)
        low = min(low, eq)
        max_dd = max(max_dd, 1 - eq / peak)
        streak = streak + 1 if pnl < 0 else 0
        worst_streak = max(worst_streak, streak)
        
    print(f"\n--- Giả lập tăng trưởng tài khoản thật (${start_eq} USDT, Risk ${risk_usd}/lệnh) ---")
    print(f"• Vốn ban đầu: ${start_eq:.2f}")
    print(f"• Vốn cuối cùng: ${eq:.2f} (Lãi: {((eq-start_eq)/start_eq)*100:+.1f}%)")
    print(f"• Đáy vốn thấp nhất: ${low:.2f}")
    print(f"• Sụt vốn tối đa (Max Drawdown): {max_dd*100:.1f}%")
    print(f"• Chuỗi lệnh thua dài nhất: {worst_streak} lệnh")


if __name__ == "__main__":
    print("⏳ Đang tính toán dữ liệu backtest mô phỏng Live thực tế...")
    all_trades = run_full_simulation()
    
    # 1. Với phí Taker hiện tại của MEXC (0.16% khứ hồi)
    print_stats(all_trades, "MEXC TAKER (0.16% khứ hồi - Lệnh Market)", FEE_TAKER_MEXC)
    
    # 2. Nếu dùng lệnh Limit Maker (0.04% khứ hồi)
    print_stats(all_trades, "MEXC MAKER (0.04% khứ hồi - Lệnh Limit)", FEE_MAKER_MEXC)

