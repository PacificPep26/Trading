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

### 2. Các chiến lược và Quyền hạn Live (Đã đồng bộ trung thực với Khung Giờ & Chuẩn Kim Cương)
Quy định tập trung tại hàm `isLiveEligible` và `isAutoTradeTimeWindow` trong `lib/trading-policy.ts`:
1. **Daily Trend Following (1D Donchian Breakout 20D):**
   - Vào lệnh khi nến ngày đóng phá đỉnh 20 ngày và BTC Ngày Uptrend.
   - **Cơ chế thoát lệnh chuẩn backtest:** KHÔNG đặt TP1/TP2 cố định. Gồng lãi theo xu hướng, SL ban đầu 2×ATR20. Khi nến ngày đóng cửa thủng đáy 10 ngày (10D Low) -> đóng Market thoát lệnh ngay lập tức (dù đang lãi hay lỗ). Không trailing SL trong ngày (backtest chỉ thoát theo giá đóng nến ngày); còn lại giữ SL 2×ATR. Bot nhận diện vị thế 1D = vị thế LONG không có lệnh TP nào.
2. **Khung Giờ Tự Động Vào Lệnh Thực Chiến (16:00 Chiều - 08:00 Sáng hôm sau VN, UTC+7):**
   - Kích hoạt cơ chế tự động mở lệnh MEXC cho cả **LONG ("bật nền")** và **SHORT ("rớt nền" / thủng đáy)** theo Chuẩn Kim Cương (Diamond Standard):
     - `volumeRatio >= 2.0x` (loại bỏ 95% bẫy quét râu giả và thanh khoản cạn kiệt).
     - Thuận xu hướng lớn: Long khi Coin & BTC Ngày Uptrend; Short khi Coin & BTC Ngày Downtrend.
     - Mô hình áp dụng: CHỈ Double Top/Bottom. BOS 4H chỉ Paper/Cảnh báo (backtest 2025–26 với vol ≥ 2x vẫn −0.12R/lệnh sau phí, 116 lệnh).
     - Thẻ thông báo Telegram: `🤖 [MEXC TỰ ĐỘNG VÀO LỆNH (16H-8H)]`.
3. **Khung Giờ Ban Ngày (08:00 Sáng - 16:00 Chiều VN):**
   - Chuyển sang chế độ Paper / Cảnh Báo Telegram để người dùng tự xem xét và bấm tay nếu muốn:
     - Thẻ thông báo Telegram: `🎯 [CẢNH BÁO BAN NGÀY - TỰ BẤM TAY]`.
4. **Khung 1H & Radar 15m:**
   - Dùng để lướt sóng Paper và cung cấp radar định vị nhịp hồi tối ưu. Không tự động vào lệnh trực tiếp tiền thật.

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
   - 🚪 **Thoát lệnh 1D:** `🚪 [MEXC THOÁT LỆNH 1D - TREND EXIT]` khi nến ngày đóng thủng đáy 10 ngày.
   - 🎯 **Bắn tỉa 15m (tham khảo):** `🎯 [BẮN TỈA 15M - THAM KHẢO, KHÔNG VÀO LỆNH]`, chỉ là tin báo.

---

### 5. Bắn tỉa 15m (`lib/sniper-engine.ts`) — CHỈ BÁO TIN, KHÔNG VÀO LỆNH
1. **Cơ chế:** kèo 1H được engine chấp nhận → đưa coin vào `sniperRadar` 90 phút (chỉ trong RAM). Chỉ xét nến 15m đóng SAU khi nến 1H phá vỡ đã đóng; kích hoạt khi nến 15m chạm vùng cản/chiết khấu rồi rút chân (râu ≥ 45%) hoặc nuốt chửng. SL dưới/trên râu 15m, cho phép **0.4%–2.5%**; TP1 1.5R, TP2 3R.
2. **Thông tin kèm theo (chỉ hiển thị, không lọc):** giờ phiên London 08:00–12:00 giờ London, New York 09:30–13:30 giờ New York (tự đổi theo giờ mùa hè/đông); "cá mập hấp thụ" = nến 15m đã đóng có volume ≥ 2× TB20 và râu ≥ 40%.
3. **Đã bỏ "Bẫy ép phí funding"**: ngược với bộ lọc `EXTREME_FUNDING` (|funding| > 0.03% là chặn) của decision engine nên không bao giờ hiện.
4. **Backtest 2023–2026** ([sniper_15m_study.mjs](service/scripts/sniper_15m_study.mjs), dùng đúng code live, 21 coin, phí taker 0.08%/chiều + trượt 0.02%, TP1 rồi dời SL hòa vốn): **5.903 lệnh, −0.31R/lệnh, t=−18, win 38%**; năm nào cũng âm (−0.25 → −0.34R); chưa trừ phí vẫn −0.07R. Với 4$/lệnh ≈ −7.246$. Lọc theo phiên hay cá mập hấp thụ đều không cứu được (mọi nhóm −0.19 → −0.37R). So sánh: vào ngay kèo 1H như bot đang báo là −0.08R/lệnh (t=−8). → **Không đưa lên live.**
