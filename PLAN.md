# Kế hoạch và trạng thái

Cập nhật 2026-10-15 — `v3.0.0`: bot chỉ báo tin 3 kèo dưới đây (đã bỏ tự đặt lệnh MEXC và mọi kèo cũ). Agent mới đọc [docs/CONTEXT.md](docs/CONTEXT.md). Hành vi chi tiết: [docs/bot-spec.md](docs/bot-spec.md). Số liệu: [nhật ký nghiên cứu](docs/nhat-ky-nghien-cuu.md).

## Kết luận hiện tại

Giao dịch tay phí 0, chỉ xét 2025–2026. Tiêu chuẩn chốt trước khi chạy: dương riêng từng năm, t ≥ 2, hơn vào ngẫu nhiên (`service/scripts/fee0_shootout.py`). Kiểm lại bằng chính code live (`service/scripts/live_replay_study.mjs`), 2.5$/lệnh:

| Kèo | Code live 2025 | Code live 2026 | TB/lệnh | Tần suất |
|---|---|---|---|---|
| **Hai đỉnh/đáy 4H** + SL trailing 3 ATR, không TP (bot nhắc dời SL) | +46$ | +45$ | +1.26R (29 lệnh, t=2.0) | ~1–2 lệnh/tháng |
| **🎯 ICT quét đỉnh hôm qua → SHORT 1H** (Limit giữa FVG, TP đáy hôm qua) | +119$ | +85$ | +0.42R (193 lệnh, t=3.5) | ~9 kèo/tháng |
| **📌 Limit dưới đáy 1H** (LONG, lọc volume đáy < 2.5x, đáy mới thay Limit cũ) | +131$ | +169$ | +0.060R (t=1.76) | ~95 kèo/tháng, 21 coin |

**Không đạt** (đã kiểm, không báo tin): Toàn cảnh 5 lớp, FVG 1H→15m, BOS 4H, Donchian 1D, order flow CVD/OI/sổ lệnh (đã xoá), "ăn 2 đầu" short đỉnh/long hỗ trợ, bắt hồi sau rớt nền 15m (108 biến thể), 📌 SHORT, đổi TP 📌 sang R cố định.

Rủi ro: chỉ 2 năm dữ liệu và các kèo được chọn sau khi xem giai đoạn này → thực tế thường thấp hơn. Theo dõi paper trước khi tăng tiền.

## Việc tiếp theo

- So 3 sổ paper (`paper-ict.json`, `paper-limit.json`, `paper-4h.json`, lệnh `thống kê` trên Telegram) với backtest sau ~30 lệnh mỗi kèo.
- Xử lý tóm tắt video chủ dự án thêm vào `docs/research/` theo quy trình trong `docs/CONTEXT.md`.
- Cập nhật `lib/us-events.json` cho năm 2027 (BLS + Fed) trước cuối 2026.
- Railway: xoá biến môi trường MEXC (`MEXC_*`) không còn dùng.
