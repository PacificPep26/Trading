# Kế hoạch và trạng thái

Cập nhật 2026-10-14 — Strategy `paper-v2.4.0`. Hành vi chi tiết: [docs/bot-spec.md](docs/bot-spec.md). Số liệu: [nhật ký nghiên cứu](docs/nhat-ky-nghien-cuu.md).

## Kết luận hiện tại

Giao dịch tay phí 0, chỉ xét 2025–2026. Tiêu chuẩn chốt trước khi chạy: dương riêng từng năm, t ≥ 2, hơn vào ngẫu nhiên (`service/scripts/fee0_shootout.py`). Kiểm lại bằng chính code live (`service/scripts/live_replay_study.mjs`), 2.5$/lệnh:

| Kèo | Code live 2025 | Code live 2026 | TB/lệnh | Tần suất |
|---|---|---|---|---|
| **Hai đỉnh/đáy 4H** + SL trailing 3 ATR, không TP | +45$ | +43$ | +1.22R (29 lệnh, t=1.97) | ~1–2 lệnh/tháng |
| **📌 Limit dưới đáy 1H** (LONG, lọc volume đáy < 2.5x, đáy mới thay Limit cũ) | +145$ | +172$ | +0.063R (t=1.85) | ~95 kèo/tháng, 21 coin |

**Không đạt** (đã kiểm, không báo tin): Toàn cảnh 5 lớp, FVG 1H→15m, BOS 4H, Donchian 1D, order flow CVD/OI/sổ lệnh (đã xoá), "ăn 2 đầu" short đỉnh/long hỗ trợ, bắt hồi sau rớt nền 15m (108 biến thể), 📌 SHORT, đổi TP 📌 sang R cố định.

Rủi ro: chỉ 2 năm dữ liệu và các kèo được chọn sau khi xem giai đoạn này → thực tế thường thấp hơn. Theo dõi paper trước khi tăng tiền.

## Việc tiếp theo

- So sổ paper `paper-limit.json` (📌) và lệnh 4H thật với backtest sau ~30 lệnh.
- Xem lại sizing kèo 4H "kim cương": đang ký quỹ 90% vốn x10 (lỗ ~27% tài khoản mỗi lần chạm SL với vốn ~29$).
- Lưu `peakEquity` bền vững (đang lưu trong file dedup trên volume; kiểm tra sau redeploy).
- Kiểm chứng cảm nhận của chủ tài khoản: ghi ~30 lần "chắc chắn rớt tiếp / hồi" (coin + giờ) rồi đếm tỷ lệ đúng.
