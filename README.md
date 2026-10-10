# Northstar Crypto Lab

Phòng nghiên cứu, paper trade và bot MEXC Futures. Giao dịch thật mặc định bị khóa; chỉ bật khi cấu hình đồng thời `MEXC_LIVE_TRADING=true` và `MEXC_DRY_RUN=false`.

Nguồn chân lý: [đặc tả bot](docs/bot-spec.md). Trạng thái hiện tại: [PLAN.md](PLAN.md). Ngữ cảnh cho trợ lý: [CONTEXT.md](CONTEXT.md).

## Chạy web

```powershell
npm install
npm run dev
```

Web Next.js 16 gồm scanner 21 coin, API watchlist, paper ledger và Telegram alert. Trước khi sửa Next.js, đọc guide tương ứng trong `node_modules/next/dist/docs/`.

## Kiểm tra

```powershell
npm run test:policy
.\.venv\Scripts\python.exe -m pytest -q
npm run lint
npm run build
```

## Policy tóm tắt

- Version `paper-v2.3.1`; setup phải qua decision engine và các bộ lọc xu hướng, volume, funding, momentum.
- Isolated tối đa x10; sizing dùng ngân sách rủi ro cố định theo capital tier.
- Drawdown 20% khóa lệnh mới. Đường đặt lệnh thật có tồn tại nhưng mặc định bị khóa bằng hai cờ môi trường.
- Backtest hiện chưa có setup nào đạt chuẩn `tradeable`; tiếp tục vận hành dry-run/paper để thu thập cohort mới.
- Ledger cục bộ: `data/paper-ledger.ndjson`.
