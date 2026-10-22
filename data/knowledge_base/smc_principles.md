# SMART MONEY CONCEPTS (SMC) & LIQUIDITY ENGINEERING MANUAL
*Tài liệu nguyên lý thanh khoản phục vụ AI Market Researcher & Quant Engine*

---

## 1. Bản chất Thị trường: Cuộc săn Thanh khoản (Liquidity Hunts)
Thị trường tài chính không vận hành ngẫu nhiên mà được dẫn dắt bởi Smart Money (Cá mập, Market Makers, Quỹ định lượng).
- Để Cá mập khớp được một khối lượng **SHORT khổng lồ**, họ bắt buộc cần khối lượng **BUY đối ứng**.
- Khối lượng BUY đối ứng nằm ở đâu?
  1. Lệnh **Stop Loss của đám đông Retail đang ôm Short** (SL lệnh Short là lệnh Buy Stop tại thị trường).
  2. Lệnh **Buy Stop Breakout** của Retail trader đánh phá đỉnh.
- Vì vậy, trước mỗi đợt xả lớn, Market Maker LUÔN LUÔN tạo bẫy tâm lý để đám đông Short sớm tại cản yếu, rồi đẩy một cú nổ von xuyên đỉnh để "quét sạch Stop Loss" (Liquidity Sweep) nhằm khớp toàn bộ vị thế Short với giá hời nhất (Premium).

---

## 2. Phân Cấp 2 Tầng Thanh Khoản (The 2-Tier Liquidity Model)

### Tầng 1: Inducement Zone (Cản con / Bẫy Thanh khoản - Equal Highs/Lows)
- **Đặc điểm:** Giá tạo 2-3 đỉnh/đáy bằng nhau hoặc gần nhau trong phạm vi 0.5% - 1.0% ở khung ngắn hạn.
- **Tâm lý đám đông:** Đám đông Retail nhìn vào thấy "quét râu nhiều lần không thủng" -> tin rằng đây là cản bê tông vững chắc -> Đặt Limit Short và kéo SL ngay sát đỉnh 0.3% - 0.5%.
- **Hành vi Cá mập:** Tạo ra sự tự tin giả tạo cho Retail, sau đó đẩy nến nổ von (thường vào các khung giờ giao phiên như 19:00 VN) xuyên qua cản con.
- **Quy tắc Quant Bot:** **TUYỆT ĐỐI KHÔNG BẮT ĐỈNH TẠI ĐÂY!** Nếu bot phát hiện vùng Equal Highs chưa bị quét, cấm vào lệnh Short dò đỉnh.

### Tầng 2: Major Key Level (Cản Lớn Cấu Trúc / Institutional Zone)
- **Đặc điểm:** Đỉnh/đáy khung lớn H4/D1 được hình thành từ trước đó nhiều ngày (nhìn lại 30 - 90 nến H4).
- **Hành vi Cá mập:** Dùng đà quét thanh khoản từ Tầng 1 để phi thẳng lên Tầng 2, kích hoạt lệnh bán quy mô tổ chức.
- **Quy tắc Quant Bot:** **ĐIỂM VÀO VÀNG CỦA SMART MONEY.** Khi giá đã đâm xuyên qua Tầng 1, chạm Tầng 2 và đóng nến để lại râu trên dài (Upper Wick >= 35-45%), đây là tín hiệu quét thanh khoản thành công (Bearish Liquidity Sweep).

---

## 3. Các Mô Hình Quét Thanh Khoản Cốt Lõi

### A. Buy Side Liquidity (BSL) Sweep
1. Hình thành Equal Highs (EQH) tạo bẫy Short.
2. Nến H4 đẩy mạnh phá đỉnh EQH, thu hút FOMO Breakout và kích hoạt SL của đội Short.
3. Chạm Major Supply / Resistance.
4. Rút râu mạnh, đóng nến H4 tụt trở lại dưới EQH hoặc tạo nến nhấn chìm đỏ (Bearish Engulfing).
5. Entry: Đợi nến M15 xác nhận gãy cấu trúc cục bộ (CHoCH / MSS), Short với SL trên đỉnh râu quét.

### B. Sell Side Liquidity (SSL) Sweep
1. Hình thành Equal Lows (EQL) tạo bẫy Long.
2. Nến đạp xuyên qua EQL, dính hàng loạt SL của đội Long.
3. Chạm Major Demand / Support.
4. Rút chân mạnh (Lower Wick >= 40%), đóng nến trên đáy cũ.
5. Entry: Mua theo Smart Money sau khi đám đông vừa bị dính SL.

---

## 4. Tránh Xung Đột Tín Hiệu (Signal Conflict Resolution)
Khi kết hợp Kane Sonic R và SMC:
- **Ưu tiên 1 (Macro Filter):** EMA 34 vs EMA 89 H4 xác định dòng chảy chính.
- **Ưu tiên 2 (Structural Filter):** 2-Tier Liquidity Model chặn các lệnh bắt dao rơi hoặc bắt đỉnh sớm tại cản con.
- **Ưu tiên 3 (Trigger):** Râu nến H4 (Wick >= 35%) + nến xác nhận M15 bảo đảm không vào sớm khi sóng quét chưa kết thúc.

