# Northstar Crypto Lab

Phòng nghiên cứu và paper trade crypto perpetual bằng dữ liệu OKX. Hệ thống không đặt lệnh tiền thật.

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

- Version `paper-v1.0.0`; chỉ BOS LONG 4H và hai đỉnh/đáy 4H thuận xu hướng ngày được paper trade.
- Setup 1H và pinbar là research-only. BOS SHORT bị loại.
- Isolated tối đa x10; sizing giảm theo SL để rủi ro không quá 10% equity.
- Drawdown 20% khóa lệnh mới. Không có đường dẫn đặt lệnh thật.
- Ledger cục bộ: `data/paper-ledger.ndjson`.
