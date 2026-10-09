# Quy trình phân tích paper `paper-v2.0.0`

Nguồn chân lý: [bot-spec.md](bot-spec.md). Không tự tạo giá, setup hoặc điều kiện ngoài decision engine.

1. Lấy `/api/watchlist` hoặc truy vấn Telegram bot và ghi giờ dữ liệu Việt Nam. Nếu coin lỗi hoặc decision là `INVALID_DATA`, kết luận không có lệnh.
2. Chỉ `ACCEPTED` mới là tín hiệu vào lệnh hợp lệ.
   - `PENDING_CONFIRMATION`: Đang áp sát điểm kích hoạt $\le 1.5\%$, chờ nến đóng.
   - `RUNAWAY_PRICE`: Giá live đã chạy quá xa ($> 0.25\%$), hủy ngay để tránh đu đỉnh/đu đáy.
   - `INVALID_STOP`: Khoảng cách SL nằm ngoài biên an toàn (SL $< 1.5\%$ hoặc $> 6.0\%$).
3. Các mô hình hợp lệ trong `v2.0.0`:
   - 4H: BOS Long, BOS Short, Hai đỉnh, Hai đáy, Pinbar quét râu đảo chiều.
   - 1H: Hai đỉnh/đáy 1H, Pinbar quét râu 1H (với SL chặt từ $1.5\%$ đến $4.0\%$).
4. Dùng plan do engine trả về:
   - Điểm vào: entry
   - Dừng lỗ: SL (1.5% – 6.0%)
   - Chốt lời 1 (1.0R): đóng 50%, dời SL về hòa vốn.
   - Chốt lời 2 (2.0R): đóng 50% còn lại ăn trọn sóng.
   - Sizing: Notional, Margin, x10 Isolated, Rủi ro tối đa $4.0\$$ trên vốn $40\$$.
5. Khi drawdown tài khoản đạt 20%, kết luận `BOT_LOCKED`; không mở lệnh mới.
6. Với vị thế paper đang mở, ledger là nguồn trạng thái. Nếu cùng nến chạm SL/TP, tính SL trước.

Mẫu trả lời chuẩn:

```text
Kết luận: VÀO LỆNH (ACCEPTED) / CHỜ NẾN ĐÓNG / BỎ QUA (Giờ dữ liệu)
Mã quyết định: <code> · paper-v2.0.0
Mô hình: <coin, side, timeframe, style>
Kế hoạch MEXC: Entry … · SL … (-…%) · TP1 (1.0R) … · TP2 (2.0R) …
Sizing (Vốn 40$): Ký quỹ … · Vị thế … · x10 Isolated · Rủi ro chạm SL: -…$
Trạng thái tài khoản: Equity … · Drawdown … · Locked true/false
```
