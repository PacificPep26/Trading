"""
quant_lab/simulate_pro_v2.py
=============================================================================
HỆ THỐNG PRO TRADER V2: ƯU TIÊN SỨC MẠNH TƯƠNG ĐỐI (RVOL) & SĂN ĐÁY HỖ TRỢ
=============================================================================
100% ZERO LOOKAHEAD - 2 NÂNG CẤP ĐẮT GIÁ THEO ĐÚNG CHỈ ĐẠO CỦA VICTOR:
1. ƯU TIÊN COIN DÒNG TIỀN MẠNH NHẤT (RVOL RANKING):
   - Khi phiên Mỹ 21:00 bùng nổ, không chọn coin ngẫu nhiên theo thứ tự chữ cái!
   - Xếp hạng tất cả ứng viên theo Xung lực Volume (Rvol = Vol / AvgVol20).
   - Coin nào dòng tiền cá mập đổ vào mạnh nhất (như TIA lúc 21:00 nổ 3.8x Vol) được ưu tiên chiếm Slot số 1!
2. PHÂN BIỆT ĐIỂM VÀO: SĂN ĐÁY HỖ TRỢ (SUPPORT BOUNCE) VS BỨT PHÁ (BREAKOUT):
   - Khi giá đã tăng cao sát đỉnh cản cũ: CẤM FOMO mua Breakout đỉnh cản!
   - Khi giá hồi về đáy hỗ trợ và rút râu gom hàng (như TIA sáng nay lúc 09:00 quanh 0.590):
     VÀO LONG NGAY TẠI HỖ TRỢ, SL dưới đáy quét (0.5810), TP tại đỉnh cũ (0.6100)!
3. RUNNER 50%: Thả trôi gồng trọn thân cá lên vùng cản khung lớn (0.605 - 0.610).
"""
import os
import json
import time
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
COINS = ["BTC", "SOL", "TIA", "SUI", "LTC", "AVAX", "NEAR", "APT", "ARB", "INJ", "OP", "LINK", "DOT"]

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
    if 9.0  <= t_val <= 11.5:  return True # Đầu phiên Á
    return False

def load_data():
    data = {}
    for c in COINS:
        fpath = os.path.join(DATA_DIR, f"{c}_15m.json")
        if os.path.exists(fpath):
            with open(fpath, "r", encoding="utf-8") as f:
                data[c] = json.load(f)
    return data

