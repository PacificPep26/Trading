# Đặc tả bot Futures paper — `paper-v2.0.0`

Cập nhật: 2026-10-09 (Chuẩn hóa toàn diện). Đây là nguồn chân lý về hành vi. Khi đổi luật phải tăng `STRATEGY_VERSION` và bắt đầu cohort paper mới.

## 1. Mục tiêu và phạm vi

- Bot hỗ trợ phân tích và paper trade perpetual USDT bằng dữ liệu công khai OKX; thông báo tín hiệu chuẩn sang Telegram cho trader quản lý vốn trên MEXC.
- Vốn mặc định 40 USDT, isolated tối đa x10, rủi ro tối đa 10% equity (4 USDT) tại SL.
- Khoảng dừng lỗ (SL) thực chiến: Bắt buộc từ **1.5% đến 6.0%**. Tuyệt đối loại bỏ SL < 1.5% (tránh bị phí sàn nuốt và quét râu vô duyên) và SL > 6.0% (tránh bị thanh lý tài khoản trước khi chạm SL trên x10).
- Chống vào lệnh trễ: Nếu giá live đã trôi quá 0.25% so với điểm kích hoạt nến đóng thì tự động hủy (`RUNAWAY_PRICE`), không bắt trader đu đỉnh/đu đáy.

## 2. Registry chiến lược (`paper-v2.0.0`)

| Setup | Khung/chiều | Trạng thái | Điều kiện kích hoạt & Quản trị rủi ro |
|---|---|---|---|
| **BOS** | 4H LONG | `paper` | Nến 4H đóng vượt swing high trong xu hướng tăng (không downtrend cả 2) |
| **BOS** | 4H SHORT | `paper` | Nến 4H đóng thủng swing low trong xu hướng giảm (không uptrend cả 2) |
| **Hai đỉnh / Hai đáy** | 4H | `paper` | Phá vỡ neckline hoặc xác nhận nến đảo chiều tại cản swing |
| **Pinbar quét râu** | 4H & 1H | `paper` | Râu nến $\ge 50\%$ chiều dài nến quét qua/sát đỉnh hoặc đáy cũ rồi rút chân |
| **Hai đỉnh / Hai đáy** | 1H | `paper` | Lướt sóng sớm: Nến 1H đóng qua neckline với SL $\ge 1.5\%$ và $\le 4.0\%$ |

Python `service/backtest/patterns.py` và `lib/patterns.ts` là bộ nhận diện mẫu hình tham chiếu.

## 3. Dữ liệu và quyết định

- Chỉ đọc nến đã đóng để xác nhận; paper fill ở giá mở nến kế tiếp, cộng slippage.
- Thiếu dữ liệu, giá không hữu hạn, timestamp tương lai/quá hạn hoặc lỗi OKX: fail-closed (`INVALID_DATA`).
- Mã quyết định chuẩn:
  - `ACCEPTED`: Đạt toàn bộ tiêu chuẩn, tạo OrderPlan và bắn thông báo vào lệnh.
  - `PENDING_CONFIRMATION`: Đang áp sát mức kích hoạt $\le 1.5\%$, chờ nến đóng.
  - `RUNAWAY_PRICE`: Giá live đã chạy quá xa điểm vào ($> 0.25\%$), hủy lệnh tránh đu đỉnh.
  - `INVALID_STOP`: Khoảng cách SL nằm ngoài biên an toàn ($< 1.5\%$ hoặc $> 6.0\%$).
  - `TREND_MISMATCH`: Ngược xu hướng bối cảnh thị trường.
  - `STRATEGY_NOT_PAPER`: Chiến lược chưa được cấp phép paper.
  - `STALE_SIGNAL`: Tín hiệu quá hạn (> 8 tiếng).
  - `BOT_LOCKED`: Tài khoản sụt giảm $\ge 20\%$ từ đỉnh, kích hoạt cầu dao an toàn.
- **Quy tắc Chốt lời 2 bước:**
  - **TP1 (Bảo hiểm rủi ro):** Đặt tại **`1.0R`**. Đóng 50% vị thế, đồng thời dời SL vị thế còn lại về đúng Entry (hòa vốn).
  - **TP2 (Ăn trọn sóng nhịp):** Đặt tại **`2.0R`** (hoặc cản Swing High/Low tiếp theo). Đóng 50% vị thế còn lại.
  - Tổng lợi nhuận khi ăn trọn 2 TP: $+0.5R + 1.0R = +1.5R$ (khoảng $+6.0\$ \text{ đến } +10.0\$$ trên vốn 40$).
  - Nếu cùng nến chạm cả SL và TP thì tính SL trước.

