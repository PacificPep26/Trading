# Handoff — cập nhật 2026-10-14

Đọc theo thứ tự: [bot-spec.md](bot-spec.md) → [../PLAN.md](../PLAN.md) → [so-tay-kien-thuc.md](so-tay-kien-thuc.md) (tra trước khi thử ý mới) → [nhat-ky-nghien-cuu.md](nhat-ky-nghien-cuu.md) → [quy-trinh-phan-tich.md](quy-trinh-phan-tich.md). Strategy `paper-v2.4.0`.

## Quy tắc khi sửa

- Kèo mới chỉ được báo/vào lệnh khi qua tiêu chuẩn chốt TRƯỚC khi chạy: dương riêng 2025 và 2026, t ≥ 2, hơn vào ngẫu nhiên cùng SL/TP. Chủ dự án giao dịch tay phí 0; đường API MEXC trả taker 0.08%/chiều.
- Backtest Limit: không tính TP trên nến khớp (đỉnh nến có thể xảy ra trước lúc khớp); SL trước nếu cùng nến.
- Sau khi đổi luật live, chạy lại `service/scripts/live_replay_study.mjs` để chắc code live cho đúng số của backtest (14/10 phát hiện 📌 live +0.014R so với backtest +0.069R chỉ vì cách giữ lệnh chờ).
- Đổi luật vào lệnh → tăng `STRATEGY_VERSION`.
- Không thêm lớp chấm điểm/“AI” chưa có backtest (14/10 đã gỡ order flow và “AI meta-scorer” tự đặt trọng số).

## Kiểm tra trước khi push (Railway tự deploy từ `main`)

```powershell
npm run test:policy
node tests/test_overview.mjs; node tests/test_resting_limit.mjs
python -m pytest -q
npm run build
```
