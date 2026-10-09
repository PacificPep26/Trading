# Ngữ cảnh cho trợ lý AI

Cập nhật 2026-10-09, sau chuẩn hóa toàn diện `paper-v2.0.0`. Đọc [docs/bot-spec.md](docs/bot-spec.md) trước; file đó là nguồn chân lý.

## Dự án hiện tại

Northstar là bot hỗ trợ giao dịch và paper trade crypto perpetual dùng dữ liệu OKX; tích hợp Telegram bot tương tác trực tiếp với trader Victor Huynh để quản lý vị thế trên sàn MEXC (Vốn 40$, x10 Isolated). Web dùng Next.js 16.

Luồng chuẩn: nến OKX đã đóng → `lib/patterns.ts` → `lib/decision-engine.ts` → scanner/Telegram Alert & Webhook → `data/paper-ledger.ndjson`. `lib/trading-policy.ts` chứa version, registry, sizing và circuit breaker.

## Policy đã chốt (`paper-v2.0.0`)

- **Chiến lược được phép (`paper`):**
  - 4H: BOS Long, BOS Short, Hai đỉnh/Hai đáy, Pinbar quét râu đảo chiều.
  - 1H: Lướt sóng sớm Hai đỉnh/Hai đáy 1H, Pinbar quét râu 1H (SL chặt 1.5% - 4.0%).
- **Khoảng SL hợp lệ:** **1.5% đến 6.0%** entry. Tuyệt đối loại bỏ SL < 1.5% (phí sàn nuốt và quét râu) và SL > 6.0% (cháy tài khoản x10).
- **Chống trôi giá (Max Drift):** Giá live lệch không quá 0.25% so với điểm kích hoạt đóng nến; lệch quá thì trả `RUNAWAY_PRICE` để tránh đu đỉnh.
- **Chốt lời 2 bước:** TP1 ở 1.0R (đóng 50%, dời SL về hòa vốn); TP2 ở 2.0R hoặc cản cấu trúc nến Ngày (đóng 50% còn lại).
- **Vốn & Quản trị rủi ro:** Vốn 40 USDT; isolated x10; rủi ro tối đa 10% equity (4$) tại SL bằng cách điều chỉnh notional. Drawdown $\ge 20\%$ từ đỉnh thì khóa lệnh mới (`BOT_LOCKED`).

## Quy ước kỹ thuật

- Mọi quyết định và tín hiệu vào lệnh (kể cả Telegram) phải đi qua `evaluateSetup()` trong `lib/decision-engine.ts`.
- Mọi lỗi dữ liệu phải fail-closed và có decision code.
- Trả lời chủ dự án bằng tiếng Việt, giải thích số liệu rõ ràng, thực chiến.

## Lệnh kiểm tra

`node tests/test_policy.mjs`; `node tests/test_decision.mjs`; `npm run build`.