## 4. Sizing và circuit breaker

```text
riskBudget = equity × 10% (4 USDT trên vốn 40 USDT)
notional = min(equity × 10, riskBudget / stopDistancePct)
margin = notional / 10
```

- Ví dụ equity 40 USDT:
  - SL 2.0%: notional = 200$, margin = 20$, lỗ tại SL = 4.0 USDT.
  - SL 5.0%: notional = 80$, margin = 8$, lỗ tại SL = 4.0 USDT.
  - SL 1.5% (trần đòn bẩy x10): notional = 266.7$, margin = 26.7$, lỗ tại SL = 4.0 USDT.
- Khi equity giảm từ đỉnh (peak) $\ge 20\%$, decision engine trả `BOT_LOCKED`. Không mở bất kỳ lệnh mới nào.

## 5. Ledger và vòng đời

- Ledger append-only tại `PAPER_LEDGER_FILE`, mặc định `data/paper-ledger.ndjson` (không đưa lên git).
- Vòng đời: `candidate → confirmed → planned → simulated_open → partially_closed/closed → reviewed`.
- Mỗi event lưu version (`paper-v2.0.0`), decision code, plan, fill, phí, slippage, equity và peak equity.

## 6. Quản lý vốn Nấc thang (Compounding Step Ladder) & Auto-Trade MEXC (`v2.1.0`)

- Bảng nấc thang vốn (Tiers):
  - **Tầng 1 ($80 - $119.99):** Vốn cơ sở $100 · Rủi ro 1R = **$4.0/lệnh** · Tối đa 3 lệnh đồng thời · Ratchet floor: $80.
  - **Tầng 2 ($120 - $149.99):** Vốn cơ sở $120 · Rủi ro 1R = **$4.8/lệnh** · Tối đa 3 lệnh đồng thời · Ratchet floor: $110.
  - **Tầng 3 ($150 - $199.99):** Vốn cơ sở $150 · Rủi ro 1R = **$6.0/lệnh** · Tối đa 4 lệnh đồng thời · Ratchet floor: $135.
  - **Tầng 4 ($\ge $200):** Vốn cơ sở $200 · Rủi ro 1R = **$8.0/lệnh** · Tối đa 4 lệnh đồng thời · Ratchet floor: $180.
- Van khóa bảo vệ lợi nhuận (Ratchet): Khi tài khoản vượt mốc và sau đó gặp đợt điều chỉnh, bot tự động hạ nấc sizing để bảo vệ phần lãi đã chốt.
- Tự động đặt lệnh MEXC Futures: Khi có `MEXC_API_KEY` & `MEXC_SECRET_KEY`, bot gửi lệnh Market x10 Isolated và tự động đặt sẵn lệnh điều kiện TP/SL. Nếu chưa có key, bot chạy chế độ Dry-Run an toàn.

## 7. Vận hành và Giám sát

- `/api/watchlist`: Trả về danh sách setup, decision code và kế hoạch lệnh.
- `/api/paper`: 200 event gần nhất và trạng thái ledger.
- Webhook Telegram (`@VictorHuynh_trading_bot`):
  - Nhắn `canh` / `/canh`: Bật Radar quét coin sát Đỉnh cũ / Đáy cũ trong vòng 2%.
  - Nhắn `keo` / `quét`: Quét toàn diện tín hiệu 4H và 1H đạt chuẩn.
  - Nhắn `vốn` / `sodu`: Tra cứu số dư tài khoản, cấp bậc Tầng hiện tại, rủi ro 1R và mốc ratchet floor.
  - Nhắn tên coin (`BTC`, `SOL`, `LINK`, `TIA`): Soi chi tiết thông số vào lệnh MEXC chuẩn xác.
- Kiểm tra toàn hệ thống: `node tests/test_policy.mjs`, `node tests/test_decision.mjs`, `node tests/test_capital_tier.mjs`, `node tests/test_mexc_client.mjs`, `npm run build`.
