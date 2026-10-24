# Hệ thống Phương pháp Giao dịch VWAP/EMA9 TFC + ICT Sweep-FVG (Scalping/Day Trading)

> Tài liệu tham chiếu do người dùng cung cấp (24/10/2026), đúc kết từ 4 video. Lưu
> nguyên văn làm đặc tả lâu dài. **Chưa được triển khai thành code** — xem
> `docs/REGIME_ADAPTIVE_PLAN.md` Phần 5 để biết điều kiện và thứ tự triển khai.

Hệ thống kết hợp việc lọc xu hướng, bắt nhịp hồi (Pullback), bẫy thanh khoản
SMC/ICT, và kỹ thuật vào lệnh TFC theo VWAP.

## 1. Bản chất cốt lõi & Nguyên tắc sống còn
- Xu hướng là bạn: Luôn giao dịch thuận theo xu hướng chính.
- Bức tranh lớn trước: Phân tích khung thời gian lớn trước (H1, H4). Nếu khung lớn
  đi ngang (sideway) hoặc VWAP nằm ngang/phẳng, hãy đứng ngoài.
- Không FOMO đuổi đỉnh/đáy: Giá đi theo từng nhịp (leo cầu thang), phá đỉnh không
  đồng nghĩa với mua ngay vì rất dễ rơi vào bẫy quét thanh khoản.
- Kỷ luật thống kê: Một phương pháp chỉ thực sự phản ánh đúng sau hàng trăm lệnh
  thử nghiệm (Backtest / Forward test).

## 2. Thiết lập công cụ & Khung thời gian
- Khung thời gian:
  - Khung định hướng xu hướng: H1 / H4 (hoặc M15).
  - Khung tìm điểm vào lệnh: M5.
- Chỉ báo kỹ thuật:
  - VWAP (Volume-Weighted Average Price): Bật duy nhất đường trung tâm VWAP (tắt các
    dải biên Upper/Lower/Band fill).
  - EMA 9 (Exponential Moving Average 9): Dùng để bám xu hướng và làm tín hiệu thoát
    lệnh an toàn.
  - Thước Fibonacci thoái lui: Đo con sóng đẩy gần nhất.

## 3. Quy trình vào lệnh chi tiết
Hệ thống cung cấp 2 kịch bản đánh: Đánh tiếp diễn xu hướng và Đánh đảo chiều bẫy
thanh khoản.

### Chiến lược A: Đánh Tiếp Diễn (TFC: Trend - Failure - Continuation)
Áp dụng khi thị trường có xu hướng mạnh, giá hồi (Pullback) kiểm tra lại VWAP/cản
rồi tiếp tục con sóng.

**Mô hình lệnh MUA (BUY) tiếp diễn:**
```
Giá
▲               [Phá vỡ đỉnh (Break High) -> VÀO LỆNH BUY (Stop Order)]
│                   ▲
│                  /│\
│       Đỉnh gần  / │ \
│       ---●-----/--│--\------------------------- (Mức cản trên)
│         / \   /   │   \
│        /   \ /    │    \
│  Sóng /     ●     │     \
│  tăng/   (Nhịp hồi/Retest VWAP)
│     /
│    /  ~~~~~~~~~~~~~~~~ Đường VWAP dốc lên ~~~~~~~~~~~~~~~~
│   /
└────────────────────────────────────────────────────────► Thời gian
         [SL: Đặt dưới đáy gần / Dưới đường VWAP]
```

- Bước 1 (Xác định cấu trúc): Trên H1/M5, giá nằm trên VWAP và VWAP dốc lên rõ ràng.
- Bước 2 (Nhịp Pullback): Giá hồi nhẹ về đường VWAP hoặc vùng Fibonacci 50%-61.8%
  với nến thân nhỏ và volume giảm dần.
- Bước 3 (Kích hoạt lệnh bằng Lệnh chờ phá):
  - Không đoán đáy nhịp hồi.
  - Đặt lệnh chờ mua Buy Stop ngay phía trên đỉnh của cây nến vừa bật tăng lên.
  - Nguyên tắc: Khớp lệnh khi có lực phá vỡ mức cao, không phá vỡ thì lệnh không
    khớp (không mất tiền).
- Bước 4 (Cắt lỗ & Chốt lời):
  - SL (Dừng lỗ): Đặt dưới đáy nhịp hồi hoặc dưới đường VWAP.
  - TP (Chốt lời): Đặt tại đỉnh cũ, vùng thanh khoản tiếp theo trên khung lớn, hoặc
    gồng lệnh theo EMA 9 (chỉ chốt khi có nến M5 đóng cửa thủng dưới EMA 9).

(Kèo Bán - SELL thực hiện tương tự theo chiều ngược lại: Giá dưới VWAP dốc xuống ->
Hồi về retest VWAP -> Đặt Sell Stop dưới đáy gần nhất).

