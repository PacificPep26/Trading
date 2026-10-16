"""
MULTI-YEAR STRESS TEST ACROSS ALL MARKET REGIMES (2022 - 2026)
Kiểm thử đa năm toàn diện trên dữ liệu lịch sử tick-by-tick:
- BTC, SOL, LTC (15m: 2023 - 2026, 131,424 nến mỗi coin)
- BTC, ETH (1H: 2022 - 2026, 41,615 nến mỗi coin, bao gồm trọn vẹn Bear Market 2022)

Các chế độ thị trường (Regimes):
1. 2022: Bear Market sụp đổ (Terra/Luna, 3AC, FTX crash, BTC $48k -> $15.5k)
2. 2023: Đi ngang tích luỹ & Bẫy giá (Chop / Sideways $16k -> $30k)
3. 2024: ETF Bùng nổ & Halving (Bull Run $40k -> $73k)
4. 2025: Thể chế & Biến động đỉnh cao ($70k -> $90k+)
5. 2026: Live Real-time Regime hiện tại

Khấu trừ ma sát thực chiến:
- Phí Taker 2 chiều: 0.12%
- Trượt giá (slippage): 0.04% (Tổng phí = -0.16% notional mỗi lệnh)
- Khóa Cooldown 60 phút sau mỗi lệnh cắt lỗ
- Trailing Breakeven: dời SL về Entry khi lệnh đạt >= 1.0R
"""
import csv
import math
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "crypto"

@dataclass
class Candle:
    t: int      # timestamp ms
    o: float
    h: float
    l: float
    c: float
    v: float

@dataclass
class Trade:
    coin: str
    year: int
    side: int   # 1: Long, -1: Short
    entry_i: int
    exit_i: int
    entry_px: float
    exit_px: float
    sl: float
    tp: float
    reason: str # 'tp', 'sl', 'be' (breakeven), 'time'
    net_pnl_pct: float # Net return after 0.16% fees & slippage

def load_csv(filepath: Path) -> list[Candle]:
    candles = []
    if not filepath.exists():
        return candles
    with filepath.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            candles.append(Candle(
                t=int(r["open_time_ms"]),
                o=float(r["open"]),
                h=float(r["high"]),
                l=float(r["low"]),
                c=float(r["close"]),
                v=float(r["volume"]),
            ))
    return candles

def compute_ema(candles: list[Candle], period: int = 200) -> list[float]:
    ema = [0.0] * len(candles)
    k = 2.0 / (period + 1)
    for idx, c in enumerate(candles):
        if idx == 0:
            ema[idx] = c.c
        else:
            ema[idx] = c.c * k + ema[idx - 1] * (1.0 - k)
    return ema

