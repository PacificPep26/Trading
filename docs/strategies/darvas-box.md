# Chiến Lược Giao Dịch: Hộp Darvas Box (Nicolas Darvas) & Nhịp Test Đáy Lần 2

## 1. Nguồn Gốc & Tri Thức Cốt Lõi
- **Tác giả:** Nicolas Darvas (Nhà đầu tư huyền thoại kiếm 2 triệu USD trong 18 tháng với phương pháp Hộp Darvas).
- **Tài liệu tham khảo:** [Vietcap - Phương pháp ứng dụng lý thuyết hộp DARVAS BOX](https://www.vietcap.com.vn/kien-thuc/phuong-phap-ung-dung-ly-thuyet-hop-darvas-box-cua-nicolas-darvas).
- **Bản chất:** Thị trường khi tích lũy hoặc tái phân phối sẽ dao động lên xuống tạo thành một "chiếc hộp" (Box).
  - Cạnh trên hộp: Kháng cự / Đỉnh hộp (Upper Bound).
  - Cạnh dưới hộp: Hỗ trợ / Đáy hộp (Lower Bound).

---

## 2. Chiến Thuật Vào Lệnh (Đã kiểm chứng trên Chart BTC & Altcoin)

### Chiến thuật 1: Săn Bắt Đáy Lần 2 Tại Đáy Hộp (Double Bottom / 2nd Wick Bounce)
> *"Khi giá xuống đây rút chân 1 lần thì không nói, xuống lần 2 chắc chắn sẽ rút chân rồi canh nến mà mua. Có vùng đỉnh để chốt lời (TP), sau đó mới canh nếu phá thì theo, không thì bỏ."*

1. **Xác định Hộp Darvas:**
   - Giá hình thành vùng tích lũy tối thiểu 12 đến 24 nến 15m (3h đến 6h).
   - Xác định được Đỉnh hộp (`boxHigh`) và Đáy hộp (`boxLow`).
2. **Điều kiện Kích hoạt Lệnh Mua (LONG):**
   - **Nhịp 1:** Giá đâm thủng hoặc chạm đáy hộp lần đầu rồi rút chân nảy lên (tạo mốc hỗ trợ đáy ban đầu).
   - **Nhịp 2 (Xác nhận uy tín):** Giá quay lại test đáy hộp lần thứ hai (chạm vào vùng đáy $\pm 0.35\%$).
   - **Tín hiệu nến 15m:** Xuất hiện nến rút chân râu dưới dài (Pinbar / Hammer râu dưới $\ge 40\%$ biên độ nến) hoặc nến Bullish Engulfing đóng xanh xác nhận giữ vững đáy hộp.
   - **Khối lượng (Volume):** Volume nến rút chân lần 2 có sự hấp thụ ($Volume \ge 1.1\times$ SMA20).
3. **Cắt lỗ & Chốt lời:**
   - **Stop Loss:** Đặt ngay dưới đáy râu nến quét của nhịp 2 hoặc dưới đáy hộp (`boxLow - 0.2%`), rủi ro cực thấp (0.4% - 0.8%).
   - **Take Profit (TP1):** Cạnh trên của hộp Darvas (`boxHigh`). Tỷ lệ R:R thường từ 1:2.5 đến 1:4.
   - **Quản lý sau TP1:** Khi giá chạm đỉnh hộp, chốt 70% lợi nhuận, dời SL về hòa vốn (Break-even).

---

### Chiến thuật 2: Đánh Bứt Phá Hộp Darvas (Darvas Box Breakout - Hộp Chồng Hộp)
1. **Điều kiện Phá hộp:**
   - Sau khi giá đi ngang trong hộp, xuất hiện cây nến 15m hoặc 1H đóng nến dứt khoát trên đỉnh hộp (`close > boxHigh`).
   - Khối lượng nổ lớn ($Volume \ge 1.5\times$ SMA20).
2. **Điểm vào lệnh chuẩn:**
   - **Tuyệt đối cấm mua đuổi ở đọt nến:** Chờ nến tiếp theo quay về hồi test (Retest) mép trên của hộp vừa phá.
   - Khi nến hồi test giữ vững giá trên đỉnh hộp cũ -> Vào lệnh theo chiếc hộp mới (Hộp bậc thang cao hơn).
   - **Stop Loss:** Dưới đỉnh hộp cũ (`boxHigh - 0.3%`).
   - **Take Profit:** Chiều cao của hộp mới tương đương biên độ hộp cũ ($TP = Entry + BoxHeight$).

