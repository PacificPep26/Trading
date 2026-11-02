# PROJECT GUIDE & AGENT DISCIPLINE (CLAUDE.md)
## Crypto Futures Quant Bot (OKX USDT-M - Dr. Kane H4/M15 Strategy)

Tài liệu này có hai tầng:
- **Kỷ luật kỹ thuật bất biến** (mục 1, 2, 3 và phần chống look-ahead, SL-first, Fixed 1R ở mục 4): đảm bảo số liệu và backtest đáng tin, KHÔNG được bỏ qua.
- **Cơ chế giao dịch** (chiến lược, bộ lọc, quản lý lệnh): KHÔNG cố định. Phải thay đổi khi có bằng chứng định lượng là tốt hơn, theo quy trình ở mục 6. Mô tả cơ chế trong tài liệu này là trạng thái hiện tại, không phải chân lý.

---

### 1. QUY TẮC BẢO ĐẢM HỢP ĐỒNG DỮ LIỆU (DATA CONTRACT MANDATE)
- **Đồng nhất Schema Nến:** Mọi hàm producer nến (như `fetchOkxCandles`, cache loader, backtest loader) BẮT BUỘC phải chuẩn hóa dữ liệu thông qua hàm `normalizeCandle()` trong `src/indicators.js`.
- **Schema Nến chuẩn:**
  ```javascript
  {
    ts: number,       // Timestamp mở nến (ms)
    open: number,     // Giá mở
    high: number,     // Giá cao nhất
    low: number,      // Giá thấp nhất
    close: number,    // Giá đóng
    vol: number,      // Khối lượng giao dịch
    confirm: number   // 1 = Nến đã hoàn thành/đóng, 0 = Nến đang chạy
  }
  ```
- **Kỷ luật Consumer:** Bất kỳ khi nào sửa đổi trường dữ liệu trả về của một hàm, BẮT BUỘC phải dùng `git grep` hoặc tìm kiếm toàn bộ codebase để kiểm tra mọi consumer đang tiêu thụ dữ liệu từ hàm đó.

---

### 2. QUY TẮC ĐƯỜNG LIVE & KIỂM THỬ BẮT BUỘC (LIVE-PATH MANDATE)
- **Không bao giờ chỉ tin vào test cache hoặc mock:** Dữ liệu backtest có thể pass trên cache nhưng bot live có thể bị lọc rỗng nếu lệch schema.
- **Quy trình Verify 3 bước bắt buộc trước khi bàn giao bất kỳ task nào:**
  1. `npm run check`: Chạy toàn bộ Unit Tests và Contract Tests (phải đạt 100% PASS).
  2. `node src/server.js --single-run`: **BẮT BUỘC** chạy đường live thực tế với OKX API để xác nhận scanner không bị tắc nghẽn, không bị rỗng nến và xử lý đúng vị thế.
  - Bước 2 là DRY-RUN: `--single-run` KHÔNG gửi Telegram thật và không ghi trạng thái cooldown (chỉ in ra màn hình); trạng thái chống trùng cảnh báo bền ở `data/alerts/`.
  3. `npm run backtest` + `node scripts/backtest_1year.mjs` + `node scripts/backtest_multi_year.mjs`: Walk-Forward 1 tháng, 1 năm và đa năm (2021-26) để đảm bảo không hồi quy. Kết quả 1 tháng/1 năm đơn lẻ KHÔNG đủ để kết luận.

---

### 3. QUY TẮC ĐƠN VỊ THỜI GIAN & BIẾN ĐẾM (TIME & UNIT SEMANTICS)
- **Phân biệt rạch ròi đơn vị:**
  - `CONFIG.pollIntervalSec`: Chu kỳ của vòng lặp quét (giây, mặc định 60s).
  - Nến M15: Khung thời gian chiến lược (15 phút = $15 \times 60 \times 1000$ ms).
  - Tuyệt đối KHÔNG đếm "số lần quét" thành "số nến M15".
- **Cách tính Time-Stop chuẩn xác:**
  - `pos.currentBarsM15 = Math.floor((Date.now() - pos.openedAt) / (15 * 60 * 1000))`
  - Điều này giúp bot không bị ảnh hưởng bởi việc khởi động lại server hoặc thay đổi chu kỳ quét `pollIntervalSec`.

---

### 4. QUY TẮC CHIẾN LƯỢC DR. KANE & QUẢN TRỊ RỦI RO
- **Chống Look-Ahead Bias 100%:**
  - Chỉ tính toán phân tích kỹ thuật và nhận diện mô hình trên nến đã hoàn thành (`confirm === 1`).
  - Nến đang chạy (`confirm === 0`) chỉ dùng để cập nhật giá hiện tại (Wick-level SL/TP/BE).
