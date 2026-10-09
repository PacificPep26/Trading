# Handoff cho agent khác (cập nhật 2026-10-09 19h)

Đọc theo thứ tự: **file này → [PLAN.md](../PLAN.md) → [docs/quy-trinh-phan-tich.md](quy-trinh-phan-tich.md)**. Trả lời chủ dự án bằng tiếng Việt, ngắn, có số liệu. Hai agent (Claude Code, Codex) cùng sửa repo: `git status` trước khi sửa, không ghi đè thay đổi chưa commit của bên kia.

## Chủ dự án
- Giao dịch perp USDT trên **MEXC** (phí 0% nhiều coin; mạng nhà chặn API MEXC → giá lấy từ OKX, lệch < 0,01%). Vốn ~57$.
- Muốn lời nhanh, chấp nhận rủi ro cao, ghét bị "giảng" lặp lại. Đã nói rõ rủi ro nhiều lần; giờ **làm theo lựa chọn của họ, nói số $ một lần**.
- Lệnh thật: LINK SHORT 8/10 +19,97$ (x10, ~36$ ký quỹ, chốt tay 12,411). Nhật ký: [nhat-ky-giao-dich.md](nhat-ky-giao-dich.md).

## Luật & chế độ đang chạy
- Tín hiệu: **chỉ khung 4h**, nến 4h ĐÓNG xác nhận **BOS** hoặc **hai đỉnh/hai đáy** (`lib/patterns.ts` = `service/backtest/patterns.py`, khớp nhau: `tests/test_parity.py`).
- **Chế độ "Kiểu hôm qua" (mặc định, chủ dự án chọn)**: mọi tín hiệu 4h (cả BOS short), ký quỹ ~36$ x10 (tự hạ nếu thanh lý trước SL), TP 0,75R, có mức thoát sớm (nến 4h đóng ngược qua mức vừa phá).
- Chế độ "An toàn" (chọn được): BOS chỉ LONG, hai đỉnh/đáy cùng xu hướng ngày (EMA50 ngày của BTC & coin), chỉ lệnh ★, rủi ro 10% vốn, nửa 0,5R + nửa 1R.
- Cấu hình bot qua biến Railway: `ALERT_MODE`, `ALERT_MARGIN`, `ALERT_CAPITAL`, `CRON_SECRET`, `TELEGRAM_*` (token từng lộ trên GitHub public; chủ dự án nói kệ).

## Hệ thống
- Web: https://helpvictor.up.railway.app — một trang scanner (`app/live-scanner.tsx`) + `/api/watchlist` (tín hiệu 4h + xu hướng ngày) + `/api/live/levels` (xu hướng 4h/1h) + khối kiến thức (`app/knowledge.tsx`).
- Bot Telegram: `instrumentation.ts` → `lib/telegram-alerts.ts`, quét 5 phút/lần, báo tín hiệu mới + báo trước nến 4h đóng. Codex đã thêm `lib/trading-policy.ts` (gom luật/cỡ lệnh, có `tests/test_policy.mjs`) và **cảnh báo sớm 1H** (ghi rõ "chưa phải lệnh 4H").
- Deploy: `railway up --service web --ci --detach`. GitHub `PacificPep26/Trading` (public, `data/` không lên git).

## Đã kiểm chứng (21 coin Binance perp 2023–2026, chi tiết: [nhat-ky-nghien-cuu.md](nhat-ky-nghien-cuu.md))
- **Mọi kiểu khung 15m/1h/2h đều âm** (vùng hồi, Fibonacci, hỗ trợ/kháng cự, VWAP, bắt đáy/bắt nhịp bật sau cú sập, đu sóng 20x, lọc khối lượng, chốt ở nền cũ). 6h ≈ 0.
- 4h: BOS LONG +0,04–0,07R; **BOS SHORT ≈ 0**; hai đỉnh/đáy chỉ dương khi cùng xu hướng ngày. Thoát sớm khi breakout hỏng: lỗ TB −0,33R thay vì −0,72R.
- **Trên 18 coin mới (chưa dùng để chọn luật): ≈ 0** → lợi thế chưa xác nhận; cần forward test.
- Xác suất lịch sử (TP 0,75R, 48h): chạm TP trước ~40–44%, SL trước ~25%, chưa chạm ~30–36%.
- Rủi ro lớn/lệnh (≥7,5% vốn) trong mô phỏng tài khoản: sụt rất sâu hoặc cháy.

## Việc mở
- Forward test: ghi mọi tín hiệu bot và quyết định của chủ dự án vào nhật ký giao dịch.
- Đang chấm dự đoán AI MEXC (ghi trong nhật ký giao dịch).
- Chưa làm: trích kỹ thuật từ video Nukida (32/191 transcript) & sách; dữ liệu 1m; funding/OI làm tín hiệu.