### Chiến lược B: Đánh Đảo Chiều Quét Thanh Khoản (ICT Sweep Liquidity)
Áp dụng khi giá tiếp cận đỉnh/đáy của ngày hôm trước (PDH / PDL) hoặc cản cứng nhưng
không phá vỡ thật.

**Mô hình lệnh BÁN (SELL) khi quét thanh khoản:**
```
Giá
▲                   [Quét đỉnh PDH tạo râu nến (Sweep)]
│                        /\
│     PDH (Đỉnh cũ) ----/--\---------------------- (Bẫy thanh khoản)
│                      /    \
│                     /      ▼ (Sập mạnh tạo ChoCh nến đóng dưới đáy cũ)
│                    /        \
│                   /          \    ▲ (Hồi kiểm tra)
│                  /            \  /│\
│                 /              ●/─┴─\── [VÀO LỆNH SELL tại FVG]
│                /                    │
│               /                     │
│              /                      ▼ [TP: Tại đáy hôm qua PDL]
└────────────────────────────────────────────────────────► Thời gian
           [SL: Đặt ngay trên đỉnh vừa quét Sweep]
```

- Bước 1 (Quét thanh khoản - Sweep): Giá đẩy nhanh vượt qua đỉnh ngày hôm trước
  (PDH), khớp hết các lệnh Buy FOMO và Stop loss của phe Sell, nhưng không giữ được
  giá mà rút râu hoặc đóng nến quay trở lại bên dưới đỉnh.
- Bước 2 (Xác nhận đảo chiều - ChoCh): Đợi nến giảm đóng cửa phá vỡ xuống dưới đáy
  gần nhất (Change of Character).
- Bước 3 (Tìm điểm vào FVG): Xác định khoảng trống giá (Fair Value Gap - FVG) tạo
  bởi khoảng hở giữa râu nến 1 và râu nến 3. Đặt lệnh Sell Limit khi giá hồi phục
  trở lại chạm vào FVG.
- Bước 4 (Cắt lỗ & Chốt lời):
  - SL: Đặt an toàn ngay phía trên đỉnh cao nhất của cú quét râu (Sweep).
  - TP: Chốt lời mục tiêu tại đáy của ngày hôm trước (PDL).

## 4. Bảng Quy tắc Quản lý vốn & Quản lý lệnh

| Tiêu chí | Quy định chuẩn |
|---|---|
| Tỷ lệ R:R (Risk/Reward) | Tối thiểu từ 1:1.6 đến 1:2 trở lên. Nếu cản quá gần dẫn đến tỷ lệ R:R xấu thì bỏ qua lệnh. |
| Vào lệnh | Ưu tiên lệnh chờ (Stop/Limit), không vào lệnh mù quáng khi nến chưa xác nhận cấu trúc. |
| Quản lý vị thế | Khi lệnh đã chạy được lợi nhuận gấp đôi rủi ro (2R), tiến hành dời SL theo các mốc cấu trúc đỉnh/đáy để bảo vệ thành quả và để lệnh tiếp tục chạy. |
| Thoát lệnh linh hoạt | Nếu đang gồng xu hướng mạnh, có thể kết hợp thoát từng phần hoặc thoát toàn bộ khi nến M5 đóng cửa ngược qua đường EMA 9. |
| Bộ lọc không giao dịch | Đứng ngoài khi VWAP đi ngang tạo đường phẳng dài, hoặc khi khung lớn H1/H4 đang tích lũy đi ngang giữa vùng cản. |

## 5. Đối chiếu với engine hiện tại (`src/engine.js`)

- Chiến lược B gần như trùng khái niệm với `SMC_SWEEP_REVERSAL`/`SMC_ZONE_REACTION`
  đã có — khác biệt: (1) khung M5 thay vì M15/H4, (2) mốc PDH/PDL (daily) thay vì
  pivot H4/Tier liquidity hiện tại, (3) yêu cầu xác nhận ChoCh tường minh, engine
  hiện tại dùng wick ratio + VSA.
- Chiến lược A (TFC/VWAP) là khái niệm mới hoàn toàn — chưa có setup nào dùng VWAP
  hay vào lệnh bằng Stop Order tại đỉnh nhịp hồi.
- Cả 2 cần dữ liệu M5 (hiện bot chỉ dùng 15m/1H/4H) và chỉ báo VWAP + EMA9 (VWAP
  chưa có trong `src/indicators.js`, EMA9 tái dùng `calculateEMA` sẵn có).
- Điều kiện triển khai: xem `docs/REGIME_ADAPTIVE_PLAN.md` Phần 5 — chỉ làm sau khi
  backtest phân nhóm theo giai đoạn (Phần 2-3) cho thấy khoảng trống cụ thể, và phải
  chạy như setup M5 độc lập song song, không trộn vào `evaluateMarket()` hiện tại.
