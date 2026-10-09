# Kế hoạch và trạng thái

Cập nhật 2026-10-09 — strategy `paper-v1.0.0`. Chi tiết hành vi ở [docs/bot-spec.md](docs/bot-spec.md).

## Trạng thái hiện tại

- Đã có decision engine dùng chung, strategy registry, sizing theo risk và circuit breaker drawdown.
- Đã loại pinbar khỏi detector production để khớp Python; setup 1H không còn actionable.
- Scanner, watchlist và Telegram dùng policy/decision code chung; không có API đặt lệnh thật.
- Paper ledger append-only mô phỏng fill nến kế tiếp, phí/slippage, TP/SL bảo thủ, equity và drawdown; xem qua `/api/paper`.
- Backtest core chống look-ahead, SL thắng khi cùng nến chạm hai phía, hỗ trợ phí/slippage/funding, max drawdown, chuỗi thua và bootstrap CI.

## Luật đang paper

1. BOS 4H chỉ LONG.
2. Hai đỉnh/đáy 4H chỉ khi BTC và coin cùng phía EMA50 ngày với hướng lệnh.
3. SL 0,4–8%; TP 50% ở 0,5R và 50% ở 1R.
4. Isolated tối đa x10; rủi ro tối đa 10% equity tại SL.
5. Drawdown 20% khóa entry mới.

Pinbar, BOS SHORT và mọi setup 1H không được vào paper. Các số liệu lịch sử chỉ là exploratory vì 2026 không còn holdout sạch.

## Cổng tiếp theo

- Chạy cùng một version ít nhất 3 tháng và đóng ít nhất 200 lệnh.
- Expectancy ròng dương, profit factor >1, drawdown <20%, không lỗi parity/dữ liệu/policy.
- Không phụ thuộc một coin hoặc một chiều. Đạt cổng chỉ tạo báo cáo; không tự bật tiền thật.

## Việc còn mở

- Thu thập funding OKX theo từng vị thế thay vì mặc định 0 khi nguồn lịch sử thiếu.
- Bổ sung báo cáo paper theo coin, side, regime và kiểm tra điều kiện promotion.
- Tiếp tục kho kiến thức video/sách ở nhánh research, không đưa thẳng vào bot.