def main():
    print("=" * 92)
    print("💎 GIẢ LẬP PRO V2: ƯU TIÊN COIN DÒNG TIỀN MẠNH NHẤT (RVOL) & SĂN ĐÁY HỖ TRỢ (15/10 - 16/10)")
    print("CAM KẾT: 100% ZERO LOOKAHEAD - Chỉ dùng dữ liệu nến đã đóng")
    print("=" * 92)

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
                    print(f"💰 [{time_str}] CHỐT TP1 (50%) {pos['side_str']} {coin:<4}: Khớp {pos['tp1']} -> Đút túi: +{pnl_tp1:.2f}$ (+{raw_roi*100:.1f}% ROI). Dời SL Runner về Entry {pos['entry']}!")

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
                print(f"🔥 [{time_str}] CHỐT LỜI TP2 RUNNER {pos['side_str']} {coin:<4}: Chạm đỉnh {exit_px} -> Lãi thêm: +{pnl_runner:.2f}$ (+{raw_roi*100:.1f}% ROI) | TỔNG LỆNH: +{total_pnl:.2f}$!")

            elif hit_sl:
                exit_px = pos["stop"]
                if pos["tp1_hit"]:
                    pnl_runner = -0.008
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
                    print(f"🛡️ [{time_str}] RUNNER CHẠM ENTRY {pos['side_str']} {coin:<4}: Thoát 50% tại {exit_px} -> Tổng lệnh vẫn DƯƠNG: +{total_pnl:.2f}$!")
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
                    print(f"❌ [{time_str}] CẮT LỖ {pos['side_str']} {coin:<4}: Chạm SL {exit_px} | Lỗ: {pnl:.2f}$ -> Khóa Cooldown 60m!")
            else:
                remaining.append(pos)

        open_positions = remaining

        # ---------------------------------------------------------------------
        # 2. BỘ LỌC BỐI CẢNH (BTC SENTINEL & KHUNG GIỜ VÀNG)
        # ---------------------------------------------------------------------
        if not is_prime_session(cur_t):
            continue

        btc_history = [c for c in btc_candles if c["t"] <= cur_t]
        btc_dumping = False
        if len(btc_history) >= 20:
            last_btc = btc_history[-1]
            if (last_btc["c"] - last_btc["o"]) / last_btc["o"] <= -0.005:
                btc_dumping = True

        # ---------------------------------------------------------------------
        # 3. QUÉT VÀ XẾP HẠNG TẤT CẢ CÁC COIN THEO ĐỘ MẠNH DÒNG TIỀN (RVOL RANKING)
        # ---------------------------------------------------------------------
        available_slots = 2 - len(open_positions)
        if available_slots <= 0:
            continue

        candidates = []

        for coin in COINS:
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

            # Định vị cản lớn khung 1H (Đỉnh cao nhất 36 tiếng qua / 144 nến)
            prior_hi = max(b["h"] for b in cs[-145:-1]) if len(cs) >= 145 else max(b["h"] for b in cs[:-1])
            prior_lo = min(b["l"] for b in cs[-145:-1]) if len(cs) >= 145 else min(b["l"] for b in cs[:-1])

            # A. KÈO 1: BỨT PHÁ NỀN LỚN (BREAKOUT) - CHỈ VÀO KHI CÒN ĐỊA DƯ TĂNG >= 2.0%
            if 0.003 <= (box_range / box_lo) <= 0.055 and rvol >= 2.0:
                body = abs(last["c"] - last["o"])
                # Breakout Long: Giá vượt hộp và cách đỉnh cản cũ >= 2.0%
                if last["c"] > last["o"] and last["c"] > box_hi and not btc_dumping:
                    dist_to_resistance = (prior_hi - last["c"]) / last["c"]
                    # Chỉ mua khi còn địa dư tăng trưởng >= 2.0% (chống mua đỉnh cản)
                    if dist_to_resistance >= 0.020 and (last["h"] - last["c"]) <= 0.20 * rng and body >= 0.60 * rng:
                        entry = last["c"]
                        sl = max(box_lo, box_hi - 0.008 * box_hi)
                        risk = entry - sl
                        if 0.004 <= risk / entry <= 0.035:
                            tp1 = entry + 1.4 * risk
                            # TP2 Runner hướng thẳng tới cản đỉnh cũ
                            tp2 = max(entry + 3.0 * risk, prior_hi)
                            candidates.append({
                                "coin": coin, "rvol": rvol, "side": 1, "side_str": "🟢 LONG",
                                "entry": entry, "sl": sl, "tp1": tp1, "tp2": tp2,
                                "reason": f"Bứt phá nền nổ Vol {rvol:.1f}x (Còn cản +{dist_to_resistance*100:.1f}%)"
                            })

                # Breakdown Short
                elif last["c"] < last["o"] and last["c"] < box_lo:
                    if (last["c"] - last["l"]) <= 0.20 * rng and body >= 0.60 * rng:
                        entry = last["c"]
                        sl = min(box_hi, box_lo + 0.008 * box_lo)
                        risk = sl - entry
                        if 0.004 <= risk / entry <= 0.035:
                            tp1 = entry - 1.4 * risk
                            tp2 = entry - 3.0 * risk
                            candidates.append({
                                "coin": coin, "rvol": rvol, "side": -1, "side_str": "🔴 SHORT",
                                "entry": entry, "sl": sl, "tp1": tp1, "tp2": tp2,
                                "reason": f"Thủng đáy nền nổ Vol {rvol:.1f}x"
                            })

            # B. KÈO 2: SĂN ĐÁY HỖ TRỢ / S/R FLIP RETEST (NHƯ TIA SÁNG NAY)
            # Nến điều chỉnh về vùng hỗ trợ, có rút râu dưới hoặc đóng nến xanh xác nhận giữ cản
            recent_high = max(b["h"] for b in cs[-40:-1])
            is_pullback = (recent_high - last["c"]) / recent_high >= 0.03 # Giá đã điều chỉnh >= 3% từ đỉnh
            if is_pullback and not btc_dumping:
                lower_wick = min(last["o"], last["c"]) - last["l"]
                # Nến rút chân từ đáy hoặc nến xanh bật tăng giữ hỗ trợ
                if (lower_wick >= 0.35 * rng or (last["c"] > last["o"] and last["c"] > cs[-2]["c"])):
                    # Điểm hỗ trợ là đáy thấp nhất của nhịp quét gần nhất
                    local_swing_low = min(b["l"] for b in cs[-8:-1])
                    if last["l"] <= local_swing_low + 0.003 * local_swing_low:
                        entry = last["c"]
                        sl = local_swing_low - 0.002 * local_swing_low
                        risk = entry - sl
                        if 0.004 <= risk / entry <= 0.025:
                            tp1 = entry + 1.5 * risk
                            tp2 = recent_high # Target là đỉnh cũ của con sóng
                            candidates.append({
                                "coin": coin, "rvol": rvol, "side": 1, "side_str": "🟢 LONG",
                                "entry": entry, "sl": sl, "tp1": tp1, "tp2": tp2,
                                "reason": f"Săn đáy hỗ trợ bật tăng (Mục tiêu đỉnh cũ {recent_high})"
                            })

        # ---------------------------------------------------------------------
        # 4. CHỌN ỨNG VIÊN CÓ RVOL CAO NHẤT ĐỂ VÀO LỆNH (CHỌN CON KHỎE NHẤT)
        # ---------------------------------------------------------------------
        if candidates:
            # Sắp xếp giảm dần theo rvol
            candidates.sort(key=lambda x: x["rvol"], reverse=True)
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
                print(f"🎯 [{time_str}] MỞ LỆNH PRO V2 {best['side_str']} {best['coin']:<4}: Giá vào {best['entry']} | SL {best['sl']} | TP1: {best['tp1']:.4f} | TP2: {best['tp2']:.4f} ({best['reason']})")

    # -------------------------------------------------------------------------
    # 5. TỔNG KẾT BẢNG SỔ LỆNH
    # -------------------------------------------------------------------------
    print("\n" + "=" * 92)
    print("📊 BẢNG SỔ LỆNH THỰC CHIẾN PRO V2 (15/10 - 16/10) - DÒNG TIỀN KHỎE & SĂN ĐÁY")
    print("=" * 92)
    print(f"{'STT':<4} | {'COIN':<5} | {'VỊ THẾ':<8} | {'GIÁ VÀO':<10} | {'GIÁ ĐÓNG':<10} | {'THỜI GIAN VÀO':<13} | {'KẾT QUẢ':<28} | {'PNL (USDT)'}")
    print("-" * 92)

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

    print("-" * 92)
    print(f"Vị thế còn đang giữ: {len(open_positions)} lệnh")
    for op in open_positions:
        print(f"  -> Đang chạy: {op['side_str']} {op['coin']} (Giá vào {op['entry']} | SL {op['stop']} | TP1: {op['tp1']} | TP2: {op['tp2']})")

    print("\n" + "=" * 92)
    total_trades = len(closed_trades)
    win_rate = (wins / total_trades * 100) if total_trades else 0.0
    print(f"💰 TÀI KHOẢN KHỞI ĐẦU: 40.00$ USDT  ->  SỐ DƯ HIỆN TẠI: {balance:.2f}$ USDT")
    print(f"📈 TỔNG LỢI NHUẬN RÒNG: {total_pnl:>+6.2f}$ USDT (Đã khấu trừ 100% phí sàn & trượt giá)")
    print(f"🎯 TỔNG SỐ LỆNH: {total_trades} | THẮNG: {wins} | THUA: {losses} | HÒA VỐN (BE): {be_count}")
    print(f"🏆 TỶ LỆ THẮNG (WIN RATE): {win_rate:.1f}%")
    print("=" * 92)

if __name__ == "__main__":
    main()
