# TÀI LIỆU BÀN GIAO NGỮ CẢNH HỆ THỐNG TRADING (BOT LIVE MEXC)
*Cập nhật lúc: 15:42 Thứ Bảy, ngày 10/10/2026 (Giờ VN)*

---

### 1. Trạng thái tài khoản Live MEXC hiện tại
- **Server:** Đang chạy ổn định trên Railway (`https://helpvictor.up.railway.app`).
- **Số dư thực tế:** `50.566 USDT` (100% tiền mặt khả dụng, không có margin bị khóa).
- **Vị thế mở (Open Positions):** `0` vị thế. Toàn bộ lệnh cũ (`ARB_USDT`, `LINK_USDT`) và các lệnh điều kiện (Plan orders) đã được đóng và hủy sạch sẽ.
- **Cấu hình môi trường:**
  - `MEXC_LIVE_TRADING=true`
  - `MEXC_DRY_RUN=false`
- **Mức vốn & Quản lý rủi ro (Tier 1 Starter):**
  - **Risk per trade:** Cố định **$4.0 USDT / lệnh** (quy định tại `lib/capital-tier.ts`).
  - **Số lệnh mở tối đa:** 2 lệnh (hoặc 3 lệnh nếu là Kèo Đẹp Star Setup).
  - **Đệm chốt lời (Front-running TP):** TP1 tại `0.90R` (khớp sớm dời SL về BE) và TP2 tại `1.85R` (đón đầu trước cản/đáy cũ).

---

### 2. Các chiến lược được phép đánh thật (Live Trading)
Quy định tập trung tại hàm `isLiveEligible` trong `lib/trading-policy.ts`:
1. **Daily Trend Following (1D Donchian Breakout 20D):**
   - Vào lệnh khi nến ngày đóng phá đỉnh 20 ngày và BTC Ngày Uptrend.
   - SL ban đầu 2×ATR20. Trailing Stop nâng SL theo đáy 10 ngày (10D Low).
   - Đạt kiểm định khoa học: $t = +3.35$, $ExpR = +0.604R$/lệnh sau phí Taker và funding.
2. **4H Đảo chiều (Hai đỉnh / Hai đáy - Double Top/Bottom):**
   - Phá đường viền cổ (Neckline) đồng thuận tuyệt đối với xu hướng Ngày của BTC và Coin.
3. **4H Phá nền (BOS - Break of Structure):**
   - Hiện tại đang được bật có điều kiện: chỉ kích hoạt khi nến 4H đóng dứt khoát (Clean Body), có Volume xác nhận ($\ge 0.75\times$ SMA20), và đồng thuận xu hướng với BTC Ngày (Short khi BTC giảm, Long khi BTC tăng).

---

### 3. Toàn bộ các bản vá bảo mật đã áp dụng (Commit `0224128` & `4f6e0cb`)

1. **Khóa an toàn Dry-run (`lib/mexc-client.ts`):**
   - Cả hai hàm `submitMexcOrder` và `submitMexcTpSl` đều dùng công thức an toàn:
     `isDryRun = defaultDryRun || params.dryRunOverride === true;`
   - Tuyệt đối không bao giờ cho phép biến một hệ thống đang ở chế độ Dry-run thành Live.
2. **Khóa cứng Flow 1H:**
   - Trong `lib/telegram-alerts.ts`, flow 1H luôn truyền `dryRunOverride: true`. Khung 1H 100% chỉ chạy Paper & gửi Alert Telegram, không bao giờ vào tiền thật.
3. **Chuẩn hóa Contract Size tĩnh (`lib/mexc-contracts-data.ts`):**
   - Đã nhúng cứng bảng tra cứu Contract Size cho 39 coin giao dịch MEXC Futures (DOGE = 100, WIF = 10, TAO = 0.01,...). Hệ thống trên Railway không bị phụ thuộc vào file gitignore `data/mexc-contracts.json`, triệt tiêu hoàn toàn rủi ro sai volume 10x-100x.
4. **Bảo vệ Trailing Stop & Thoát lệnh (`lib/telegram-alerts.ts` & `lib/mexc-client.ts`):**
   - Bọc `try-catch` riêng lẻ cho từng vị thế để tránh crash cả chu kỳ quét.
   - Hàm `updateMexcStopLossPrice` có chốt Ratchet: chỉ cho phép nâng SL cao hơn (khóa lãi), tuyệt đối từ chối nếu hạ SL xuống thấp hơn.
   - Logic dời SL về Breakeven không bị kích hoạt nhầm khi vị thế chỉ mở 1 hợp đồng.
5. **Weekend Guard (Nghỉ cuối tuần T7/CN):**
   - Từ 00:00 T7 đến 23:59 CN (UTC): Bot tự động chuyển các tín hiệu sang chế độ Paper/Alert, tạm dừng mở vị thế thật để tránh bẫy rút chân thanh khoản mỏng.
6. **Kiểm tra trôi giá không gây chặn hiển thị (`lib/decision-engine.ts`):**
   - Chỉ kiểm tra độ trôi giá (`RUNAWAY_PRICE`) khi caller có truyền `livePrice`. Các endpoint hiển thị (Watchlist, Telegram webhook) không bị lỗi `INVALID_DATA`.

---

### 4. Lưu ý quan trọng cho Agent kế tiếp khi can thiệp:
- **Tài khoản đang an toàn tuyệt đối (0 lệnh mở, 50.56$ tiền mặt).**
- Bất kỳ thay đổi nào liên quan đến logic đặt lệnh phải giữ nguyên nguyên tắc **Fail-closed**: nếu không đặt được SL thì phải lập tức market-close vị thế ngay.
- Kiểm thử luôn luôn phải chạy qua lệnh `npm run test:policy` trước khi commit.
