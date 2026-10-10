# Handoff — cập nhật 2026-10-10

Đọc theo thứ tự: [bot-spec.md](bot-spec.md) → [../PLAN.md](../PLAN.md) → [quy-trinh-phan-tich.md](quy-trinh-phan-tich.md). Strategy hiện tại là `paper-v2.3.1`.

## Trạng thái

- Bot phân tích dữ liệu OKX, ghi paper ledger và có adapter đặt lệnh MEXC. Live mặc định khóa; chỉ bật khi đồng thời có credentials, `MEXC_LIVE_TRADING=true` và `MEXC_DRY_RUN=false`.
- Registry paper gồm BOS, hai đỉnh/đáy và pinbar trên 4H/1H. Không setup nào hiện đạt tiêu chí thống kê `tradeable`; không mô tả hệ thống là có lợi thế đã được chứng minh.
- `lib/decision-engine.ts` là contract dùng chung; `lib/trading-policy.ts` giữ version/registry/circuit breaker; `lib/capital-tier.ts` giữ sizing theo tier.
- MEXC dùng `https://api.mexc.com`: SL gắn với lệnh mở và được kiểm tra lại; TP1/TP2 đặt qua `positionId`. Lỗi đọc tài khoản/vị thế phải fail-closed.
- Ledger append-only ở `PAPER_LEDGER_FILE` (mặc định `data/paper-ledger.ndjson`); API đọc tại `/api/paper`. Production cần persistent volume và một replica.
- Tier khởi động dùng risk 2.5 USDT/lệnh, leverage tối đa x10; drawdown 20% khóa entry. Scanner kiểm tra margin khả dụng, không nhồi trùng symbol và giới hạn vị thế theo tier.

## Chưa triển khai

- Tự động dời SL phần còn lại về Entry sau TP1.
- Ratchet floor bền vững qua restart.
- Truyền funding rate vào decision context của scanner tự động.
- Kiểm thử end-to-end bằng lệnh tiền thật. Các test MEXC hiện dùng mock và không gửi lệnh live.

## Kiểm tra trước khi bàn giao

```powershell
git status --short
npm run test:policy
.\.venv\Scripts\python.exe -m pytest -q
npm run lint
npm run build
```

Mốc xác minh `v2.3.1`: 47 pytest pass, policy/API/ledger pass, lint pass, build pass. Build còn cảnh báo Turbopack về dynamic filesystem tracing tại paper ledger.

Không sửa rule mà không tăng `STRATEGY_VERSION` và bắt đầu cohort paper mới. Không bật live chỉ vì build/test xanh; điều kiện promotion thống kê vẫn chưa đạt.
