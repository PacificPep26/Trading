# Handoff — cập nhật 2026-10-09

Đọc theo thứ tự: [bot-spec.md](bot-spec.md) → [../PLAN.md](../PLAN.md) → [quy-trinh-phan-tich.md](quy-trinh-phan-tich.md). Strategy hiện tại là `paper-v1.0.0`.

## Trạng thái

- Bot chỉ paper trade trên dữ liệu OKX; không có đường đặt lệnh thật.
- Detector production: BOS và hai đỉnh/đáy 4H. BOS SHORT bị loại; pinbar và mọi setup 1H là research-only.
- `lib/decision-engine.ts` là contract dùng chung; `lib/trading-policy.ts` giữ registry, sizing và circuit breaker.
- Ledger append-only ở `PAPER_LEDGER_FILE` (mặc định `data/paper-ledger.ndjson`); API đọc tại `/api/paper`. Production cần persistent volume và một replica.
- Vốn mặc định 40 USDT; risk tối đa 10% equity; leverage tối đa x10; drawdown 20% khóa entry.

## Kiểm tra trước khi bàn giao

Chạy `git status`, `npm run test:policy`, `.\.venv\Scripts\python.exe -m pytest -q`, `npm run lint`, `npm run build`. Không sửa rule mà không tăng version và bắt đầu cohort mới.

## Giới hạn còn lại

- Năm 2026 không còn là holdout sạch.
- Funding có trường trong ledger/backtest nhưng paper ledger mặc định 0 nếu chưa lấy được chuỗi funding tương ứng.
- Chưa đủ 200 lệnh và 3 tháng; tuyệt đối không mô tả hệ thống là đã sẵn sàng dùng tiền thật.
