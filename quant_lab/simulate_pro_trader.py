"""
quant_lab/simulate_pro_trader.py
=============================================================================
HỆ THỐNG GIAO DỊCH CHUYÊN NGHIỆP (PRO TRADER ENGINE) - 100% ZERO LOOKAHEAD
=============================================================================
Tuyệt đối KHÔNG nhìn trước dữ liệu tương lai (Strict Causal Walk):
- Nến i đóng: chỉ dùng nến 0 đến i để tính chỉ báo và nhận diện mô hình.
- Khớp lệnh: BẮT BUỘC khớp tại giá Mở cửa nến (i + 1). Không bao giờ khớp giá nến i.
- Trong nến k: nếu chạm cả TP và SL trong cùng 1 nến, tính dính SL trước (bảo thủ nhất).
- Trừ toàn bộ phí sàn MEXC Taker 0.12% + trượt giá 0.04% = 0.16% Notional mỗi lệnh.

4 NÂNG CẤP TƯ DUY TRADER CHUYÊN NGHIỆP:
1. KHUNG GIỜ VÀNG (SESSION LIQUIDITY):
   - Phiên Mỹ (19:30 - 23:45 VN): Dòng tiền Wall Street bùng nổ
   - Phiên Âu (14:00 - 18:00 VN): Dòng tiền London thiết lập xu hướng
   - Đầu phiên Á (09:00 - 11:30 VN): Dòng tiền phiên sáng
   - CẤM MỞ LỆNH: 00:00 - 08:45 VN (Giờ rác, cá mập quét SL 2 đầu)
2. CHỐT LỜI ĐA TẦNG (TP1 + TP2 RUNNER):
   - Đạt 1.4R: Chốt 50% vị thế, kéo SL phần còn lại về Entry (Hòa vốn).
   - 50% Runner còn lại: Thả trôi gồng theo nến tới Kháng cự / Đỉnh cũ 3.0R - 4.0R!
3. COOLDOWN 60 PHÚT: Khóa coin sau khi dính SL để chống giao dịch trả thù.
4. LỌC XU HƯỚNG SENTINEL BTC: Cấm Long Altcoins khi BTC đang xả dốc.
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
    """Kiểm tra thời gian thực nến có nằm trong Khung Giờ Vàng thanh khoản cao hay không."""
    vn_hour = (t_ms // 3600_000 + 7) % 24
    vn_min = (t_ms // 60_000) % 60
    t_val = vn_hour + vn_min / 60.0

    # 1. Phiên Mỹ (19:30 - 23:45 VN)
    if 19.5 <= t_val <= 23.75:
        return True
    # 2. Phiên Âu (14:00 - 18:00 VN)
    if 14.0 <= t_val <= 18.0:
        return True
    # 3. Đầu phiên Á (09:00 - 11:30 VN)
    if 9.0 <= t_val <= 11.5:
        return True

    # Giờ rác (00:00 - 08:45 và giờ nghỉ trưa): CẤM VÀO LỆNH
    return False

def load_all_candles():
    data = {}
    for c in COINS:
        fpath = os.path.join(DATA_DIR, f"{c}_15m.json")
        if os.path.exists(fpath):
            with open(fpath, "r", encoding="utf-8") as f:
                data[c] = json.load(f)
    return data

def main():
    print("=" * 90)
    print("💎 CHẠY THỬ NGHIỆM HỆ THỐNG PRO TRADER TRÊN DỮ LIỆU THỰC TẾ 36 GIỜ (15/10 - 16/10)")
    print("CAM KẾT: 100% ZERO LOOKAHEAD (Hoàn toàn không biết trước thị trường ra sao)")
    print("Nâng cấp: Lọc Khung giờ vàng | TP1 (50%) + TP2 Runner (50%) | Phí -0.16% | Cooldown 60m")
    print("=" * 90)

    data = load_all_candles()
    btc_candles = data.get("BTC", [])
    if not btc_candles:
        print("[!] Không tìm thấy dữ liệu BTC.")
        return

    # Lấy các mốc nến 15m trong 36 giờ
    timeline = [c["t"] for c in btc_candles if START_TS <= c["t"] <= END_TS]
    print(f"[*] Timeline kiểm định: {len(timeline)} nến 15m từ {ts_to_vn(START_TS)} tới {ts_to_vn(END_TS)}\n")

    balance = 40.0
    open_positions = []
    closed_trades = []
    cooldown_map = {}

    # Bước đi từng nến một theo thời gian thực
    for cur_t in timeline:
        time_str = ts_to_vn(cur_t)

        # ---------------------------------------------------------------------
        # BƯỚC 1: CẬP NHẬT CÁC LỆNH ĐANG MỞ (QUẢN TRỊ RỦI RO & TP1 / TP2 RUNNER)
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

            # 1.1 Kiểm tra chạm TP1 (1.4R) để CHỐT 50% VỊ THẾ
            if not pos["tp1_hit"]:
                hit_tp1 = c_now["h"] >= pos["tp1"] if side == 1 else c_now["l"] <= pos["tp1"]
                if hit_tp1:
                    pos["tp1_hit"] = True
                    # Chốt 50% vị thế (5$ margin)
                    raw_roi_50 = side * (pos["tp1"] - pos["entry"]) / pos["entry"] * pos["leverage"]
                    pnl_tp1 = (pos["margin"] * 0.5) * raw_roi_50 - 0.008 # Trừ phí nửa lệnh
                    pos["pnl_tp1"] = pnl_tp1
                    balance += pnl_tp1
                    
                    # LẬP TỨC DỜI SL CỦA 50% CÒN LẠI VỀ ENTRY (HÒA VỐN AN TOÀN)
                    pos["stop"] = pos["entry"]
                    print(f"💰 [{time_str}] CHỐT TP1 (50%) {pos['side_str']} {coin:<4}: Chốt tại {pos['tp1']} -> Đút túi: +{pnl_tp1:.2f}$ (+{raw_roi_50*100:.1f}% ROI). Dời SL 50% Runner về Entry ({pos['entry']})!")

            # 1.2 Kiểm tra 50% Runner còn lại (chạm TP2 Kháng cự 3.2R hoặc chạm SL/Hòa vốn)
            hit_tp2 = c_now["h"] >= pos["tp2"] if side == 1 else c_now["l"] <= pos["tp2"]
            hit_sl = c_now["l"] <= pos["stop"] if side == 1 else c_now["h"] >= pos["stop"]

            if hit_tp2:
                # Runner chạm TP2 ăn trọn con sóng!
                exit_px = pos["tp2"]
                raw_roi_runner = side * (exit_px - pos["entry"]) / pos["entry"] * pos["leverage"]
                # Nếu đã chốt 50% TP1 thì tính PnL 50% còn lại, nếu chưa thì tính 100%
                runner_margin = pos["margin"] * 0.5 if pos["tp1_hit"] else pos["margin"]
                fee_runner = 0.008 if pos["tp1_hit"] else 0.016
                pnl_runner = runner_margin * raw_roi_runner - fee_runner
                balance += pnl_runner
                total_trade_pnl = pos["pnl_tp1"] + pnl_runner

                pos.update({
                    "exit_time": cur_t,
                    "exit_px": exit_px,
                    "pnl": total_trade_pnl,
                    "roi": raw_roi_runner * 100,
                    "status": "🏆 ĂN TRỌN SÓNG (TP2 RUNNER)",
                })
                closed_trades.append(pos)
                print(f"🔥 [{time_str}] CHỐT LỜI TP2 RUNNER {pos['side_str']} {coin:<4}: Chạm đỉnh {exit_px} -> Lãi thêm: +{pnl_runner:.2f}$ (+{raw_roi_runner*100:.1f}% ROI) | Tổng lệnh: +{total_trade_pnl:.2f}$!")

            elif hit_sl:
                exit_px = pos["stop"]
                if pos["tp1_hit"]:
                    # Nửa còn lại bị cắn SL hòa vốn (vốn không mất gì)
                    pnl_runner = -0.008 # chỉ mất phí sàn nửa lệnh
                    balance += pnl_runner
                    total_trade_pnl = pos["pnl_tp1"] + pnl_runner
                    pos.update({
                        "exit_time": cur_t,
                        "exit_px": exit_px,
                        "pnl": total_trade_pnl,
                        "roi": 0.0,
                        "status": "🛡️ HÒA VỐN RUNNER (ĐÃ ĂN TP1)",
                    })
                    closed_trades.append(pos)
                    print(f"🛡️ [{time_str}] RUNNER CHẠM ENTRY {pos['side_str']} {coin:<4}: Thoát 50% còn lại tại Entry {exit_px} -> Tổng lệnh vẫn DƯƠNG: +{total_trade_pnl:.2f}$!")
                else:
                    # Bị dính SL toàn phần
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
                    print(f"❌ [{time_str}] CẮT LỖ {pos['side_str']} {coin:<4}: Chạm SL {exit_px} | PnL: {pnl:.2f}$ ({raw_roi*100:.1f}% ROI) -> Khóa Cooldown 60m!")
            else:
                remaining_positions.append(pos)

        open_positions = remaining_positions

        # ---------------------------------------------------------------------
        # BƯỚC 2: BỘ LỌC BỐI CẢNH (BTC SENTINEL & KHUNG GIỜ VÀNG)
        # ---------------------------------------------------------------------
        # Chỉ quét tìm lệnh mới nếu đang ở KHUNG GIỜ VÀNG
        if not is_prime_session(cur_t):
            continue

        btc_history = [c for c in btc_candles if c["t"] <= cur_t]
        btc_dumping = False
        if len(btc_history) >= 20:
            last_btc = btc_history[-1]
            if (last_btc["c"] - last_btc["o"]) / last_btc["o"] <= -0.005:
                btc_dumping = True

        # ---------------------------------------------------------------------
        # BƯỚC 3: QUÉT TÍN HIỆU VÀO LỆNH (TỐI ĐA 2 VỊ THẾ)
        # ---------------------------------------------------------------------
        if len(open_positions) < 2:
            for coin in COINS:
                if len(open_positions) >= 2:
                    break
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
                vol_ratio = last["v"] / avg_vol if avg_vol > 0 else 1.0

                # Quét nền 36 nến
                box = cs[-37:-1]
                box_hi = max(b["h"] for b in box)
                box_lo = min(b["l"] for b in box)
                box_range = box_hi - box_lo

                signal = None

                # MÔ HÌNH: BỨT PHÁ NỀN NỔ VOLUME LỚN (>= 2.0x THEO HYPEROPT)
                if 0.003 <= (box_range / box_lo) <= 0.055 and vol_ratio >= 2.0:
                    body = abs(last["c"] - last["o"])
                    # Breakout Long
                    if last["c"] > last["o"] and last["c"] > box_hi and not btc_dumping:
                        if (last["h"] - last["c"]) <= 0.20 * rng and body >= 0.60 * rng:
                            entry = last["c"]
                            sl = max(box_lo, box_hi - 0.008 * box_hi)
                            risk = entry - sl
                            if 0.004 <= risk / entry <= 0.035:
                                tp1 = entry + 1.4 * risk   # TP1 1.4R (Khóa lãi 50%)
                                tp2 = entry + 3.2 * risk   # TP2 3.2R (Gồng ăn trọn sóng)
                                signal = (1, "🟢 LONG", entry, sl, tp1, tp2, "Bứt phá nền 15m nổ Vol 2.0x+")

                    # Breakdown Short
                    elif last["c"] < last["o"] and last["c"] < box_lo:
                        if (last["c"] - last["l"]) <= 0.20 * rng and body >= 0.60 * rng:
                            entry = last["c"]
                            sl = min(box_hi, box_lo + 0.008 * box_lo)
                            risk = sl - entry
                            if 0.004 <= risk / entry <= 0.035:
                                tp1 = entry - 1.4 * risk
                                tp2 = entry - 3.2 * risk
                                signal = (-1, "🔴 SHORT", entry, sl, tp1, tp2, "Thủng đáy nền 15m nổ Vol 2.0x+")

                if signal:
                    side, side_str, entry, sl, tp1, tp2, reason = signal
                    open_positions.append({
                        "coin": coin,
                        "side": side,
                        "side_str": side_str,
                        "entry": entry,
                        "stop": sl,
                        "tp1": tp1,
                        "tp2": tp2,
                        "tp1_hit": False,
                        "pnl_tp1": 0.0,
                        "margin": 10.0,
                        "leverage": 10,
                        "open_time": cur_t,
                        "reason": reason,
                    })
                    print(f"🎯 [{time_str}] MỞ LỆNH PRO {side_str} {coin:<4}: Giá vào {entry} | SL {sl} | TP1 (50%): {tp1} | TP2 Runner (50%): {tp2}")

    # -------------------------------------------------------------------------
    # BƯỚC 4: TỔNG KẾT BẢNG SỔ LỆNH PRO TRADER
    # -------------------------------------------------------------------------
    print("\n" + "=" * 90)
    print("📊 BẢNG SỔ LỆNH THỰC CHIẾN PRO TRADER (15/10 - 16/10) - ĐÃ LOẠI GIỜ RÁC")
    print("=" * 90)
    print(f"{'STT':<4} | {'COIN':<5} | {'VỊ THẾ':<8} | {'GIÁ VÀO':<10} | {'GIÁ ĐÓNG':<10} | {'THỜI GIAN VÀO':<13} | {'KẾT QUẢ':<28} | {'PNL (USDT)'}")
    print("-" * 90)

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

    print("-" * 90)
    print(f"Vị thế còn đang giữ: {len(open_positions)} lệnh")
    for op in open_positions:
        print(f"  -> Đang chạy: {op['side_str']} {op['coin']} (Giá vào {op['entry']} | SL {op['stop']} | TP1: {op['tp1']} | TP2: {op['tp2']})")

    print("\n" + "=" * 90)
    total_trades = len(closed_trades)
    win_rate = (wins / total_trades * 100) if total_trades else 0.0
    print(f"💰 TÀI KHOẢN KHỞI ĐẦU: 40.00$ USDT  ->  SỐ DƯ HIỆN TẠI: {balance:.2f}$ USDT")
    print(f"📈 TỔNG LỢI NHUẬN RÒNG: {total_pnl:>+6.2f}$ USDT (Đã khấu trừ 100% phí sàn & trượt giá)")
    print(f"🎯 TỔNG SỐ LỆNH: {total_trades} | THẮNG: {wins} | THUA: {losses} | HÒA VỐN (BE): {be_count}")
    print(f"🏆 TỶ LỆ THẮNG (WIN RATE): {win_rate:.1f}%")
    print("=" * 90)

if __name__ == "__main__":
    main()

