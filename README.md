# Northstar Crypto Lab

Bot Telegram báo 3 kèo crypto đã kiểm chứng bằng backtest (chỉ báo tin, chủ tài khoản vào lệnh tay) + phòng nghiên cứu backtest.

**Agent mới: đọc [docs/CONTEXT.md](docs/CONTEXT.md) trước.** Hành vi chi tiết: [docs/bot-spec.md](docs/bot-spec.md) ·
trạng thái: [PLAN.md](PLAN.md) · mọi ý tưởng đã thử: [docs/so-tay-kien-thuc.md](docs/so-tay-kien-thuc.md) ·
số liệu: [docs/nhat-ky-nghien-cuu.md](docs/nhat-ky-nghien-cuu.md) · tóm tắt video chủ dự án thêm: [docs/research/](docs/research/).

## Chạy

```powershell
npm install
npm run dev          # chú ý: .env có token Telegram thật → bot sẽ gửi tin thật
```

Next.js 16 — trước khi sửa code Next, đọc guide trong `node_modules/next/dist/docs/`.

## Kiểm tra

```powershell
npm run test:policy
python -m pytest -q
npm run lint
npm run build
```
