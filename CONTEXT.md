# TÀI LIỆU BÀN GIAO NGỮ CẢNH HỆ THỐNG TRADING (BOT LIVE MEXC)
*Cập nhật lúc: 15:58 Thứ Bảy, ngày 10/10/2026 (Giờ VN)*

---

### 1. Trạng thái tài khoản Live MEXC hiện tại
- **Server:** Đang chạy ổn định trên Railway (`https://helpvictor.up.railway.app`).
- **Số dư thực tế:** `50.566 USDT` (100% tiền mặt khả dụng, không có margin bị khóa).
- **Vị thế mở (Open Positions):** `0` vị thế. Toàn bộ lệnh cũ và các lệnh điều kiện (Plan orders) đã được đóng và hủy sạch sẽ.
- **Cấu hình môi trường:**
  - `MEXC_LIVE_TRADING=true`
  - `MEXC_DRY_RUN=false`
- **Mức vốn & Quản lý rủi ro (Tier 1 Starter):**
  - **Risk per trade:** Cố định **$4.0 USDT / lệnh** (quy định tại `lib/capital-tier.ts`).
  - **Số lệnh mở tối đa:** Tối đa 2 lệnh (hoặc 3 lệnh nếu là Kèo Đẹp Star Setup).
  - **Đòn bẩy thích ứng (Adaptive Leverage):** Mặc định x10 Isolated. Tự động hạ xuống **x5 Isolated** nếu khoảng cách SL > 6% (đặc biệt là khung Ngày 1D) để điểm thanh lý luôn cách xa $\ge 18\%$, triệt tiêu hoàn toàn rủi ro bị thanh lý trước khi chạm SL.
  - **Đệm chốt lời 4H:** TP1 tại `0.90R` (khớp sớm dời SL về BE) và TP2 tại `1.85R` (đón đầu trước cản/đáy cũ).

---

### 2. Các chiến lược và Quyền hạn Live (Đã đồng bộ trung thực với Nhật ký Nghiên cứu)
Quy định tập trung tại hàm `isLiveEligible` trong `lib/trading-policy.ts`:
1. **Daily Trend Following (1D Donchian Breakout 20D):**
   - Vào lệnh khi nến ngày đóng phá đỉnh 20 ngày và BTC Ngày Uptrend.
   - **Cơ chế thoát lệnh chuẩn backtest:** KHÔNG đặt TP1/TP2 cố định. Gồng lãi theo xu hướng, SL ban đầu 2×ATR20. Trailing Stop nâng SL theo đáy 10 ngày (10D Low).
   - *Lưu ý nghiên cứu:* Nhật ký 10/10 ghi rõ lợi thế thị trường chủ yếu ở 2023–2024, giai đoạn 2025–2026 thị trường đi ngang nên lợi thế suy giảm. Cần quản lý vốn chặt chẽ.
2. **4H Đảo chiều (Hai đỉnh / Hai đáy - Double Top/Bottom):**
   - Phá đường viền cổ (Neckline) đồng thuận tuyệt đối với xu hướng Ngày của BTC và Coin ($t = 1.04$).
3. **4H Phá nền (BOS - Break of Structure) & 1H:**
   - **CHỈ CHẠY PAPER & TELEGRAM ALERT** (Không vào tiền thật).
   - Số liệu kiểm toán trên 881 lệnh sau phí Taker MEXC 0.16% là $-0.005R$ ($t = -0.17$), chưa đủ điều kiện khoa học để chạy live tiền thật.

---

### 3. Toàn bộ các bản vá logic & bảo mật đã áp dụng
1. **Tách biệt hoàn toàn Live vs Paper (`lib/telegram-alerts.ts`):**
   - Tách riêng `liveOpenSymbols` và cơ chế trừ `remainingMargin`: Lệnh Paper 1H và lệnh Mock 4H không bao giờ trừ tiền thật hay chiếm chỗ của lệnh Live.
   - Sửa giới hạn vị thế: `maxLiveLimit = Math.max(currentTier.maxOpenTrades, 3)`.
2. **Kích hoạt Bộ lọc Funding Rate thực tế (`lib/okx.ts` & `lib/decision-engine.ts`):**
   - Quét `fundingRate` trực tiếp từ thị trường và truyền vào `evaluateSetup` để bộ lọc `EXTREME_FUNDING` hoạt động đúng cam kết.
3. **Khóa an toàn Dry-run (`lib/mexc-client.ts`):**
   - Cả hai hàm `submitMexcOrder` và `submitMexcTpSl` đều dùng công thức an toàn:
     `isDryRun = defaultDryRun || params.dryRunOverride === true;`
   - Truyền `dryRunOverride: mexcOrder.isDryRun` đồng bộ ở mọi flow.
4. **Chuẩn hóa Contract Size tĩnh (`lib/mexc-contracts-data.ts`):**
   - Nhúng cứng bảng tra cứu Contract Size cho 39 coin giao dịch MEXC Futures (DOGE = 100, WIF = 10, TAO = 0.01,...).
5. **Weekend Guard (Nghỉ cuối tuần T7/CN):**
   - Từ 00:00 T7 đến 23:59 CN (UTC): Tự động chuyển các tín hiệu sang chế độ Paper/Alert để tránh bẫy rút chân thanh khoản mỏng.
