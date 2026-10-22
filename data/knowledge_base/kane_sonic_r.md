# DR. KANE VIP H4/M15 SONIC R SYSTEM MANUAL
*Cẩm nang chiến thuật Fibonacci EMAs 34/89 & Quản lý rủi ro Fixed 1R*

---

## 1. Hệ Thống Chỉ Báo Kane Sonic R H4
- **Dải rồng Sonic R:** EMA 34 High, EMA 34 Close, EMA 34 Low.
- **Đường xu hướng xương sống:** EMA 89 (Fibonacci Level 89).
- **Quy tắc Xu hướng:**
  - `EMA 34 >= EMA 89`: Bull Trend (Ưu tiên tìm điểm Long hồi quy về EMA 34).
  - `EMA 34 < EMA 89`: Bear Trend (Ưu tiên tìm điểm Short hồi quy về EMA 34).

---

## 2. Chiến Thuật Thực Chiến Dr. Kane

### Chiến thuật 1: KANE_THUAN_TREND (Trend-Following Pullback)
- **Bối cảnh:** Giá đang trong xu hướng rõ ràng, hồi quy về chạm dải EMA 34 hoặc kiểm tra lại Key Level bị phá vỡ.
- **Tín hiệu kích hoạt:** Nến H4 chạm hỗ trợ/kháng cự bật lại, rút râu >= 35% hoặc tạo nến nhấn chìm theo xu hướng.
- **Xác nhận M15:** Nến M15 đóng nến theo xu hướng (xanh vượt đỉnh nến trước với Long; đỏ thủng đáy nến trước với Short).

### Chiến thuật 2: KANE_NGUOC_TREND (Extreme Extension Mean-Reversion)
- **Bối cảnh:** Giá chạy nước rút parabol, dãn nở cực đại xa khỏi EMA 34 (khoảng cách >= 3.0%).
- **Điều kiện ngặt nghèo của Dr. Kane:**
  1. Nến H4 chạm cản đối diện và để lại râu cực đại: Râu nến >= 45% biên độ.
  2. Khoảng cách từ Entry về dải EMA 34 phải đủ lớn để đạt tỷ lệ R:R >= 1.0! (Nếu khoảng cách quá hẹp, từ chối vào lệnh).
- **Mục tiêu:** Ăn nhịp hồi kỹ thuật (Mean Reversion) về lại dải rồng EMA 34.

---

## 3. Kỷ Luật Quản Lý Vốn & Trailing Stop Độc Quyền
- **Fixed 1R Risk Model:** Mỗi lệnh luôn mạo hiểm đúng 1R (ví dụ 10 USDT) bất kể khoảng cách SL xa hay gần.
- **Nguyên tắc Khóa Lợi Nhuận (+1.5R ➔ Khóa +1.0R):**
  - Khi PnL chạm mốc **+1.5R**, bot tự động kéo Stop Loss lên mức **DƯƠNG +1.0R**.
  - **GIỮ NGUYÊN 100% VỊ THẾ** để gồng tiếp đến Take Profit (tối thiểu 2.0R).
  - Dù thị trường có bất ngờ đảo chiều mạnh, tài khoản vẫn bỏ túi trọn vẹn +1.0R lợi nhuận, không bao giờ để lệnh thắng lớn hóa thành lệnh hòa hay lỗ.
- **Time-Stop:** Sau 16 nến M15 (4 tiếng) nếu giá đi ngang không bứt phá, chủ động tất toán bảo toàn vốn.

