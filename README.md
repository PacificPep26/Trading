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

- Version `paper-v2.3.1` kết hợp **Hệ Thống Dự Phóng Dòng Tiền 4 Mô Hình (Predictive Order Flow)**:
  1. **Mô hình 1 (Phái sinh OI & LSR):** Theo dõi Open Interest, tỷ lệ tài khoản Long/Short, Funding Rate để phát hiện đám đông dồn toa và bẫy thanh lý.
  2. **Mô hình 2 (Cumulative Volume Delta - CVD):** Theo dõi Taker Buy/Sell volume để phát hiện cá voi gom hàng ngầm (Absorption Divergence).
  3. **Mô hình 3 (Lực hấp dẫn Orderbook):** Quét 100 tầng sổ lệnh (Depth 100) tìm tường mua/bán khổng lồ làm lá chắn đặt Stoploss và chặn húc đầu vào tường cản.
  4. **Mô hình 4 (AI Meta-Scorer):** Dự báo xác suất thắng chiến lược `P(Win >= 1.8R)`, gắn nhãn 💎 `[KÈO ĐẸP 5/5 - ALL IN · AI: xx% win]` khi xác suất $\ge 80\%$.
- Setup phải qua decision engine và các bộ lọc xu hướng, volume, funding, momentum.
- Isolated tối đa x10; sizing dùng ngân sách rủi ro cố định theo capital tier.
- Drawdown 20% khóa lệnh mới. Đường đặt lệnh thật có tồn tại nhưng mặc định bị khóa bằng hai cờ môi trường.
- Ledger cục bộ: `data/paper-ledger.ndjson`.
