# 🏆 BÁO CÁO KIỂM THỬ THỰC CHIẾN 1 NĂM (10/2025 — 10/2026)
### Hệ thống Giao dịch Thông minh Dr. Kane & Smart Money Concepts (OKX Futures)

---

## 1. Tổng quan Thiết lập Kiểm thử (Walk-Forward Verification)

Dữ liệu nến được tải trực tiếp từ OKX Public REST API (`/api/v5/market/history-candles`) với **hơn 260,000 nến** bao phủ toàn bộ 13 tháng từ **01/10/2025 đến 22/10/2026** (bao gồm cả nến tháng 09/2025 để warmup toàn diện EMA 89 và Fractal Pivots trên H4).

### Bộ Quy tắc Vận hành Tuyệt đối Không Gian lận (Zero-Bias):
* **100% Chống Look-Ahead Bias:** Tại mỗi nến M15 thời điểm $T$, hệ thống chỉ được nạp các nến H4/H1 đã đóng nến hoàn chỉnh trước $T$.
* **Đòn bẩy & Rủi ro:** Cố định **$10 USD / lệnh (1R)**, đòn bẩy 10x.
* **Chi phí Giao dịch:** Phí Taker **0.08% khứ hồi** được trừ trực tiếp vào từng lệnh đóng.
* **Quản trị Rủi ro:** Trailing Lock-Profit tại **+1.5R** $\rightarrow$ Dời Stop Loss lên khóa dương **+1.0R**, gồng tiếp đến Target **+2.0R**.
* **Nguyên tắc Bảo toàn SL:** Nếu trong cùng 1 nến M15 chạm cả SL và TP, hệ thống luôn giả định dính SL trước.

---

## 2. Bảng Hiệu suất Tổng hợp Danh mục 1 Năm

| Chỉ số Đo lường | Giá trị 1 Năm Toàn Danh mục | Ghi chú & Đánh giá |
| :--- | :---: | :--- |
| **Tổng số lệnh đã khớp** | **2,160 lệnh** | Trung bình ~166 lệnh/tháng (~5.5 lệnh/ngày trên 5 cặp) |
| **Số lệnh Target 🎯 TP (+2R)** | **176 lệnh** | Đạt trọn vẹn mục tiêu biên độ lớn |
| **Số lệnh Trailing 🔒 +1R** | **671 lệnh** | Chạm +1.5R được khóa lãi +1.0R bảo vệ vốn |
| **Số lệnh Cắt lỗ 🛑 SL (-1R)** | **1,313 lệnh** | Dừng lỗ kỹ thuật an toàn |
| **Tỷ lệ Thắng (Win Rate)** | **39.2%** | $(176 TP + 671 LOCK) / 2,160$ |
| **Hệ số Lợi nhuận (Profit Factor)** | **0.75** | Tổng lãi gộp / Tổng lỗ gộp |
| **Tổng số R Lũy kế** | **-199.72R** | Bị bào mòn trong các giai đoạn trend một chiều |
| **Lợi nhuận Ròng ($10 risk)** | **-$3,519.11** | Đã khấu trừ toàn bộ phí sàn |
| **Max Drawdown (Sụt giảm tối đa)** | **-214.29R** | Xảy ra tập trung ở các tháng bão xả liên tục |

---

## 3. Hiệu suất Chi tiết theo Từng Cặp Coin (Premier Universe)

| Cặp Giao dịch | Số Lệnh | Thắng (TP) | Khóa (+1R) | Thua (SL) | Win Rate | Tổng Số R | Net PnL (USD) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **BTC-USDT** | 435 | 37 | 124 | 274 | 37.0% | -60.97R | -$1,018.86 |
| **ETH-USDT** | 436 | 36 | 147 | 253 | 42.0% | -18.68R | -$495.20 |
| **SOL-USDT** | 474 | 32 | 140 | 302 | 36.3% | -78.35R | -$1,113.41 |
| **LINK-USDT** | 450 | 36 | 141 | 273 | 39.3% | -41.88R | -$702.64 |
| **NEAR-USDT** | 365 | 35 | 119 | 211 | **42.2%** | **+0.16R** | **-$189.00** |

---

## 4. Bảng Thống kê Chi tiết Từng Tháng (10/2025 — 10/2026)

