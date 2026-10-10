# Ngữ cảnh cho trợ lý AI

Cập nhật 2026-10-10, sau nâng cấp toàn diện `v2.3.0` (Auto-trade MEXC, Quản lý vốn Bậc thang & Tinh gọn Telegram). Đọc [docs/bot-spec.md](docs/bot-spec.md) trước; file đó là nguồn chân lý.

## Dự án hiện tại

Northstar là bot hỗ trợ phân tích và auto-trade crypto perpetual trên sàn MEXC (Ví thật ~52 USDT, x10 Isolated) kết hợp paper trade; tích hợp Telegram bot tương tác trực tiếp với trader Victor Huynh (@VictorHuynh_trading_bot). Web dùng Next.js 16.

Luồng chuẩn: nến OKX đã đóng → `lib/patterns.ts` → `lib/decision-engine.ts` → `lib/telegram-alerts.ts` & `lib/mexc-client.ts` → Telegram alert & Webhook → `data/paper-ledger.ndjson`. `lib/trading-policy.ts` chứa version, registry, sizing và circuit breaker.

## Policy đã chốt (`v2.3.0`)

- **Auto-Trade MEXC:**
  - Tự động mở vị thế x10 Isolated khi setup đạt chuẩn.
  - Tự động cài sẵn lệnh TP1 (chốt 50% dời hòa), TP2 và SL.
  - Đọc danh sách vị thế mở trực tiếp từ sàn MEXC để chặn nhồi lệnh trùng symbol và giới hạn tối đa 2 lệnh (linh hoạt 3 lệnh với Kèo Đẹp ★★★).
- **Quản lý vốn Nấc thang (Capital Tiers):**
  - Tầng Khởi Động ($30 - $79): Rủi ro 1R = $2.5/lệnh (áp dụng cho tài khoản 52$).
  - Nâng tầng tự động khi số dư vượt mốc ($80 ➔ 4$, $120 ➔ 4.8$, $150 ➔ 6$, $200 ➔ 8$).
  - Van khóa bảo vệ lợi nhuận (Ratchet Floor).
- **Bộ lọc bão & Bẫy giá (Hidden Factors):**
  - BTC Ngày Uptrend: Tuyệt đối chặn 100% lệnh SHORT.
  - Chặn lệnh nếu Funding Rate $\ge 0.03\%$ hoặc BTC 1H tăng $\ge 0.7\%$.
  - Yêu cầu thân nến dứt khoát ($\ge 25\%$ range) và Volume $\ge 0.75 \times \text{SMA20}$.
- **Khoảng SL hợp lệ:** **1.5% đến 6.0%** entry. Tuyệt đối loại bỏ SL < 1.5% và SL > 6.0%.
- **Telegram Tinh Gọn:** Thẻ lệnh 5 dòng (Điểm vào, SL, TP dự tính, Sao vô, Ký quỹ/Rủi ro). Tắt 100% tin canh nến chạy ngầm.

## Lệnh kiểm tra

`node tests/test_policy.mjs`; `node tests/test_decision.mjs`; `node tests/test_capital_tier.mjs`; `node tests/test_mexc_client.mjs`; `npm run build`.