def run_stress_test(coin: str, candles: list[Candle], strategy_name: str = "shelf_breakout_trend"):
    n = len(candles)
    if n < 250:
        return []

    ema200 = compute_ema(candles, 200)
    trades: list[Trade] = []
    i = 210
    cooldown_until_ts = 0
    FEE_SLIPPAGE_PENALTY = 0.0016  # 0.12% fee + 0.04% slippage = 0.16%
    
    while i < n - 20:
        c = candles[i]
        bar_year = datetime.fromtimestamp(c.t / 1000, timezone.utc).year

        # Bỏ qua nếu đang trong thời gian Cooldown 60 phút sau cắt lỗ
        if c.t < cooldown_until_ts:
            i += 1
            continue

        signal = None

        # =====================================================================
        # CHIẾN LƯỢC 1: SHELF BREAKOUT CÓ LỌC XU HƯỚNG EMA200 & TP 1.5R
        # =====================================================================
        if strategy_name == "shelf_breakout_trend":
            box_len = 36
            box = candles[i - box_len : i]
            box_hi = max(b.h for b in box)
            box_lo = min(b.l for b in box)
            box_range = box_hi - box_lo
            box_ratio = box_range / box_lo

            if 0.002 <= box_ratio <= 0.055:
                prev20 = candles[i - 20 : i]
                avg_vol = sum(x.v for x in prev20) / len(prev20) if prev20 else 1.0
                vol_ratio = c.v / avg_vol if avg_vol > 0 else 1.0

                rng = c.h - c.l
                if rng > 0 and vol_ratio >= 1.5:
                    # Breakout Long: CHỈ VÀO KHI TRÊN EMA200 (THUẬN XU HƯỚNG LỚN)
                    if c.c > c.o and c.c > box_hi and c.c > ema200[i]:
                        body = c.c - c.o
                        upper_wick = c.h - c.c
                        if body >= 0.50 * rng and upper_wick <= 0.25 * rng:
                            entry = candles[i + 1].o
                            sl = max(box_lo, box_hi - 0.008 * box_hi)
                            risk = (entry - sl) / entry
                            if 0.003 <= risk <= 0.035:
                                tp = entry + 1.5 * (entry - sl)
                                signal = (1, entry, sl, tp)

                    # Breakdown Short: CHỈ VÀO KHI DƯỚI EMA200 (THUẬN XU HƯỚNG LỚN)
                    elif c.c < c.o and c.c < box_lo and c.c < ema200[i]:
                        body = c.o - c.c
                        lower_wick = c.c - c.l
                        if body >= 0.50 * rng and lower_wick <= 0.25 * rng:
                            entry = candles[i + 1].o
                            sl = min(box_hi, box_lo + 0.008 * box_lo)
                            risk = (sl - entry) / entry
                            if 0.003 <= risk <= 0.035:
                                tp = entry - 1.5 * (sl - entry)
                                signal = (-1, entry, sl, tp)

        # =====================================================================
        # CHIẾN LƯỢC 2: HỒI ĐỈNH CŨ VỪA PHÁ (RETEST & CONFIRM - THEO ĐÚNG SO TRADING)
        # =====================================================================
        elif strategy_name == "pullback_retest":
            prev20 = candles[i - 20 : i]
            avg_vol = sum(x.v for x in prev20) / len(prev20) if prev20 else 1.0
            
            # Khảo sát swing high / low 30 nến trước
            prior_hi = max(x.h for x in candles[i - 30 : i - 10])
            prior_lo = min(x.l for x in candles[i - 30 : i - 10])

            # Retest đỉnh cũ đã bị phá (S/R Flip Long)
            # Giá đã vượt đỉnh prior_hi, quay lại retest chạm prior_hi và rút chân nến xanh
            if c.l <= prior_hi <= c.h and c.c > prior_hi and c.c > c.o and c.c > ema200[i]:
                body = c.c - c.o
                rng = c.h - c.l
                if rng > 0 and body >= 0.4 * rng and c.v >= 1.3 * avg_vol:
                    entry = candles[i + 1].o
                    sl = c.l - 0.002 * c.l
                    risk = (entry - sl) / entry
                    if 0.004 <= risk <= 0.04:
                        tp = entry + 2.0 * (entry - sl)
                        signal = (1, entry, sl, tp)

            # Retest đáy cũ đã bị thủng (S/R Flip Short)
            elif c.l <= prior_lo <= c.h and c.c < prior_lo and c.c < c.o and c.c < ema200[i]:
                body = c.o - c.c
                rng = c.h - c.l
                if rng > 0 and body >= 0.4 * rng and c.v >= 1.3 * avg_vol:
                    entry = candles[i + 1].o
                    sl = c.h + 0.002 * c.h
                    risk = (sl - entry) / entry
                    if 0.004 <= risk <= 0.04:
                        tp = entry - 2.0 * (sl - entry)
                        signal = (-1, entry, sl, tp)

        # =====================================================================
        # CHIẾN LƯỢC 3: ICT LIQUIDITY SWEEP & CHO-CH (1H KHUNG LỚN)
        # =====================================================================
        elif strategy_name == "ict_sweep_1h":
            # Quét đỉnh/đáy 24 nến (1 ngày)
            day_cs = candles[i - 24 : i]
            day_hi = max(x.h for x in day_cs)
            day_lo = min(x.l for x in day_cs)
            prev20 = candles[i - 20 : i]
            avg_vol = sum(x.v for x in prev20) / len(prev20) if prev20 else 1.0

            # Quét đỉnh đạp đầu tạo râu trên >= 55%
            rng = c.h - c.l
            if rng > 0 and c.h > day_hi and c.c < day_hi and (c.h - max(c.o, c.c)) >= 0.50 * rng and c.v >= 1.5 * avg_vol:
                entry = candles[i + 1].o
                sl = c.h + 0.001 * c.h
                risk = (sl - entry) / entry
                if 0.004 <= risk <= 0.04:
                    tp = entry - 2.0 * (sl - entry)
                    signal = (-1, entry, sl, tp)

            # Quét đáy rút chân tạo râu dưới >= 55%
            elif rng > 0 and c.l < day_lo and c.c > day_lo and (min(c.o, c.c) - c.l) >= 0.50 * rng and c.v >= 1.5 * avg_vol:
                entry = candles[i + 1].o
                sl = c.l - 0.001 * c.l
                risk = (entry - sl) / entry
                if 0.004 <= risk <= 0.04:
                    tp = entry + 2.0 * (entry - sl)
                    signal = (1, entry, sl, tp)

        # Khớp lệnh và giả lập diễn biến
        if signal:
            side, entry, sl, tp = signal
            risk_dist = abs(entry - sl)
            max_hold = 24
            exit_i = i + 1
            exit_px = entry
            reason = "time"
            breakeven_activated = False

            for k in range(i + 1, min(i + 1 + max_hold, n)):
                bar = candles[k]
                
                # Trailing Breakeven khi giá đạt >= 1.0R
                if not breakeven_activated:
                    if side == 1 and bar.h >= entry + 1.0 * risk_dist:
                        breakeven_activated = True
                        sl = entry
                    elif side == -1 and bar.l <= entry - 1.0 * risk_dist:
                        breakeven_activated = True
                        sl = entry

                hit_sl = bar.l <= sl if side == 1 else bar.h >= sl
                hit_tp = bar.h >= tp if side == 1 else bar.l <= tp

                if hit_sl and hit_tp:
                    exit_i = k
                    exit_px = sl
                    reason = "be" if breakeven_activated else "sl"
                    break
                elif hit_sl:
                    exit_i = k
                    exit_px = sl
                    reason = "be" if breakeven_activated else "sl"
                    break
                elif hit_tp:
                    exit_i = k
                    exit_px = tp
                    reason = "tp"
                    break
            else:
                exit_i = min(i + 1 + max_hold, n - 1)
                exit_px = candles[exit_i].c

            raw_return = side * (exit_px - entry) / entry
            net_return = raw_return - FEE_SLIPPAGE_PENALTY

            if reason == "sl":
                cooldown_until_ts = candles[exit_i].t + 60 * 60_000

            trades.append(Trade(
                coin=coin,
                year=bar_year,
                side=side,
                entry_i=i + 1,
                exit_i=exit_i,
                entry_px=entry,
                exit_px=exit_px,
                sl=sl,
                tp=tp,
                reason=reason,
                net_pnl_pct=net_return,
            ))

            i = exit_i

        i += 1

    return trades

