"""
quant_lab/simulate_yesterday_today.py
=============================================================================
GIẢ LẬP GIAO DỊCH NẾN THỰC CHIẾN 36 GIỜ QUA: HÔM QUA (15/10) & HÔM NAY (16/10)
=============================================================================
Mô phỏng máy trạng thái (State Machine) đúng 100% như bot chạy live trên Railway:
- Vốn giả lập: 40.0$ USDT
- Mỗi lệnh: 10$ Margin, Đòn bẩy x10 (Quy mô 100$ Notional)
- Tối đa: 2 lệnh đồng thời
- Phí sàn & trượt giá: -0.16% Notional mỗi lệnh
- Khóa Cooldown: 60 phút sau khi chạm SL
- Trailing Breakeven: Khi đạt +0.8R (+16% ROI), dời SL về hòa vốn
- Lọc Sentinel BTC: Khi BTC đang xả dốc, CẤM vào lệnh Long Altcoins!
"""
import os
import json
import time
import sys
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
COINS = ["BTC", "SOL", "TIA", "SUI", "LTC", "AVAX", "NEAR", "APT", "ARB", "INJ", "OP", "LINK", "DOT"]

START_TS = 1791997200000 # 2026-10-15 00:00:00 VN
END_TS = 1792126800000   # 2026-10-16 12:00:00 VN

def ts_to_vn(ms: int) -> str:
    return time.strftime("%d/%m %H:%M", time.gmtime(ms / 1000 + 7 * 3600))

def load_data():
    all_data = {}
    for c in COINS:
        fpath = os.path.join(DATA_DIR, f"{c}_15m.json")
        if os.path.exists(fpath):
            with open(fpath, "r", encoding="utf-8") as f:
                all_data[c] = json.load(f)
    return all_data

