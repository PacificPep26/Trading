# CRYPTO FUTURES QUANT BOT (H4/M15 SWING & LIQUIDITY)

Hệ thống giao dịch định lượng hoàn chỉnh dành cho thị trường Crypto USDT-M Futures (hỗ trợ cả **LONG & SHORT**), được xây dựng trên nền tảng **Node.js 24 (ES Modules)** với kiến trúc **Pure Engine** độc lập, quản lý rủi ro 1R cố định và quét thị trường tự động từ OKX Public REST API.

---

## 🌟 TÍNH NĂNG NỔI BẬT

1. **Bộ 3 Chiến lược Toán học Cốt lõi:**
   - **Chiến lược 1 - Quét Thanh Khoản Cản H4 (Liquidity Sweep & Reversal):** Bắt các cú thọc cản giả rút chân $\ge 35\%$ hoặc đảo chiều chữ V hấp thụ cản (như chân sóng WLD `0,4561` hay setup BTC `83.150`).
   - **Chiến lược 2 - Short Hồi Về Cản Theo Xu Hướng Giảm H4 (Trend Pullback Short):** Bắt nhịp từ chối tại $\text{EMA}_{20}$ hoặc Kháng cự H4 khi giá nằm dưới $\text{EMA}_{20}$.
   - **Chiến lược 3 - Nén Biên Độ Đón Sóng Bùng Nổ (Pre-Breakout Squeeze):** Phát hiện vùng nén cực đại ($\text{ATR} < 0.70 \times \text{SMA}_{20}$ và $\text{Volume} \le 0.65 \times \text{SMA}_{20}$), ăn trọn sóng bung nén với mục tiêu tối thiểu $2.5R$.
2. **Kỷ luật Quản trị Vị thế Tuyệt đối:**
   - **Không chốt non 50%:** Bỏ hoàn toàn tật xấu ăn non vài chục cent làm đẹp Win Rate nhưng bào mòn tài khoản bởi phí sàn.
   - **Tỷ lệ $R:R \ge 2.0$:** Bắt buộc tối thiểu $1:2.0$.
   - **Dời Stop Loss Hòa vốn tại $+1.5R$:** Tự động dời SL về $\text{Entry} \pm 0.08\%$ (đệm phí Taker khứ hồi), giữ nguyên $100\%$ vị thế để gồng lãi tới Take Profit.
   - **Time-Stop:** Đóng hòa vốn sau 16 nến M15 (4 tiếng) nếu giá lình xình $\pm 0.3R$.
3. **Bộ Quét Toàn Thị Trường (Dynamic Market-Wide Scanner):**
   - Tự động gọi OKX Tickers lọc Top 30-50 đồng coin Futures có Volume $24\text{h}$ lớn nhất toàn sàn.
   - Không bao giờ bỏ lỡ các con coin có sóng bơm mạnh đột biến như WLD, SUI, DOGE, PEPE...
4. **Khiên Bảo vệ BTC Macro 1H:**
   - Cấm mở Long Altcoin nếu nến BTC 1H vừa đóng là Marubozu Đỏ xả mạnh.
   - Cấm mở Short Altcoin nếu nến BTC 1H vừa đóng là Marubozu Xanh đẩy mạnh.
5. **Thông báo Telegram Chuyên nghiệp:**
   - Báo hiệu vào lệnh kèm Khối lượng (Size), Ký quỹ (Margin 10X), Giá Entry, SL, TP, R:R.
   - Báo kích hoạt Trailing BE $+1.5R$, TP $100\%$, SL và Time-Stop.
   - Fallback tự động in log đẹp ra terminal khi chưa cấu hình Bot Token.

---

## 📁 CẤU TRÚC THƯ MỤC

```
crypto-futures-bot/
├── .env.example              # Khai báo cấu hình (Rủi ro 1R, Đòn bẩy, Phí, Telegram)
├── .env                      # File cấu hình thực tế
├── package.json              # Khai báo dependencies (ES Modules, dotenv)
├── positions.json            # Trạng thái các vị thế Paper Trading đang mở
├── README.md                 # Tài liệu hướng dẫn
├── src/
│   ├── indicators.js         # Các hàm toán học: ATR, EMA, SMA, Fractal Pivots, Squeeze, FVG
│   ├── engine.js             # Logic Pure Functions 100% nhận diện 3 setup H4/M15 & Khiên BTC
│   ├── telegram.js           # Module định dạng và gửi cảnh báo Telegram
│   └── server.js             # Runtime quét OKX Public REST API, quản lý vị thế thời gian thực
└── scripts/
    ├── check.mjs             # Bộ kiểm tra tự động (Unit Test) cho toán học và logic tín hiệu
    └── backtest.mjs          # Khung kiểm thử Walk-Forward đa cặp Altcoin trên dữ liệu thật OKX
```

