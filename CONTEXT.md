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
   - **Cơ chế thoát lệnh chuẩn backtest:** KHÔNG đặt TP1/TP2 cố định. Gồng lãi theo xu hướng, SL ban đầu 2×ATR20. Khi nến ngày đóng cửa thủng đáy 10 ngày (10D Low) -> đóng Market thoát lệnh ngay lập tức (dù đang lãi hay lỗ). Nếu chưa thủng thì Trailing SL theo đáy 10D.
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
5. **Giao dịch Cuối tuần (T7/CN) (Đã mở khóa theo yêu cầu User ngày 10/10):**
   - Đã gỡ bỏ ép buộc dryRun cuối tuần. Bot quét và vào lệnh thật 24/7 cả T7 & CN nếu thỏa mãn điều kiện chiến lược.

---

### 4. Hệ thống thông báo Telegram (Vị trí xem & Cơ chế bắn tin)
Dành cho Agent và User tra cứu khi cần kiểm tra thông báo:
1. **Kênh nhận tin:**
   - Cấu hình qua 2 biến môi trường trên Railway:
     - `TELEGRAM_BOT_TOKEN`: Token bot Telegram gửi tin.
     - `TELEGRAM_CHAT_ID`: ID người dùng / Nhóm nhận tin thông báo.
   - Hàm phụ trách gửi tin: [`send(text)`](file:///d:/victor/Trading/lib/telegram-alerts.ts#L89-L110).
2. **Tần suất quét và gửi tin:**
   - Khởi chạy nền qua [`instrumentation.ts`](file:///d:/victor/Trading/instrumentation.ts#L1-L12) (Node.js runtime trên Railway):
     - Lần đầu: 30 giây sau khi server khởi động.
     - Định kỳ: Mỗi **5 phút** gọi `scanAndAlert()` một lần.
   - Endpoint thủ công / Cron ngoài: `GET /api/cron/telegram`.
3. **Các loại thông báo bắn về Telegram:**
   - 🤖 **Lệnh Live thật:** `🤖 [MEXC ĐÃ VÀO LỆNH THẬT - {vol} HĐ]` (Khung 1D Donchian hoặc 4H Đảo chiều hợp lệ).
   - 🚀 **Lệnh Paper / Cảnh báo:** `🚀 [VÀO LỆNH (PAPER)]` (Các kèo BOS 4H, 1H breakout nén biên độ để user tham khảo đánh tay).
   - 🔒 **Dời SL về hòa vốn:** `🔒 [MEXC] {symbol}: TP1 đã khớp → dời SL về giá vào (hòa vốn)`.
   - 🛑 **Cảnh báo khẩn:** Báo động nếu mở vị thế nhưng không đặt được Stop Loss hoặc dính lỗi API sàn.

---

### 5. Hệ thống Bắn Tỉa Đa Khung Thời Gian & Bẫy Dòng Tiền (Quant Multi-Timeframe Sniper v3.0)
Đã tích hợp và kích hoạt toàn bộ các mảnh ghép kỹ thuật tinh hoa (`lib/sniper-engine.ts`):
1. **Radar Rình Mồi 2 Giai Đoạn (2-Phase State Machine):**
   - Khi 1H phá đỉnh/đáy (BOS): Tuyệt đối không fomo mua ngay trên ngọn nến. Bot đưa coin vào `sniperRadar` theo dõi trong 90 phút.
   - Hạ xuống nến 15m kiểm tra nhịp hồi về cản (Pullback / Liquidity Sweep).
   - Chỉ kích hoạt khi nến 15m xuất hiện **Phản ứng Rút Chân (Pinbar $\ge 45\%$ râu) hoặc nến Nuốt Chửng (Engulfing)**.
   - SL rút ngắn xuống đáy râu 15m (**-0.6% đến -0.9%**), R:R tăng vọt lên 1:3+.
2. **Các Mảnh Ghép Bẫy Cấu Trúc Bổ Sung:**
   - **Khung Giờ Vàng (Session Window):** Nhận diện phiên London (14h-18h VN) và New York / Phố Wall (20h30-00h30 VN) khi thanh khoản toàn cầu dồi dào nhất.
   - **Cá Mập Hấp Thụ (Volume Absorption):** Bắt các cây nến có Volume nổ vọt $> 2.0\times$ nhưng giá rút chân mạnh (tay to chặn mua/bán).
   - **Bẫy Ép Phí (Funding Squeeze):** Phát hiện Funding âm sâu $\le -0.05\%$ (Short Squeeze tiềm năng) hoặc dương cao $\ge +0.06\%$ (Long Squeeze).