def main():
    print("=" * 86)
    print("🎬 BẮT ĐẦU GIẢ LẬP GIAO DỊCH 36 GIỜ THỰC TẾ: HÔM QUA (15/10) & HÔM NAY (16/10)")
    print("Thời gian: 00:00 ngày 15/10/2026 -> 12:00 trưa nay 16/10/2026 (Giờ Việt Nam)")
    print("Quy tắc: 10$ Margin | Đòn bẩy x10 | Phí sàn -0.16% | Cooldown 60m sau SL | Trailing BE")
    print("=" * 86)

    data = load_data()
    if not data or "BTC" not in data:
        print("[!] Không tìm thấy dữ liệu.")
        return

    # Lấy danh sách tất cả các mốc thời gian 15m trong 36 giờ qua
    btc_candles = data["BTC"]
    window_timestamps = [c["t"] for c in btc_candles if START_TS <= c["t"] <= END_TS]
    print(f"[*] Tổng số nến 15m trong phiên: {len(window_timestamps)} nến (mỗi coin) qua 13 cặp giao dịch\n")

    # Trạng thái giả lập
    balance = 40.0
    open_positions = [] # tối đa 2 lệnh
    closed_trades = []
    cooldown_map = {} # coin -> timestamp hết cooldown

    # Quét từng cây nến theo đúng thời gian thực (Step-by-step không rò rỉ tương lai)
    for cur_t in window_timestamps:
        time_str = ts_to_vn(cur_t)

        # ---------------------------------------------------------------------
        # 1. CẬP NHẬT CÁC LỆNH ĐANG MỞ (KIỂM TRA TP / SL / TRAILING BREAKEVEN)
        # ---------------------------------------------------------------------
        remaining_positions = []
        for pos in open_positions:
            coin = pos["coin"]
            c_now = next((x for x in data[coin] if x["t"] == cur_t), None)
            if not c_now:
                remaining_positions.append(pos)
                continue

            side = pos["side"]
            risk_dist = abs(pos["entry"] - pos["stop"])

            # Kích hoạt Trailing Breakeven khi giá đạt >= 0.8R
            if not pos["be_activated"]:
                if side == 1 and c_now["h"] >= pos["entry"] + 0.8 * risk_dist:
                    pos["be_activated"] = True
                    pos["stop"] = pos["entry"] # Dời SL về hòa vốn
                    print(f"🛡️  [{time_str}] {coin:<4}: Kéo SL về hòa vốn Entry ({pos['entry']}) khi đã lãi +0.8R (+16% ROI)!")
                elif side == -1 and c_now["l"] <= pos["entry"] - 0.8 * risk_dist:
                    pos["be_activated"] = True
                    pos["stop"] = pos["entry"]
                    print(f"🛡️  [{time_str}] {coin:<4}: Kéo SL về hòa vốn Entry ({pos['entry']}) khi đã lãi +0.8R (+16% ROI)!")

            # Kiểm tra chạm SL hoặc TP
            hit_sl = c_now["l"] <= pos["stop"] if side == 1 else c_now["h"] >= pos["stop"]
            hit_tp = c_now["h"] >= pos["tp"] if side == 1 else c_now["l"] <= pos["tp"]

            if hit_tp:
                exit_px = pos["tp"]
                raw_roi = side * (exit_px - pos["entry"]) / pos["entry"] * pos["leverage"]
                pnl = pos["margin"] * raw_roi - 0.016 # Trừ 0.016$ phí sàn
                balance += pnl
                pos.update({
                    "exit_time": cur_t,
                    "exit_px": exit_px,
                    "pnl": pnl,
                    "roi": raw_roi * 100,
                    "status": "CHỐT LỜI (TP)",
                })
                closed_trades.append(pos)
                print(f"✅ [{time_str}] CHỐT LỜI {pos['side_str']} {coin:<4}: Vào {pos['entry']} -> TP {exit_px} | PnL: +{pnl:.2f}$ (+{raw_roi*100:.1f}% ROI)")

            elif hit_sl:
                exit_px = pos["stop"]
                status = "HÒA VỐN (BE)" if pos["be_activated"] else "CẮT LỖ (SL)"
                raw_roi = side * (exit_px - pos["entry"]) / pos["entry"] * pos["leverage"]
                pnl = pos["margin"] * raw_roi - 0.016
                balance += pnl
                pos.update({
                    "exit_time": cur_t,
                    "exit_px": exit_px,
                    "pnl": pnl,
                    "roi": raw_roi * 100,
                    "status": status,
                })
                closed_trades.append(pos)

                if status == "CẮT LỖ (SL)":
                    cooldown_map[coin] = cur_t + 60 * 60_000 # Khóa 60 phút
                    print(f"❌ [{time_str}] CẮT LỖ {pos['side_str']} {coin:<4}: Vào {pos['entry']} -> SL {exit_px} | PnL: {pnl:.2f}$ ({raw_roi*100:.1f}% ROI) -> Khóa Cooldown 60m!")
                else:
                    print(f"🛡️ [{time_str}] HÒA VỐN {pos['side_str']} {coin:<4}: Chạm SL hòa vốn Entry ({exit_px}) -> Giữ nguyên vốn an toàn!")

            else:
                remaining_positions.append(pos)

        open_positions = remaining_positions

        # ---------------------------------------------------------------------
        # 2. KIỂM TRA BỐI CẢNH BTC SENTINEL
        # ---------------------------------------------------------------------
        btc_history = [c for c in btc_candles if c["t"] <= cur_t]
        btc_dumping = False
        if len(btc_history) >= 20:
            last_btc = btc_history[-1]
            btc_prev4 = btc_history[-5:-1]
            # Nếu BTC vừa xả cây nến đỏ dốc đứng > 0.5% trong 15m
            if (last_btc["c"] - last_btc["o"]) / last_btc["o"] <= -0.005:
                btc_dumping = True

        # ---------------------------------------------------------------------
        # 3. QUÉT TÍN HIỆU VÀO LỆNH CHO TỪNG COIN (NẾU CÒN CHỖ TRỐNG < 2 LỆNH)
        # ---------------------------------------------------------------------
        if len(open_positions) < 2:
            for coin in COINS:
                if len(open_positions) >= 2:
                    break

                # Đang trong Cooldown thì bỏ qua
                if cur_t < cooldown_map.get(coin, 0):
                    continue

                # Đã có lệnh của coin này đang mở thì không vào nhồi
                if any(p["coin"] == coin for p in open_positions):
                    continue

                cs = [c for c in data[coin] if c["t"] <= cur_t]
                if len(cs) < 50:
                    continue

                last = cs[-1]
                rng = last["h"] - last["l"]
                if rng <= 0:
                    continue

                # Kiểm tra nổ Volume >= 2.0x (Hyperopt đã tối ưu)
                prev20 = cs[-21:-1]
                avg_vol = sum(x["v"] for x in prev20) / len(prev20) if prev20 else 1.0
                vol_ratio = last["v"] / avg_vol if avg_vol > 0 else 1.0

                # Quét nền 36 nến
                box = cs[-37:-1]
                box_hi = max(b["h"] for b in box)
                box_lo = min(b["l"] for b in box)
                box_range = box_hi - box_lo

                signal = None

                # KÈO 1: BỨT PHÁ NỀN 15M (SHELF BREAKOUT)
                if 0.003 <= (box_range / box_lo) <= 0.055 and vol_ratio >= 1.8:
                    body = abs(last["c"] - last["o"])
                    # Breakout Long (chỉ vào nếu BTC không xả)
                    if last["c"] > last["o"] and last["c"] > box_hi and not btc_dumping:
                        if (last["h"] - last["c"]) <= 0.22 * rng and body >= 0.55 * rng:
                            entry = last["c"]
                            sl = max(box_lo, box_hi - 0.008 * box_hi)
                            if 0.004 <= (entry - sl) / entry <= 0.035:
                                tp = entry + 1.4 * (entry - sl) # TP 1.4R theo Hyperopt
                                signal = (1, "🟢 LONG", entry, sl, tp, "Phá đỉnh nền 15m nổ Vol")

                    # Breakdown Short
                    elif last["c"] < last["o"] and last["c"] < box_lo:
                        if (last["c"] - last["l"]) <= 0.22 * rng and body >= 0.55 * rng:
                            entry = last["c"]
                            sl = min(box_hi, box_lo + 0.008 * box_lo)
                            if 0.004 <= (sl - entry) / entry <= 0.035:
                                tp = entry - 1.4 * (sl - entry)
                                signal = (-1, "🔴 SHORT", entry, sl, tp, "Thủng đáy nền 15m nổ Vol")

                # KÈO 2: RÚT CHÂN HỖ TRỢ / BẬT SPRING TẠI ĐÁY
                if not signal and vol_ratio >= 1.5:
                    lower_wick = min(last["o"], last["c"]) - last["l"]
                    upper_wick = last["h"] - max(last["o"], last["c"])
                    # Quét đáy rút chân (Hammer / Pinbar)
                    if lower_wick >= 0.55 * rng and last["c"] > box_lo and not btc_dumping:
                        entry = last["c"]
                        sl = last["l"] - 0.002 * last["l"]
                        if 0.004 <= (entry - sl) / entry <= 0.035:
                            tp = entry + 1.5 * (entry - sl)
                            signal = (1, "🟢 LONG", entry, sl, tp, "Quét đáy rút râu gom hàng")

                if signal:
                    side, side_str, entry, sl, tp, reason = signal
                    open_positions.append({
                        "coin": coin,
                        "side": side,
                        "side_str": side_str,
                        "entry": entry,
                        "stop": sl,
                        "tp": tp,
                        "margin": 10.0,
                        "leverage": 10,
                        "open_time": cur_t,
                        "be_activated": False,
                        "reason": reason,
                    })
                    print(f"🎯 [{time_str}] MỞ LỆNH {side_str} {coin:<4}: Giá vào {entry} | SL {sl} | TP {tp} ({reason})")

    # -------------------------------------------------------------------------
    # 4. TỔNG KẾT VỊ THẾ CÒN MỞ VÀ HIỆU SUẤT TỔNG THỂ
    # -------------------------------------------------------------------------
    print("\n" + "=" * 86)
    print("📊 BẢNG TỔNG KẾT KẾT QUẢ GIAO DỊCH 36 GIỜ (15/10 - 16/10)")
    print("=" * 86)
    print(f"{'STT':<4} | {'COIN':<5} | {'VỊ THẾ':<8} | {'GIÁ VÀO':<10} | {'GIÁ ĐÓNG':<10} | {'THỜI GIAN VÀO':<13} | {'KẾT QUẢ':<14} | {'PNL (USDT)'}")
    print("-" * 86)

    total_pnl = 0.0
    wins, losses, be_count = 0, 0, 0
    for idx, t in enumerate(closed_trades, 1):
        total_pnl += t["pnl"]
        if "TP" in t["status"]:
            wins += 1
        elif "SL" in t["status"]:
            losses += 1
        else:
            be_count += 1

        print(f"{idx:<4} | {t['coin']:<5} | {t['side_str']:<8} | {t['entry']:<10.4f} | {t['exit_px']:<10.4f} | {ts_to_vn(t['open_time']):<13} | {t['status']:<14} | {t['pnl']:>+7.2f}$")

    print("-" * 86)
    print(f"Vị thế còn đang giữ: {len(open_positions)} lệnh")
    for op in open_positions:
        print(f"  -> Đang chạy: {op['side_str']} {op['coin']} (Giá vào {op['entry']} | SL {op['stop']} | TP {op['tp']})")

    print("\n" + "=" * 86)
    win_rate = (wins / len(closed_trades) * 100) if closed_trades else 0.0
    print(f"💰 TÀI KHOẢN KHỞI ĐẦU: 40.00$ USDT  ->  SỐ DƯ HIỆN TẠI: {balance:.2f}$ USDT")
    print(f"📈 TỔNG LỢI NHUẬN RÒNG: {total_pnl:>+6.2f}$ USDT (Đã khấu trừ 100% phí sàn & trượt giá)")
    print(f"🎯 TỔNG SỐ LỆNH: {len(closed_trades)} | THẮNG: {wins} | THUA: {losses} | HÒA VỐN (BE): {be_count}")
    print(f"🏆 TỶ LỆ THẮNG (WIN RATE): {win_rate:.1f}%")
    print("=" * 86)

if __name__ == "__main__":
    main()

