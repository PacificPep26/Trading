# Northstar Crypto Lab

Phòng nghiên cứu, paper trade và bot MEXC Futures. Giao dịch thật mặc định bị khóa; chỉ bật khi cấu hình đồng thời `MEXC_LIVE_TRADING=true` và `MEXC_DRY_RUN=false`.

Nguồn chân lý: [đặc tả bot](docs/bot-spec.md). Trạng thái hiện tại: [PLAN.md](PLAN.md). Bàn giao: [docs/HANDOFF.md](docs/HANDOFF.md).

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

- Version `paper-v2.4.0`. Hai kèo đạt kiểm chứng 2025–26 (phí 0): **hai đỉnh/đáy 4H** + SL trailing 3 ATR (tự vào lệnh MEXC khi bật live) và **📌 Limit dưới đáy 1H** (tin báo tay, chỉ LONG). Các kèo khác chỉ ghi paper.
- Kèo 4H qua decision engine: xu hướng ngày coin + BTC, volume ≥ 2x, SL 1.5–6%, BTC 1H, funding, trôi giá ≤ 0.25%.
- Isolated tối đa x10. Kèo 4H "kim cương" ký quỹ 90% vốn; kèo khác theo capital tier.
- Đường đặt lệnh thật chỉ mở khi `MEXC_LIVE_TRADING=true` và `MEXC_DRY_RUN=false`.
- Sổ paper và dedup trong `data/` (cần volume trên Railway).
