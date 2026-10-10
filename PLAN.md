# Kế hoạch và trạng thái

Cập nhật 2026-10-10 — Strategy `v2.3.0`. Chi tiết hành vi ở [docs/bot-spec.md](docs/bot-spec.md).

## Trạng thái hiện tại

- **Auto-Trade Live MEXC**: Đã kết nối API key/secret, tự động đặt lệnh Market x10 Isolated và cài sẵn TP/SL trên sàn MEXC.
- **Quản lý vốn Nấc thang**: 5 tầng vốn (Tầng Khởi Động $30 - $79, rủi ro $2.5/lệnh).
- **Chốt chặn số lượng vị thế**: Đọc vị thế thực tế qua `/api/v1/private/position/open_positions`, giữ tối đa 2 lệnh (mở rộng tối đa 3 lệnh khi có Kèo Đẹp ★★★), không nhồi trùng symbol.
- **Telegram bot tinh gọn**: Thẻ lệnh 5 dòng (Entry, SL, TP1/TP2, Sao vô, Ký quỹ/Rủi ro), tắt 100% tin canh nến chạy ngầm.
- **Bộ lọc bão & Bẫy giá**: Chặn SHORT khi BTC Ngày Uptrend, lọc Funding $\ge 0.03\%$, nến bật $\ge 0.7\%$, bẫy râu và nến volume thấp.

## Luật vận hành chính

1. BOS 4H, Hai đỉnh/Hai đáy 4H & 1H, Pinbar quét râu đảo chiều.
2. SL từ 1.5% đến 6.0%.
3. TP1 ở 1.0R (chốt 50%, dời hòa), TP2 ở 2.0R.
4. Isolated x10, rủi ro $2.5/lệnh (Tầng Khởi Động).
5. Drawdown 20% kích hoạt cầu dao dừng mở lệnh mới (`BOT_LOCKED`).

## Việc tiếp theo

- Giám sát 2 vị thế đang chạy trên sàn (`ARB`, `LINK`).
- Tiếp tục ghi nhận log khớp lệnh và PnL tự động.
