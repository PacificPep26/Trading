# Ngữ cảnh cho trợ lý AI

Cập nhật 2026-10-10, sau bản vá an toàn `v2.3.1` (MEXC fail-closed, TP/SL thật, sizing theo tier). Đọc [docs/bot-spec.md](docs/bot-spec.md) trước; file đó là nguồn chân lý.

## Dự án hiện tại

Northstar là bot hỗ trợ phân tích crypto perpetual, paper trade và có khả năng auto-trade MEXC x10 Isolated. Chế độ mặc định là dry-run; live chỉ bật bằng opt-in kép. Bot tích hợp Telegram và web Next.js 16.

Luồng chuẩn: nến OKX đã đóng → `lib/patterns.ts` → `lib/decision-engine.ts` → `lib/telegram-alerts.ts` & `lib/mexc-client.ts` → Telegram alert & Webhook → `data/paper-ledger.ndjson`. `lib/trading-policy.ts` chứa version, registry, sizing và circuit breaker.

## Policy đã chốt (`v2.3.1`)

- **Auto-Trade MEXC:**
  - Chỉ mở vị thế thật khi `MEXC_LIVE_TRADING=true` và `MEXC_DRY_RUN=false`.
  - SL được đính kèm lệnh mở và kiểm tra lại; TP1/TP2 được đặt bằng `positionId` thực tế.
  - Đọc danh sách vị thế mở trực tiếp từ sàn MEXC để chặn nhồi lệnh trùng symbol và giới hạn tối đa 2 lệnh (linh hoạt 3 lệnh với Kèo Đẹp ★★★).
- **Quản lý vốn Nấc thang (Capital Tiers):**
  - Tầng Khởi Động ($30 - $79): Rủi ro 1R = $2.5/lệnh (áp dụng cho tài khoản 52$).
  - Nâng tầng tự động khi số dư vượt mốc ($80 ➔ 4$, $120 ➔ 4.8$, $150 ➔ 6$, $200 ➔ 8$).
  - Ratchet floor hiện là metadata/định hướng; chưa có cơ chế lưu tier cao nhất để cưỡng chế floor qua lần restart.
- **Bộ lọc bão & Bẫy giá (Hidden Factors):**
  - BTC Ngày Uptrend: Tuyệt đối chặn 100% lệnh SHORT.
  - Chặn BTC momentum ngược chiều $\ge 0.7\%$. Funding filter có trong engine nhưng scanner chưa truyền funding rate, nên chưa được cưỡng chế ở luồng tự động.
  - BOS yêu cầu thân nến dứt khoát ($\ge 25\%$ range); BOS và hai đỉnh/đáy yêu cầu Volume $\ge 0.75 \times \text{SMA20}$ của 20 nến trước.
- **Khoảng SL hợp lệ:** **1.5% đến 6.0%** entry. Tuyệt đối loại bỏ SL < 1.5% và SL > 6.0%.
- **Telegram Tinh Gọn:** Thẻ lệnh 5 dòng (Điểm vào, SL, TP dự tính, Sao vô, Ký quỹ/Rủi ro). Tắt 100% tin canh nến chạy ngầm.

## Lệnh kiểm tra

`npm run test:policy`; `.\.venv\Scripts\python.exe -m pytest -q`; `npm run lint`; `npm run build`.

Lần xác minh `v2.3.1`: policy/API/ledger pass, pytest **47 passed**, lint pass, production build pass. Không có lệnh MEXC thật nào được gửi trong kiểm thử.