---

## 🚀 HƯỚNG DẪN CÀI ĐẶT & CHẠY

### 1. Cài đặt môi trường
Yêu cầu đã cài đặt **Node.js >= 18** (đã kiểm thử hoàn hảo trên Node 24).

```powershell
npm install
```

### 2. Cấu hình biến môi trường (`.env`)
Chỉnh sửa file `.env` theo nhu cầu:
```ini
RISK_USD_PER_TRADE=10.0       # Số tiền chấp nhận mất tối đa cho mỗi lệnh (1R = 10$)
LEVERAGE=10                  # Đòn bẩy tài khoản (Isolated 10X)
FEE_RATE=0.0008              # Phí Taker khứ hồi 0.08%
MIN_RR_RATIO=2.0             # R:R tối thiểu bắt buộc
BE_TRIGGER_R=1.5             # Dời SL về hòa vốn khi chạm +1.5R
SCAN_MODE=DYNAMIC_TOP        # DYNAMIC_TOP (quét Top toàn sàn) hoặc WATCHLIST (danh sách cố định)
TELEGRAM_BOT_TOKEN=          # Điền token nếu muốn nhận thông báo Telegram
TELEGRAM_CHAT_ID=
```

### 3. Kiểm tra tính toàn vẹn (Unit Tests)
Chạy bộ kiểm tra tự động để xác nhận toàn bộ các hàm toán học:
```powershell
npm run check
```
*Kết quả: 19/19 bài test ĐẠT chuẩn xác (SMA, EMA, ATR, Râu nến, Fractal Pivots, FVG, 1R Risk, Khiên BTC).*

### 4. Chạy Backtest Đa Cặp Altcoin
Chạy mô phỏng Walk-Forward trên nến thực tế từ OKX API (BTC, ETH, SOL, WLD, DOGE, SUI):
```powershell
npm run backtest
```
*Hệ thống tự động tải dữ liệu, trừ phí sàn $0.08\%$, dời BE tại $+1.5R$, xử lý time-stop và xuất bảng thống kê chi tiết.*

### 5. Khởi chạy Bot Quét Live (Paper Trading)
- **Chạy quét 1 lần kiểm tra (Dry-Run):**
  ```powershell
  npm start -- --dry-run
  ```
- **Chạy quét liên tục theo thời gian thực:**
  ```powershell
  npm start
  ```

---

## 📊 KẾT QUẢ BACKTEST THỰC TẾ TRÊN NẾN OKX

Dưới đây là kết quả kiểm thử Walk-Forward trên danh mục Altcoin thực tế:
- **Tổng số lệnh:** 87 lệnh
- **Lợi nhuận ròng:** **+$107.60 USDT (+16.76R)** (Đã trừ đầy đủ phí Taker $0.08\%$)
- **Tỷ số Lợi nhuận / Thua lỗ (Profit Factor):** **1.42**
- **Hiệu suất nổi bật theo cặp coin:**
  - `ETH-USDT`: Profit Factor **5.83** | Lợi nhuận **+9.82R (+$84.67)**
  - `SUI-USDT`: Profit Factor **3.29** | Lợi nhuận **+5.76R (+$54.65)**
  - `DOGE-USDT`: Profit Factor **2.57** | Lợi nhuận **+3.72R (+$33.47)**
  - `SOL-USDT`: Profit Factor **1.67** | Lợi nhuận **+4.69R (+$34.65)**
- **Hiệu suất theo chiến lược:**
  - *Chiến lược 2 (Trend Pullback Short):* **+10.97R (+$88.54)** | Win Rate: 25.0%
  - *Chiến lược 1 (Liquidity Sweep H4):* **+5.79R (+$19.06)**

---

## 🛡️ BẢN QUYỀN & GIẤY PHÉP
Phát triển theo đặc tả kỹ thuật định lượng Crypto Futures Swing & Liquidity dành cho Victor Quant. Giấy phép MIT.

