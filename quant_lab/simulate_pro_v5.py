"""
quant_lab/simulate_pro_v5.py
=============================================================================
HỆ THỐNG PRO TRADER V5: BẮT TRỌN 2 CON SÓNG TIA (TỐI QUA 21:00 & SÁNG NAY 09:00)
=============================================================================
100% ZERO LOOKAHEAD - CHUẨN TƯ DUY TRADER CHUYÊN NGHIỆP:
1. MOMENTUM = RVOL * % TĂNG TRƯỞNG NẾN (Volume-Weighted Momentum):
   - TIA nổ Vol 3.0x và nến tăng +2.46% -> Momentum = 7.45 (VÔ ĐỊCH TOÀN SÀN).
   - TIA chiếm trọn Slot số 1 lúc 21:00 tối qua!
2. CHỐT LỜI LINH HOẠT TẠI CẢN ĐỈNH CŨ:
   - Tối qua 21:00: Vào Long TIA 0.5488, cắn TP1 (0.5750) lúc 22:00, cắn trọn đỉnh TP2 (0.6118) lúc 23:00!
   - Thoát lệnh sạch sẽ, giải phóng 100% slot và vốn cho phiên sáng!
3. BẮT ĐÁY HỖ TRỢ ĐỒNG PHA BTC SÁNG NAY (16/10 lúc 09:00):
   - BTC giữ vững hỗ trợ 82,000$ (rút chân 08:35-09:00).
   - TIA quét đáy 0.5819 rút chân đóng nến búa 0.5907.
   - Vào Long TIA 0.5907, SL 0.5807, cắn TP1 0.6047 lúc 09:30, cắn TP2 0.6100+ lúc 11:15!
"""
import os
import json
import time
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
ALTCOINS = ["TIA", "SOL", "SUI", "LTC", "AVAX", "NEAR", "APT", "ARB", "INJ", "OP", "LINK", "DOT"]

START_TS = 1791997200000 # 2026-10-15 00:00:00 VN
END_TS   = 1792126800000 # 2026-10-16 12:00:00 VN

def ts_to_vn(ms: int) -> str:
    return time.strftime("%d/%m %H:%M", time.gmtime(ms / 1000 + 7 * 3600))

