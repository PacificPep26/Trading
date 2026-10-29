# AUDIT FIX TRACKING — Sửa 4 lỗi tính đúng đắn (28/10/2026)

> Theo dõi việc sửa 4 lỗi do 2 bản đánh giá AI độc lập + tự kiểm chứng code phát
> hiện. Các số backtest cũ (PF 1.70 / +106.18R) BỊ THỔI PHỒNG do các lỗi này.
> Mục tiêu: sửa đúng → chạy lại → có SỐ THẬT trước khi làm bất cứ gì khác.

## Baseline TRƯỚC khi sửa (số cũ, đã biết là sai/thổi phồng)
- 1 năm: 212 lệnh, PF 1.70, +74.68R, Max DD -13.18R
- Đa năm 2021-2026: 816 lệnh, PF 1.24, +106.18R, Max DD -42.03R

## Mô hình phí dùng khi sửa (A2) — chốt với người dùng: Taker 2 chiều + slippage
- Vào lệnh: Taker (breakout M15 = market thực tế) = 0.08%
  *(Hỗ trợ thêm cờ `cfg.entryAsMaker=true` để kiểm tra cận trên lạc quan 0.02% nếu khớp Limit Post-Only)*
- Thoát SL / LOCK (stop market): Taker + slippage 0.03% = 0.11%
- Thoát TP (limit chờ tại target): Maker = 0.02%
- Thoát TIME_STOP (market close): Taker = 0.08%
- Quy ra R: `feeR = feeUsd / riskUsd`, `netR = grossR - feeR` (netR & netUsd cùng cơ sở)

---

## BẢNG TIẾN ĐỘ

| Mã | Lỗi | File | Trạng thái | Ghi chú |
|---|---|---|---|---|
| A1 | Entry Delay look-ahead | `scripts/backtest_1year.mjs` | ✅ | Đã thêm `i += delayBars` sau entry, loại bỏ hoàn toàn look-ahead |
| A2 | Phí 1 chiều + netR không trừ phí | `scripts/backtest_1year.mjs` | ✅ | Taker 2 chiều + slippage, netR trừ feeR nhất quán |
| A3 | Breaker mitigation sai giao cắt | `src/indicators.js:1065,1081` | ✅ | `c.high>=bottom && c.low<=top` (live + backtest + 1 unit test) |
| A4 | News bypass bởi pending | `src/server.js` | ✅ | Check `isNewsBlackout` trong `processPendingSignals` |
| A5 | Verify + chạy lại + ghi số thật | Toàn bộ hệ thống | ✅ | `npm check` 95 PASS, single-run PASS, đã chạy backtest 1y & đa năm |

Trạng thái: ⬜ chưa làm · 🔄 đang làm · ✅ xong

---

## SỐ LIỆU SAU KHI SỬA (KẾT QUẢ A5)

### 1. Kiểm thử 1 năm gần nhất (10/2025 -> 10/2026)
| Kịch bản | Lệnh | Win Rate | Profit Factor | Tổng R | Net PnL ($10/R) | Max DD |
|---|---|---|---|---|---|---|
| **Cũ (thổi phồng)** | 212 | 52.4% | **1.70** | +74.68R | +$715.00 | -13.18R |
| **Thật - Bảo thủ (Vào Taker 0.08%)** | 211 | 51.2% | **1.39** | **+47.52R** | **+$474.83** | **-16.97R** |
| **Thật - Lạc quan (Vào Maker 0.02%)** | 211 | 51.2% | **1.49** | **+56.85R** | **+$568.07** | **-18.37R** |

### 2. Kiểm thử đa năm (2021 -> 2026)
| Giai đoạn | Lệnh | Win Rate (Taker) | PF (Taker) | Tổng R (Taker) | PF (Maker) | Tổng R (Maker) |
|---|---|---|---|---|---|---|
| 2021 (Bull mạnh) | 42 | 26.2% | 0.91 | -2.78R | 0.96 | -1.26R |
| 2022 (Bear mạnh / Luna-FTX) | 95 | 29.5% | 1.01 | +0.79R | 1.09 | +4.62R |
| **2023 (Tích luỹ / Sideway)** | 215 | 18.6% | **0.65** | **-57.59R** | **0.70** | **-46.87R** |
| 2024 (Bull trở lại) | 140 | 25.7% | 1.08 | +7.27R | 1.15 | +13.50R |
| **2025 - 2026 (Hiện tại)** | 322 | 31.7% | **1.27** | **+51.94R** | **1.36** | **+66.07R** |
| **TỔNG TOÀN BỘ (5 NĂM)** | 814 | 26.7% | **1.00** | **-0.37R** | **1.07** | **+36.06R** |

---

## QUYẾT ĐỊNH DEPLOY (29/10, người dùng chọn phương án A)
- **Push CHỈ fix A1-A4 (tính đúng đắn). Tắt mặc định TOÀN BỘ Phase C** vì chưa
  test out-of-sample. Giữ nguyên code Phase C, chỉ gate sau flag mặc định TẮT:
  `enableDynamicNatr`, `enableWeeklyCircuitBreaker`, `enableFreeRollPyramiding`,
  `enableBucketAllocation` (directional cap + 3-bucket), `enable12hRS` (quality
  score dùng lại RS baseline 1 nến H1). Bật lại bằng env=true khi đã kiểm chứng.
- Lý do: năm nay (2025-2026) biến động, bot có edge thật ở chế độ này; các
  defense 2023 (NATR/circuit breaker) có thể làm bot đánh ít hơn, chưa cần.
- Xác nhận sau gating: backtest 1 năm PF 1.42 / +50.05R (≈ baseline A1-A4
  honest, chênh nhẹ do A3 breaker fix loại đúng vài kèo). 103 unit test PASS.

## KẾT LUẬN GIAI ĐOẠN B (ĐÁNH GIÁ TRUNG THỰC VỀ EDGE)

1. **Edge có thật hay không?**
   - **Có Edge rõ rệt trong 2 năm gần nhất (2024-2026):** Trong 1 năm qua, PF thực tế đạt **1.39** (bảo thủ) đến **1.49** (lạc quan), sinh lời **+47.5R đến +56.8R**. Kể cả tính từ đầu 2025 tới nay (322 lệnh), PF đạt **1.27 - 1.36** (+52R đến +66R).
   - **Nhưng hệ thống chưa vượt qua bài test toàn chu kỳ (Full Cycle):** Nếu tính trọn 5 năm, hệ thống chỉ hòa vốn (-0.37R nếu vào Taker, +36R nếu vào Maker).
2. **Nguyên nhân tử huyệt duy nhất: Năm 2023 (-57.59R / 215 lệnh)**
   - Năm 2023 là mùa đông thanh khoản cạn kiệt, biên độ co hẹp (Chop/Sideway kéo dài). Chiến lược breakout/pullback H4 bị dính hàng loạt false break (bào mòn phí Taker và dính SL).
   - Nếu thị trường rơi vào giai đoạn giống 2023, hệ thống hiện tại sẽ bị sụt giảm vốn rất nặng nếu không có bộ lọc nhận diện chu kỳ thanh khoản vĩ mô.
3. **Đề xuất bước tiếp theo:**
   - **Chưa chuyển sang tiền thật (Giai đoạn C hoãn lại)** cho đến khi giải quyết được rủi ro "bị vắt kiệt" trong môi trường thanh khoản thấp kiểu 2023, hoặc có cơ chế cắt giảm giao dịch khi thị trường đi vào vùng biến động chết.
   - Tiếp tục chạy Paper Trading trên Railway để theo dõi PnL thực tế với các sửa đổi A1-A4 vừa xong.
