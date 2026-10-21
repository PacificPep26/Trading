# PROJECT GUIDE & AGENT DISCIPLINE (CLAUDE.md)
## Crypto Futures Quant Bot (OKX USDT-M - Dr. Kane H4/M15 Strategy)

Tài liệu này quy định các nguyên tắc thiết kế bất biến và kỷ luật kỹ thuật bắt buộc dành cho mọi AI Agent khi thao tác trên codebase này.

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
  3. `npm run backtest`: Chạy Walk-Forward kiểm thử để đảm bảo chiến lược không bị hồi quy (regression).

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
  - Trailing Break-Even: Tự động dời SL về hòa vốn (+0.08% đệm phí) ngay khi giá chạm $+1.5R$.

---

### 5. CẤU TRÚC THƯ MỤC CHÍNH
- `src/indicators.js`: Thư viện hàm toán học thuần túy (EMA, ATR, Fractals, Squeeze, FVG, `normalizeCandle`, `validateCandleSchema`).
- `src/engine.js`: Lõi chiến lược Dr. Kane (KANE_THUAN_TREND, KANE_NGUOC_TREND, BTC Macro Shield, Position Sizing 1R).
- `src/server.js`: Runtime Live Scanner kết nối OKX Public REST API, quản lý Paper Trading, bảo vệ vị thế và gửi Telegram.
- `src/telegram.js`: Module gửi cảnh báo Markdown v2 tới Telegram Bot.
- `scripts/check.mjs`: Bộ kiểm thử tự động (Unit Tests & Contract Tests).
- `scripts/backtest.mjs`: Khung Walk-Forward Backtesting trên dữ liệu lịch sử.