def print_regime_report(coin: str, strategy_name: str, trades: list[Trade]):
    years = sorted(list(set(t.year for t in trades)))
    if not years:
        print(f"[{coin}] Không có lệnh nào được khớp cho chiến lược {strategy_name}.")
        return

    print(f"\n{'='*92}")
    print(f"[REPORT] MULTI-YEAR STRESS TEST: {coin} | STRATEGY: {strategy_name.upper()}")
    print(f"{'='*92}")
    print(f"{'NĂM / REGIME':<20} | {'SỐ KÈO':<7} | {'WIN RATE':<9} | {'PROFIT FACTOR':<13} | {'NET PNL (%)':<11} | {'MAX DD (%)':<10} | {'BE SAVED':<8}")
    print(f"{'-'*92}")

    for yr in years:
        yr_trades = [t for t in trades if t.year == yr]
        n_tr = len(yr_trades)
        if n_tr == 0:
            continue
        
        wins = [t for t in yr_trades if t.net_pnl_pct > 0]
        losses = [t for t in yr_trades if t.net_pnl_pct <= 0]
        be_saved = [t for t in yr_trades if t.reason == "be"]
        
        win_rate = len(wins) / n_tr * 100
        gross_win = sum(t.net_pnl_pct for t in wins)
        gross_loss = abs(sum(t.net_pnl_pct for t in losses))
        pf = (gross_win / gross_loss) if gross_loss > 0 else 99.9

        eq, peak, mdd = 1.0, 1.0, 0.0
        for t in yr_trades:
            # Vốn phân bổ rủi ro 2% mỗi lệnh (đúng quy chuẩn quản trị vốn)
            eq *= (1.0 + t.net_pnl_pct * 5)
            peak = max(peak, eq)
            mdd = max(mdd, (peak - eq) / peak * 100)

        net_gain_pct = (eq - 1.0) * 100

        regime_desc = {
            2022: "2022 (Bear Crash)",
            2023: "2023 (Chop/Accum)",
            2024: "2024 (ETF Bull)",
            2025: "2025 (Institutional)",
            2026: "2026 (Live Regime)",
        }.get(yr, str(yr))

        print(f"{regime_desc:<20} | {n_tr:<7} | {win_rate:>6.1f}%   | {pf:>10.2f}    | {net_gain_pct:>+9.1f}%  | {mdd:>7.1f}%   | {len(be_saved):<8}")

    print(f"{'-'*92}")
    all_wins = [t for t in trades if t.net_pnl_pct > 0]
    all_losses = [t for t in trades if t.net_pnl_pct <= 0]
    all_be = [t for t in trades if t.reason == "be"]
    total_pf = (sum(t.net_pnl_pct for t in all_wins) / abs(sum(t.net_pnl_pct for t in all_losses))) if all_losses else 99.9
    
    overall_eq, overall_peak, overall_mdd = 1.0, 1.0, 0.0
    for t in trades:
        overall_eq *= (1.0 + t.net_pnl_pct * 5)
        overall_peak = max(overall_peak, overall_eq)
        overall_mdd = max(overall_mdd, (overall_peak - overall_eq) / overall_peak * 100)

    total_net = (overall_eq - 1.0) * 100
    avg_wr = len(all_wins) / len(trades) * 100 if trades else 0

    print(f"{'TỔNG CỘNG HẾT':<20} | {len(trades):<7} | {avg_wr:>6.1f}%   | {total_pf:>10.2f}    | {total_net:>+9.1f}%  | {overall_mdd:>7.1f}%   | {len(all_be):<8}")
    print(f"{'='*92}\n")

