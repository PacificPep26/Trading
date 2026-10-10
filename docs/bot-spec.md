# Đặc tả bot Futures — `paper-v2.3.1`

Cập nhật: 2026-10-10 (bản vá an toàn và đồng bộ tài liệu). Đây là nguồn chân lý về hành vi. Khi đổi luật phải tăng `STRATEGY_VERSION` và bắt đầu cohort paper mới.

## 1. Mục tiêu và phạm vi

- Bot hỗ trợ phân tích và paper trade perpetual USDT bằng dữ liệu công khai OKX; có đường auto-trade MEXC nhưng mặc định khóa live.
- Vốn paper mặc định 40 USDT, isolated tối đa x10. Ngân sách rủi ro dùng bảng capital tier; tier khởi động là 2.5 USDT/lệnh.
- Khoảng dừng lỗ (SL) thực chiến: Bắt buộc từ **1.5% đến 6.0%**. Tuyệt đối loại bỏ SL < 1.5% (tránh bị phí sàn nuốt và quét râu vô duyên) và SL > 6.0% (tránh bị thanh lý tài khoản trước khi chạm SL trên x10).
- Chống vào lệnh trễ: Nếu giá live đã trôi quá 0.25% so với điểm kích hoạt nến đóng thì tự động hủy (`RUNAWAY_PRICE`), không bắt trader đu đỉnh/đu đáy.

## 2. Registry chiến lược (`paper-v2.3.1`)

| Setup | Khung/chiều | Trạng thái | Điều kiện kích hoạt & Quản trị rủi ro |
|---|---|---|---|
| **BOS** | 4H LONG | `paper` | Nến 4H đóng vượt swing high trong xu hướng tăng (không downtrend cả 2) |
| **BOS** | 4H SHORT | `paper` | Nến 4H đóng thủng swing low trong xu hướng giảm (không uptrend cả 2) |
| **Hai đỉnh / Hai đáy** | 4H | `paper` | Phá vỡ neckline hoặc xác nhận nến đảo chiều tại cản swing |
| **Pinbar quét râu** | 4H & 1H | `paper` | Râu nến $\ge 50\%$ chiều dài nến quét qua/sát đỉnh hoặc đáy cũ rồi rút chân |
| **Hai đỉnh / Hai đáy** | 1H | `paper` | Lướt sóng sớm: Nến 1H đóng qua neckline với SL $\ge 1.5\%$ và $\le 4.0\%$ |
| **BOS** | 1H | `paper` | Nến 1H đóng phá swing thuận bộ lọc bối cảnh và đạt điều kiện SL chung |

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
  - **TP1:** Đặt tại **`1.0R`**, đóng 50% vị thế. `v2.3.1` chưa tự động dời SL phần còn lại về Entry.
  - **TP2 (Ăn trọn sóng nhịp):** Đặt tại **`2.0R`** (hoặc cản Swing High/Low tiếp theo). Đóng 50% vị thế còn lại.
  - Tổng lợi nhuận khi ăn trọn 2 TP: $+0.5R + 1.0R = +1.5R$ (khoảng $+6.0\$ \text{ đến } +10.0\$$ trên vốn 40$).
  - Nếu cùng nến chạm cả SL và TP thì tính SL trước.

## 4. Sizing và circuit breaker

```text
riskBudget = capitalTier.riskPerTradeUsd
notional = min(equity × 10, riskBudget / stopDistancePct)
margin = notional / 10
```

- Ví dụ equity 40 USDT thuộc tier khởi động, risk budget 2.5 USDT:
  - SL 2.0%: notional = 125$, margin = 12.5$, lỗ tại SL = 2.5 USDT.
  - SL 5.0%: notional = 50$, margin = 5$, lỗ tại SL = 2.5 USDT.
  - SL 1.5%: notional = 166.7$, margin = 16.7$, lỗ tại SL = 2.5 USDT.
- Khi equity giảm từ đỉnh (peak) $\ge 20\%$, decision engine trả `BOT_LOCKED`. Không mở bất kỳ lệnh mới nào.

## 5. Ledger và vòng đời

- Ledger append-only tại `PAPER_LEDGER_FILE`, mặc định `data/paper-ledger.ndjson` (không đưa lên git).
- Vòng đời: `candidate → confirmed → planned → simulated_open → partially_closed/closed → reviewed`.
- Mỗi event lưu version (`paper-v2.3.1`), decision code, plan, fill, phí, slippage, equity và peak equity.

## 6. Quản lý vốn Nấc thang (Compounding Step Ladder) & Auto-Trade MEXC (`v2.3.1`)

- Bảng nấc thang vốn (Tiers):
  - **Tầng Khởi Động ($30 - $79.99):** Vốn cơ sở $50 · Rủi ro 1R = **$2.5/lệnh** · Giữ tối đa 2 lệnh (linh hoạt 3 lệnh nếu là Kèo Đẹp ★★★) · Ratchet floor: $30.
  - **Tầng 1 ($80 - $119.99):** Vốn cơ sở $100 · Rủi ro 1R = **$4.0/lệnh** · Tối đa 3 lệnh đồng thời · Ratchet floor: $70.
  - **Tầng 2 ($120 - $149.99):** Vốn cơ sở $120 · Rủi ro 1R = **$4.8/lệnh** · Tối đa 3 lệnh đồng thời · Ratchet floor: $110.
  - **Tầng 3 ($150 - $199.99):** Vốn cơ sở $150 · Rủi ro 1R = **$6.0/lệnh** · Tối đa 4 lệnh đồng thời · Ratchet floor: $135.
  - **Tầng 4 ($\ge $200):** Vốn cơ sở $200 · Rủi ro 1R = **$8.0/lệnh** · Tối đa 4 lệnh đồng thời · Ratchet floor: $180.
