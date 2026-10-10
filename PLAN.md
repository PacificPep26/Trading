# Kế hoạch và trạng thái

Cập nhật 2026-10-10 — Strategy `v2.3.1`. Chi tiết hành vi ở [docs/bot-spec.md](docs/bot-spec.md).

## Trạng thái hiện tại

> **Kết luận 2026-10-10 chiều**: backtest đúng kiểu thoát live với phí API MEXC thật (taker 0.08%/chiều) cho BOS + hai đỉnh/đáy 4H **−0.005R/lệnh (881 lệnh, t=−0.17)**; nhóm hai đỉnh/đáy thuận xu hướng +0.054R nhưng t=1.04. **Chưa có chiến thuật nào đủ chuẩn để chạy live.** Railway đang `MEXC_DRY_RUN=false` và bot đã vào lệnh tiền thật (LINK, ARB). Chi tiết: mục 2026-10-10 chiều trong [nhật ký](docs/nhat-ky-nghien-cuu.md).

- **Auto-Trade MEXC có khóa an toàn**: mặc định dry-run; live cần opt-in rõ ràng. Lệnh Market x10 Isolated gắn SL ngay khi mở, sau đó đặt TP1/TP2 bằng `positionId` thực tế.
- **Quản lý vốn Nấc thang**: 5 tầng vốn (Tầng Khởi Động $30 - $79, rủi ro $2.5/lệnh).
- **Chốt chặn số lượng vị thế**: Đọc vị thế thực tế qua `/api/v1/private/position/open_positions`, giữ tối đa 2 lệnh (mở rộng tối đa 3 lệnh khi có Kèo Đẹp ★★★), không nhồi trùng symbol.
- **Telegram bot tinh gọn**: Thẻ lệnh 5 dòng (Entry, SL, TP1/TP2, Sao vô, Ký quỹ/Rủi ro), tắt 100% tin canh nến chạy ngầm.
- **Bộ lọc bão & Bẫy giá**: Chặn SHORT khi BTC Ngày Uptrend, lọc Funding $\ge 0.03\%$, nến bật $\ge 0.7\%$, bẫy râu và nến volume thấp.

## Luật vận hành chính

1. BOS 4H, Hai đỉnh/Hai đáy 4H & 1H, Pinbar quét râu đảo chiều.
2. SL từ 1.5% đến 6.0%.
3. TP1 ở 1.0R (chốt 50%), TP2 ở 2.0R. Sau khi TP1 khớp, bot tự dời SL về hòa vốn (`moveStopsToBreakeven`, chưa kiểm chứng với tiền thật). Không xác nhận được SL thì đóng vị thế ngay.
6. Vốn < 30$ → `BOT_LOCKED`.
4. Isolated x10, rủi ro $2.5/lệnh (Tầng Khởi Động).
5. Drawdown 20% kích hoạt cầu dao dừng mở lệnh mới (`BOT_LOCKED`).

## Việc tiếp theo

- Giữ `MEXC_LIVE_TRADING=false` và `MEXC_DRY_RUN=true` trong khi chưa có setup đạt chuẩn `tradeable`.
- Đặt `MEXC_DRY_RUN=true` trên Railway; deploy bản vá `/api/mexc-check` (cần secret).
- Gắn volume cho service web (hoặc ghi sổ paper vào Postgres) để sổ paper không bị xóa khi redeploy.
- Lưu `peakEquity` bền vững (hiện chỉ nằm trong RAM, restart là cầu dao drawdown bị reset).
- Nghiên cứu hướng mới: theo xu hướng khung ngày/tuần, momentum chéo giữa các coin, funding cực đoan (xem nhật ký).
- Thu thập cohort paper `paper-v2.3.1`; chỉ xét bật live sau khi đủ mẫu và tiêu chí promotion.