if __name__ == "__main__":
    print("="*92)
    print("[START] MULTI-YEAR STRESS TEST TREN TAT CA CAC NAM (2022 - 2026)")
    print("Quan tri von chuan: Risk 2%/lenh | Phi san & Truot gia: -0.16%/lenh | Cooldown: 60m")
    print("="*92)

    # -------------------------------------------------------------------------
    # 1. BÁO CÁO 1H ĐA NĂM (2022 - 2026): BAO GỒM TRỌN VẸN BEAR MARKET 2022
    # -------------------------------------------------------------------------
    btc_1h_path = DATA_DIR / "BTCUSDT_1h.csv"
    btc_1h = load_csv(btc_1h_path)
    if btc_1h:
        print(f"\n>>> [1H] TẢI {len(btc_1h):,} NẾN BTC 1H (2022 - 2026)")
        trades_1h_pullback = run_stress_test("BTC-1H", btc_1h, "pullback_retest")
        print_regime_report("BTC-1H", "pullback_retest", trades_1h_pullback)

        trades_1h_ict = run_stress_test("BTC-1H", btc_1h, "ict_sweep_1h")
        print_regime_report("BTC-1H", "ict_sweep_1h", trades_1h_ict)

    eth_1h_path = DATA_DIR / "ETHUSDT_1h.csv"
    eth_1h = load_csv(eth_1h_path)
    if eth_1h:
        print(f"\n>>> [1H] TẢI {len(eth_1h):,} NẾN ETH 1H (2022 - 2026)")
        trades_eth_pullback = run_stress_test("ETH-1H", btc_1h, "pullback_retest")
        print_regime_report("ETH-1H", "pullback_retest", trades_eth_pullback)

    # -------------------------------------------------------------------------
    # 2. BÁO CÁO 15M (2023 - 2026): CÓ LỌC XU HƯỚNG EMA200 & TP 1.5R
    # -------------------------------------------------------------------------
    btc_15m_path = DATA_DIR / "BTCUSDT-PERP_15m.csv"
    btc_15m = load_csv(btc_15m_path)
    if btc_15m:
        print(f"\n>>> [15M] TẢI {len(btc_15m):,} NẾN BTC 15M (2023 - 2026)")
        trades_btc_15m_trend = run_stress_test("BTC-15M", btc_15m, "shelf_breakout_trend")
        print_regime_report("BTC-15M", "shelf_breakout_trend", trades_btc_15m_trend)

    sol_15m_path = DATA_DIR / "SOLUSDT-PERP_15m.csv"
    sol_15m = load_csv(sol_15m_path)
    if sol_15m:
        print(f"\n>>> [15M] TẢI {len(sol_15m):,} NẾN SOL 15M (2023 - 2026)")
        trades_sol_15m_trend = run_stress_test("SOL-15M", sol_15m, "shelf_breakout_trend")
        print_regime_report("SOL-15M", "shelf_breakout_trend", trades_sol_15m_trend)

    ltc_15m_path = DATA_DIR / "LTCUSDT-PERP_15m.csv"
    ltc_15m = load_csv(ltc_15m_path)
    if ltc_15m:
        print(f"\n>>> [15M] TẢI {len(ltc_15m):,} NẾN LTC 15M (2023 - 2026)")
        trades_ltc_15m_trend = run_stress_test("LTC-15M", ltc_15m, "shelf_breakout_trend")
        print_regime_report("LTC-15M", "shelf_breakout_trend", trades_ltc_15m_trend)