- **Kiểm tra SL/TP thời gian thực (Wick-Level):**
  - Đối chiếu theo `candle.high` và `candle.low`.
  - **Nguyên tắc bảo toàn vốn:** Nếu cùng một nến có râu giật quét cả SL và TP, BẮT BUỘC ưu tiên ghi nhận Stop Loss trước (chống ảo tưởng lợi nhuận).
- **Khiên BTC Macro 1H:**
  - BTC xả Marubozu đỏ: Chặn mở Long, nhưng **VẪN CHO PHÉP MỞ SHORT**.
  - BTC bơm Marubozu xanh: Chặn mở Short, nhưng **VẪN CHO PHÉP MỞ LONG**.
- **Kỷ luật Fixed 1R:**
  - Ký quỹ tính theo công thức: $\text{Size} = \frac{\text{Risk USD}}{|\text{Entry} - \text{SL}|}$.
  - Đòn bẩy tài khoản: Isolated 10X.
  - **Quản lý lệnh (hiện tại, 31/10/2026): SL/TP thuần**, gồng 100% vị thế tới Take Profit (>= 2.0R, đã trừ đệm 0.25% trước cản). Co SL (+0.8R -> -0.3R) và khóa lãi (+1.4R -> +0.05R) đã TẮT mặc định (`ENABLE_BE_MANAGEMENT=true` để bật lại) vì backtest 2021-26 cho thấy chúng chỉ cắt lãi lệnh thắng: PF 1.17 -> 1.26, +28.5R -> +52.4R. Cơ chế trailing cũ (khóa +1.0R tại +1.5R) không còn là quy tắc.

---

### 5. CẤU TRÚC THƯ MỤC CHÍNH
- `src/strategies/`: Các chiến lược tách module (`kane_strategy.js`, `zone_reaction.js`, `regime.js`, `quality_scorer.js`, `smc_fvg.js`, ...). Chiến lược thử nghiệm (macro range, breakout, trade flip, Wyckoff) nằm sau cờ `ENABLE_*` mặc định TẮT vì chưa đạt kiểm chứng.
- `docs/strategies/RESEARCH_LOG.md`: nhật ký các thử nghiệm đã giữ/bác bỏ kèm số liệu. Đọc trước khi thử lại bất cứ ý tưởng nào.
- `src/indicators.js`: Thư viện hàm toán học thuần túy (EMA, ATR, Fractals, Squeeze, FVG, `normalizeCandle`, `validateCandleSchema`).
- `src/engine.js`: Lõi chiến lược Dr. Kane (KANE_THUAN_TREND, KANE_NGUOC_TREND, BTC Macro Shield, Position Sizing 1R).
- `src/server.js`: Runtime Live Scanner kết nối OKX Public REST API, quản lý Paper Trading, bảo vệ vị thế và gửi Telegram.
- `src/telegram.js`: Module gửi cảnh báo Markdown v2 tới Telegram Bot.
- `scripts/check.mjs`: Bộ kiểm thử tự động (Unit Tests & Contract Tests).
- `scripts/backtest.mjs`: Khung Walk-Forward Backtesting trên dữ liệu lịch sử.

---

### 6. QUY TRÌNH THAY ĐỔI CƠ CHẾ (EVIDENCE-DRIVEN)
- **Cơ chế phải đổi khi có bằng chứng tốt hơn, và không được giữ chỉ vì "đã từng như vậy".** Mọi quy tắc giao dịch đều là giả thuyết có thể bị bác bỏ.
- Mỗi thay đổi chiến lược/bộ lọc/quản lý lệnh phải: (1) đặt tiêu chí chấp nhận trước khi chạy (số lệnh tối thiểu, PF, số giai đoạn dương, không làm danh mục tệ đi); (2) đo bằng `backtest_1year` VÀ `backtest_multi_year` có phí 2 chiều; (3) có test đơn vị (viết trước, thấy đỏ, rồi mới code); (4) nằm sau cờ, bật mặc định chỉ khi đạt tiêu chí; (5) ghi kết quả (kể cả bác bỏ) vào `docs/strategies/RESEARCH_LOG.md`.
- Cảnh giác khớp quá (overfit): đẹp trên 1 năm hoặc vài sóng chọn tay không đủ; cần ngoài mẫu (học giai đoạn trước, thử giai đoạn sau) và theo dõi paper trading trước khi tin.
- Thử nghiệm đo khi còn cơ chế cũ có thể cần đo lại sau khi cơ chế khác đã đổi (ví dụ bác bỏ minRR/ngưỡng điểm được đo khi còn co SL/khóa lãi).