- Các giá trị ratchet floor đã có trong bảng tier nhưng `v2.3.1` chưa lưu tier cao nhất và chưa cưỡng chế floor bền vững qua restart.
- Có API key chỉ cho phép đọc tài khoản/vị thế. Đặt lệnh thật còn yêu cầu hai cờ opt-in ở dòng dưới.
- Giao dịch thật chỉ bật khi đặt rõ `MEXC_LIVE_TRADING=true` và `MEXC_DRY_RUN=false`; chỉ có API key không đủ để bật live.
- SL được đính kèm ngay trong lệnh mở. Hai TP được tạo sau khi API trả về vị thế có `positionId`; mọi lỗi đọc tài khoản/vị thế đều fail-closed.
- Chốt chặn bảo vệ số lượng lệnh: Đọc danh sách vị thế mở trực tiếp từ MEXC API. Không mở thêm khi đã chạm trần vị thế và tuyệt đối không nhồi lệnh vào coin đang giữ vị thế.
- Bộ lọc bão vĩ mô & Bẫy giá:
  - BTC Ngày Uptrend ➔ Tuyệt đối CHẶN TOÀN BỘ lệnh SHORT.
  - Chặn BTC 1H đi ngược chiều lệnh $\ge 0.7\%$.
  - Funding filter chặn $|rate| > 0.03\%$ khi context có funding; scanner tự động hiện chưa truyền trường này.
  - Yêu cầu thân nến BOS chiếm $\ge 25\%$ range và Volume $\ge 0.75 \times \text{SMA20}$ của 20 nến trước.

## 7. Định dạng Tin nhắn Telegram Tinh Gọn Thực Chiến (`v2.3.1`)

- Thẻ Lệnh Hành Động (Actionable Trade Card):
  - Bỏ toàn bộ văn mẫu giáo điều, cảnh báo lặp lại.
  - Chuẩn hóa đúng 5 thông số cốt lõi:
    1. Cặp coin & Chiều lệnh (`🟢 LONG` / `🔴 SHORT`)
    2. Điểm vào (`• Điểm vào: ~...`)
    3. Cắt lỗ (`• Cắt lỗ (SL): ... (-...%)`)
    4. Chốt lời (`• Chốt lời (TP): TP1 ... (+...$) | TP2 ... (+...$)`)
    5. Lý do vào lệnh (`• Sao vô: BOS 4H phá cản + Thân nến đặc + Volume TB20 + Thuận BTC`)
    6. Ký quỹ & Rủi ro (`• Ký quỹ: ~...$ (x10 Isolated) · Rủi ro 1R: ...$`)
- Im lặng ngầm 100%: Gỡ bỏ toàn bộ cảnh báo `preAlert` (báo trước 5 phút nến đóng) và `radar` tiệm cận đỉnh đáy khỏi vòng lặp ngầm 5 phút. Chỉ gửi tin nhắn khi có lệnh khớp thực sự hoặc người dùng chủ động bấm nút.
- Nhắc hạn API MEXC 90 ngày: Cảnh báo tự động duy nhất 1 lần khi hạn dùng còn $\le 1 \text{ ngày}$ (24 giờ).

## 8. Vận hành và Giám sát

- `/api/mexc-check`: Kiểm tra số dư ví USDT và danh sách vị thế (Positions) đang mở trên MEXC.
- `/api/watchlist`: Trả về danh sách setup, decision code và kế hoạch lệnh.
- `/api/paper`: 200 event gần nhất và trạng thái ledger.
- Webhook Telegram (`@VictorHuynh_trading_bot`):
  - Bàn phím nút bấm nhanh: `[ 🔍 Kèo ]`, `[ 🧭 Canh Đỉnh/Đáy ]`, `[ 🏦 Xem Vốn & Tier ]`, `[ SOL ]`, `[ WIF ]`, `[ DOGE ]`.
- Kiểm tra toàn hệ thống: `npm run test:policy`, `.\.venv\Scripts\python.exe -m pytest -q`, `npm run lint`, `npm run build`.

## 9. Trạng thái kiểm chứng và giới hạn

- Backtest đồng bộ `v2.3.1` chưa có setup nào đạt tiêu chí `tradeable` đã đăng ký trước.
- BOS 4H mục tiêu 1.5R: train `+0.018R`, t-stat `0.80`; nhóm 2026 `+0.015R`.
- Hai đỉnh/đáy 4H mục tiêu 1.5R: train `+0.013R`, t-stat `0.48`; nhóm 2026 `+0.019R`.
- Năm 2026 đã được xem nhiều lần nên không còn là holdout sạch. Live phải giữ khóa cho tới khi có cohort paper mới đủ mẫu.
- `v2.3.1` đã qua 47 pytest, test policy/API/ledger, lint và production build. Kiểm thử MEXC dùng mock; chưa xác nhận end-to-end bằng lệnh tiền thật.