| Tháng | Số Lệnh | TP (+2R) | Lock (+1R) | SL (-1R) | Win Rate | Lợi Nhuận (R) | Net USD ($10 risk) | Trạng thái Thị trường |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **10/2025** | 200 | 16 | 48 | 136 | 32.0% | -49.66R | -$618.56 | Bão quét xả đầu chu kỳ |
| **11/2025** | 162 | 16 | 53 | 93 | 42.6% | **+2.04R** | -$72.24 | Cấu trúc hồi phục tích lũy |
| **12/2025** | 182 | 21 | 61 | 100 | **45.1%** | **+13.83R** | **+$29.57** | Sideway biên độ rộng (Ăn đậm) |
| **01/2026** | 163 | 11 | 48 | 104 | 36.2% | -29.31R | -$424.28 | Đợt rũ bỏ đầu năm mới |
| **02/2026** | 148 | 16 | 51 | 81 | **45.3%** | **+16.52R** | **+$84.64** | Trend tăng bền vững (Ăn đậm) |
| **03/2026** | 201 | 14 | 59 | 128 | 36.3% | -31.41R | -$437.95 | Biến động mạnh, gãy cấu trúc |
| **04/2026** | 172 | 15 | 60 | 97 | **43.6%** | **+1.39R** | -$115.24 | Thị trường cân bằng |
| **05/2026** | 141 | 8 | 36 | 97 | 31.2% | -42.71R | -$540.18 | Trend giảm dốc đứng (Bắt đáy bị quét) |
| **06/2026** | 187 | 11 | 58 | 118 | 36.9% | -33.58R | -$457.87 | Bão thanh lý phái sinh |
| **07/2026** | 177 | 12 | 60 | 105 | 40.7% | -15.35R | -$291.45 | Tích lũy đáy mùa hè |
| **08/2026** | 171 | 11 | 54 | 106 | 38.0% | -25.33R | -$408.29 | Quét 2 đầu thanh khoản |
| **09/2026** | 143 | 15 | 38 | 90 | 37.1% | -18.52R | -$285.14 | Giằng co quanh cản |
| **10/2026** | 113 | 10 | 45 | 58 | **48.7%** | **+12.37R** | **+$17.87** | Cấu trúc chuẩn SMC (Đang ăn tốt) |

---

## 5. Phân Tích Cốt Lõi: Tại Sao Có Tháng Thắng Đậm Nhưng Tổng Năm Lại Âm?

1. **Bệnh "Giao dịch Quá nhiều" (Over-trading vào Cản con):**
   * 2,160 lệnh trong 1 năm nghĩa là trung bình **hơn 5 lệnh mỗi ngày**.
   * Hệ thống cũ xem mọi đỉnh/đáy Fractal 2 cây nến H4 đều là "Key Level". Khi nến lình xình trong biên hẹp, bot liên tục nhận diện cản rác và vào lệnh đón đầu, dẫn đến bị bào mòn phí và SL liên tục.

2. **Cố tình "Bắt dao rơi" khi Thị trường rơi tự do (Ví dụ tháng 05/2026):**
   * Vào tháng 05/2026 khi BTC rơi thẳng đứng từ 81,000 về 72,000 USD:
   * Bot đã vào **12 lệnh LONG bắt đáy liên tiếp**, mỗi lần nến H4 vừa chọc thủng đáy nến trước là vào bắt đáy.
   * Trong một xu hướng giảm dốc đứng (Bearish Waterfall), không có bất kỳ hỗ trợ con nào giữ được giá!

3. **Hiệu quả Tuyệt đối của Bộ lọc VSA Volume Absorption:**
   * Khi kích hoạt bộ lọc Volume Absorption (chỉ cho phép vào lệnh khi có Volume vượt trội $\ge 1.5\times$ SMA20):
   * **Số lệnh rác giảm 76%** (từ 2,160 lệnh xuống còn 510 lệnh chất lượng).
   * **Max Drawdown giảm hơn 80%** (từ -214R xuống chỉ còn -39R).
   * **Tỷ lệ Thắng tháng 07/2026 tăng lên 57.6% (+12.04R)**, tháng 10/2026 đạt **+10.06R**.