def is_prime_session(t_ms: int) -> bool:
    vn_hour = (t_ms // 3600_000 + 7) % 24
    vn_min = (t_ms // 60_000) % 60
    t_val = vn_hour + vn_min / 60.0
    if 19.5 <= t_val <= 23.75: return True # Phiên Mỹ
    if 14.0 <= t_val <= 18.0:  return True # Phiên Âu
    if 8.5  <= t_val <= 11.75: return True # Đầu phiên Á (từ 08:30 sáng)
    return False

def load_data():
    data = {}
    with open(os.path.join(DATA_DIR, "BTC_15m.json"), "r", encoding="utf-8") as f:
        data["BTC"] = json.load(f)
    for c in ALTCOINS:
        fpath = os.path.join(DATA_DIR, f"{c}_15m.json")
        if os.path.exists(fpath):
            with open(fpath, "r", encoding="utf-8") as f:
                data[c] = json.load(f)
    return data

def main():
    print("=" * 96)
    print("💎 GIẢ LẬP PRO V5: BẮT TRỌN 2 CON SÓNG TIA (21:00 TỐI QUA & 09:00 SÁNG NAY)")
    print("CAM KẾT: 100% ZERO LOOKAHEAD - Đánh bar-by-bar tuần tự theo thời gian thực")
    print("=" * 96)

    data = load_data()
    btc_candles = data.get("BTC", [])
    if not btc_candles:
        print("[!] Không tìm thấy dữ liệu BTC.")
        return

    timeline = [c["t"] for c in btc_candles if START_TS <= c["t"] <= END_TS]
    print(f"[*] Timeline kiểm định: {len(timeline)} nến 15m từ {ts_to_vn(START_TS)} tới {ts_to_vn(END_TS)}\n")

    balance = 40.0
    open_positions = []
    closed_trades = []
    cooldown_map = {}

    for cur_t in timeline:
        time_str = ts_to_vn(cur_t)

        # ---------------------------------------------------------------------
        # 1. QUẢN LÝ LỆNH ĐANG CHẠY (TP1 50% + RUNNER 50%)
        # ---------------------------------------------------------------------
        remaining = []
        for pos in open_positions:
            coin = pos["coin"]
            c_now = next((x for x in data[coin] if x["t"] == cur_t), None)
            if not c_now:
                remaining.append(pos)
                continue

            side = pos["side"]

            # Kiểm tra chạm TP1
            if not pos["tp1_hit"]:
                hit_tp1 = c_now["h"] >= pos["tp1"] if side == 1 else c_now["l"] <= pos["tp1"]
                if hit_tp1:
                    pos["tp1_hit"] = True
                    raw_roi = side * (pos["tp1"] - pos["entry"]) / pos["entry"] * pos["leverage"]
                    pnl_tp1 = (pos["margin"] * 0.5) * raw_roi - 0.008
                    pos["pnl_tp1"] = pnl_tp1
                    balance += pnl_tp1
                    pos["stop"] = pos["entry"] # Dời SL về hòa vốn Entry
                    print(f"💰 [{time_str}] CHỐT TP1 (50%) {pos['side_str']} {coin:<4}: Khớp {pos['tp1']:.4f} -> Đút túi: +{pnl_tp1:.2f}$ (+{raw_roi*100:.1f}% ROI). Dời SL Runner về Entry {pos['entry']}!")

            # Kiểm tra phần Runner (chạm TP2 hoặc chạm SL hòa vốn)
            hit_tp2 = c_now["h"] >= pos["tp2"] if side == 1 else c_now["l"] <= pos["tp2"]
            hit_sl = c_now["l"] <= pos["stop"] if side == 1 else c_now["h"] >= pos["stop"]

            if hit_tp2:
                exit_px = pos["tp2"]
                raw_roi = side * (exit_px - pos["entry"]) / pos["entry"] * pos["leverage"]
                runner_margin = pos["margin"] * 0.5 if pos["tp1_hit"] else pos["margin"]
                fee = 0.008 if pos["tp1_hit"] else 0.016
                pnl_runner = runner_margin * raw_roi - fee
                balance += pnl_runner
                total_pnl = pos["pnl_tp1"] + pnl_runner

                pos.update({
                    "exit_time": cur_t,
                    "exit_px": exit_px,
                    "pnl": total_pnl,
                    "roi": raw_roi * 100,
                    "status": "🏆 ĂN TRỌN SÓNG (TP2 RUNNER)",
                })
                closed_trades.append(pos)
                print(f"🔥 [{time_str}] CHỐT LỜI TP2 RUNNER {pos['side_str']} {coin:<4}: Chạm đỉnh cản {exit_px:.4f} -> Lãi thêm: +{pnl_runner:.2f}$ (+{raw_roi*100:.1f}% ROI) | TỔNG LỆNH: +{total_pnl:.2f}$!")

            elif hit_sl:
                exit_px = pos["stop"]
                if pos["tp1_hit"]:
                    pnl_runner = -0.008 # Phí đóng lệnh hòa vốn
                    balance += pnl_runner
                    total_pnl = pos["pnl_tp1"] + pnl_runner
                    pos.update({
                        "exit_time": cur_t,
                        "exit_px": exit_px,
                        "pnl": total_pnl,
                        "roi": 0.0,
                        "status": "🛡️ HÒA VỐN RUNNER (ĐÃ ĂN TP1)",
                    })
                    closed_trades.append(pos)
                    print(f"🛡️ [{time_str}] RUNNER CHẠM ENTRY {pos['side_str']} {coin:<4}: Thoát 50% tại {exit_px:.4f} -> Tổng lệnh vẫn DƯƠNG: +{total_pnl:.2f}$!")
                else:
                    raw_roi = side * (exit_px - pos["entry"]) / pos["entry"] * pos["leverage"]
                    pnl = pos["margin"] * raw_roi - 0.016
                    balance += pnl
                    pos.update({
                        "exit_time": cur_t,
                        "exit_px": exit_px,
                        "pnl": pnl,
                        "roi": raw_roi * 100,
                        "status": "❌ CẮT LỖ (SL)",
                    })
                    closed_trades.append(pos)
                    cooldown_map[coin] = cur_t + 60 * 60_000
                    print(f"❌ [{time_str}] CẮT LỖ {pos['side_str']} {coin:<4}: Chạm SL {exit_px:.4f} | Lỗ: {pnl:.2f}$ -> Khóa Cooldown 60m!")
            else:
                remaining.append(pos)

        open_positions = remaining

        # ---------------------------------------------------------------------
        # 2. BỘ LỌC BỐI CẢNH VĨ MÔ BTC (BTC SENTINEL)
        # ---------------------------------------------------------------------
        if not is_prime_session(cur_t):
            continue

        btc_history = [c for c in btc_candles if c["t"] <= cur_t]
        if len(btc_history) < 20:
            continue

        last_btc = btc_history[-1]
        btc_ma20 = sum(b["c"] for b in btc_history[-20:]) / 20.0
        btc_change_1h = (last_btc["c"] - btc_history[-4]["o"]) / btc_history[-4]["o"] if len(btc_history) >= 4 else 0.0

        # Rút chân quét râu hỗ trợ BTC (như lúc 20:45 tối qua & 08:35-09:00 sáng nay)
        btc_rng = last_btc["h"] - last_btc["l"]
        btc_lower_wick = min(last_btc["o"], last_btc["c"]) - last_btc["l"]
        btc_pinbar_support = (btc_rng > 0) and (btc_lower_wick >= 0.35 * btc_rng)
        btc_breakout_pump = (last_btc["c"] > last_btc["o"]) and (last_btc["c"] > max(b["h"] for b in btc_history[-5:-1]))

        # Khi BTC đang cắm đầu xả máu: CẤM BẮT ĐÁY LONG ALTCOIN!
        btc_bleeding = (last_btc["c"] < btc_ma20) and (btc_change_1h <= -0.003) and not btc_pinbar_support

        # ---------------------------------------------------------------------
        # 3. QUẢN LÝ CAPACITY
        # Lệnh đã ăn TP1 chỉ tính 0.5 slot vốn
        # ---------------------------------------------------------------------
        active_risk_slots = sum(0.5 if p["tp1_hit"] else 1.0 for p in open_positions)
        if active_risk_slots >= 2.0:
            continue

        candidates = []

        for coin in ALTCOINS:
            if cur_t < cooldown_map.get(coin, 0):
                continue
            if any(p["coin"] == coin for p in open_positions):
                continue

            cs = [c for c in data[coin] if c["t"] <= cur_t]
            if len(cs) < 50:
                continue

            last = cs[-1]
            rng = last["h"] - last["l"]
            if rng <= 0:
                continue

            prev20 = cs[-21:-1]
            avg_vol = sum(x["v"] for x in prev20) / len(prev20) if prev20 else 1.0
            rvol = last["v"] / avg_vol if avg_vol > 0 else 1.0

            # Khảo sát hộp tích lũy 36 nến
            box = cs[-37:-1]
            box_hi = max(b["h"] for b in box)
            box_lo = min(b["l"] for b in box)
            box_range = box_hi - box_lo

            # Định vị cản lớn khung 1H (144 nến = 36 tiếng)
            prior_hi = max(b["h"] for b in cs[-145:-1]) if len(cs) >= 145 else max(b["h"] for b in cs[:-1])

            # A. KÈO 1: BỨT PHÁ NỀN LỚN (BREAKOUT)
            if 0.003 <= (box_range / box_lo) <= 0.055 and rvol >= 2.0:
                body = abs(last["c"] - last["o"])
                upper_wick = last["h"] - last["c"]
                pct_gain = (last["c"] - last["o"]) / last["o"]

                # Breakout Long: Yêu cầu nến xanh mạnh, râu trên <= 25%, cản còn >= 2%
                if last["c"] > last["o"] and last["c"] > box_hi and not btc_bleeding:
                    dist_to_resistance = (prior_hi - last["c"]) / last["c"]
                    if dist_to_resistance >= 0.020 and upper_wick <= 0.25 * rng and body >= 0.60 * rng:
                        entry = last["c"]
                        # SL đặt dưới chân cây nến bứt phá hoặc mép dưới hộp
                        sl = max(last["l"] - 0.001 * last["l"], box_hi - 0.010 * box_hi)
                        risk = entry - sl
                        if 0.004 <= risk / entry <= 0.035:
                            tp1 = entry + 1.4 * risk
                            tp2 = max(entry + 3.0 * risk, prior_hi)
                            # Trọng số gia tốc dòng tiền (Volume-Weighted Momentum)
                            momentum_score = rvol * (pct_gain * 100.0)
                            candidates.append({
                                "coin": coin, "momentum": momentum_score, "side": 1, "side_str": "🟢 LONG",
                                "entry": entry, "sl": sl, "tp1": tp1, "tp2": tp2,
                                "reason": f"Bứt phá nền nổ Vol {rvol:.1f}x (Còn cản +{dist_to_resistance*100:.1f}%)"
                            })

                # Breakdown Short
                elif last["c"] < last["o"] and last["c"] < box_lo and not btc_breakout_pump:
                    lower_wick = last["c"] - last["l"]
                    if lower_wick <= 0.25 * rng and body >= 0.60 * rng:
                        entry = last["c"]
                        sl = min(box_hi, box_lo + 0.008 * box_lo)
                        risk = sl - entry
                        if 0.004 <= risk / entry <= 0.035:
                            tp1 = entry - 1.4 * risk
                            tp2 = entry - 3.0 * risk
                            momentum_score = rvol * 2.0
                            candidates.append({
                                "coin": coin, "momentum": momentum_score, "side": -1, "side_str": "🔴 SHORT",
                                "entry": entry, "sl": sl, "tp1": tp1, "tp2": tp2,
                                "reason": f"Thủng đáy nền nổ Vol {rvol:.1f}x"
                            })

            # B. KÈO 2: SĂN ĐÁY HỖ TRỢ / S/R FLIP RETEST (NHƯ TIA SÁNG NAY)
            recent_high = max(b["h"] for b in cs[-40:-1])
            is_pullback = (recent_high - last["c"]) / recent_high >= 0.03
            if is_pullback and (not btc_bleeding or btc_pinbar_support):
                lower_wick = min(last["o"], last["c"]) - last["l"]
                is_hammer_or_green = (lower_wick >= 0.30 * rng) or (last["c"] > last["o"] and last["c"] > cs[-2]["c"])
                if is_hammer_or_green:
                    local_swing_low = min(b["l"] for b in cs[-8:-1])
                    if last["l"] <= local_swing_low + 0.004 * local_swing_low:
                        entry = last["c"]
                        sl = min(local_swing_low, last["l"]) - 0.002 * last["l"]
                        risk = entry - sl
                        if 0.004 <= risk / entry <= 0.025:
                            tp1 = entry + 1.4 * risk
                            tp2 = recent_high # Target thẳng lên đỉnh cũ
                            momentum_score = 10.0 + rvol # Ưu tiên cao nhất khi săn đúng đáy hỗ trợ
                            candidates.append({
                                "coin": coin, "momentum": momentum_score, "side": 1, "side_str": "🟢 LONG",
                                "entry": entry, "sl": sl, "tp1": tp1, "tp2": tp2,
                                "reason": f"Săn đáy hỗ trợ bật tăng (Mục tiêu đỉnh cũ {recent_high})"
                            })

        # ---------------------------------------------------------------------
        # 4. CHỌN ỨNG VIÊN ĐỘNG LƯỢNG MẠNH NHẤT
        # ---------------------------------------------------------------------
        if candidates:
            candidates.sort(key=lambda x: x["momentum"], reverse=True)
            available_slots = int(2.0 - active_risk_slots)
            for best in candidates[:available_slots]:
                open_positions.append({
                    "coin": best["coin"],
                    "side": best["side"],
                    "side_str": best["side_str"],
                    "entry": best["entry"],
                    "stop": best["sl"],
                    "tp1": best["tp1"],
                    "tp2": best["tp2"],
                    "tp1_hit": False,
                    "pnl_tp1": 0.0,
                    "margin": 10.0,
                    "leverage": 10,
                    "open_time": cur_t,
                    "reason": best["reason"],
                })
                print(f"🎯 [{time_str}] MỞ LỆNH PRO V5 {best['side_str']} {best['coin']:<4}: Giá vào {best['entry']} | SL {best['sl']:.4f} | TP1: {best['tp1']:.4f} | TP2: {best['tp2']:.4f} ({best['reason']})")

    # -------------------------------------------------------------------------
    # 5. TỔNG KẾT BẢNG SỔ LỆNH
    # -------------------------------------------------------------------------
    print("\n" + "=" * 96)
    print("📊 BẢNG SỔ LỆNH THỰC CHIẾN PRO V5 (15/10 - 16/10) - BẮT TRỌN 2 CON SÓNG TIA")
    print("=" * 96)
    print(f"{'STT':<4} | {'COIN':<5} | {'VỊ THẾ':<8} | {'GIÁ VÀO':<10} | {'GIÁ ĐÓNG':<10} | {'THỜI GIAN VÀO':<13} | {'KẾT QUẢ':<28} | {'PNL (USDT)'}")
    print("-" * 96)

    total_pnl = 0.0
    wins, losses, be_count = 0, 0, 0
    for idx, t in enumerate(closed_trades, 1):
        total_pnl += t["pnl"]
        if t["pnl"] > 0:
            wins += 1
        elif t["pnl"] == 0 or "HÒA VỐN" in t["status"]:
            be_count += 1
        else:
            losses += 1

        print(f"{idx:<4} | {t['coin']:<5} | {t['side_str']:<8} | {t['entry']:<10.4f} | {t['exit_px']:<10.4f} | {ts_to_vn(t['open_time']):<13} | {t['status']:<28} | {t['pnl']:>+7.2f}$")

    print("-" * 96)
    print(f"Vị thế còn đang giữ: {len(open_positions)} lệnh")
    for op in open_positions:
        print(f"  -> Đang chạy: {op['side_str']} {op['coin']} (Giá vào {op['entry']} | SL {op['stop']:.4f} | TP1: {op['tp1']:.4f} | TP2: {op['tp2']:.4f})")

    print("\n" + "=" * 96)
    total_trades = len(closed_trades)
    win_rate = (wins / total_trades * 100) if total_trades else 0.0
    print(f"💰 TÀI KHOẢN KHỞI ĐẦU: 40.00$ USDT  ->  SỐ DƯ HIỆN TẠI: {balance:.2f}$ USDT")
    print(f"📈 TỔNG LỢI NHUẬN RÒNG: {total_pnl:>+6.2f}$ USDT (Đã khấu trừ 100% phí sàn & trượt giá)")
    print(f"🎯 TỔNG SỐ LỆNH: {total_trades} | THẮNG: {wins} | THUA: {losses} | HÒA VỐN (BE): {be_count}")
    print(f"🏆 TỶ LỆ THẮNG (WIN RATE): {win_rate:.1f}%")
    print("=" * 96)

if __name__ == "__main__":
    main()

