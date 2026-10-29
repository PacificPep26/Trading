# Kiểm chứng công thức gốc Dr. Kane (EMA 34-89) vs bot — 29/10/2026

> Người dùng cung cấp 4 ảnh công thức gốc Kane. Đã đối chiếu với code + test đa
> năm 2021-2026 (`scripts/backtest_multi_year.mjs`, customConfig). Đây là BỘ NHỚ
> QUYẾT ĐỊNH: 3 điểm lệch đã test đều KHÔNG cải thiện bot — đừng test lại từ đầu.

## 4 điểm bot lệch công thức Kane
1. **SL = 2×râu H4** (Kane) vs đệm ATR (`lastH4.low - atrBufferMultiplier*atrH1`).
2. **TP1=EMA34 / TP2=EMA89** (Kane, cho ngược-trend & sideway) vs 1 TP tại đỉnh/đáy cũ.
3. **RRmin > 1** (Kane) vs `minRR` 2.0.
4. ~~Không đánh T7/CN~~ — chưa test (ứng viên còn lại).

Lưu ý: method **thuận-trend** của Kane vốn TP = đỉnh/đáy cũ = ĐÚNG cái bot làm.
TP 2 tầng EMA (#2) chỉ cho ngược-trend (bot đã tắt, PF 0.00) & sideway → không
áp cho phần đang có lãi.

## Kết quả test (tổng 2021-2026, baseline = −4.61R / PF 0.99)
| Biến thể | Tổng R | Ghi chú |
|---|---|---|
| BASELINE | −4.61R | |
| #3 minRR 1.0 | −63.88R | tệ nhất — 1 TP chốt gần, không có runner bù |
| #3 minRR 1.5 | −44.51R | tệ |
| #1 SL=2×râu (luôn) | −22.06R | cứu 2023 (−67→−24R) NHƯNG giết năm trend |
| #1 gate H4 RANGING | −14.89R | |
| #1 gate D1 RANGING | −11.80R | |
| #1 gate BOTH RANGING | −4.00R | ≈ baseline nhưng DD tệ hơn (−86 vs −78) |

## Kết luận
- **#3 (RRmin<2): bác bỏ.** Bot chỉ 1 TP → chốt gần = cắt cụt lãi, kỳ vọng âm.
- **#1 (SL=2×râu): bác bỏ.** Lợi ích cắt máu 2023 dính liền hại ở năm trend;
  gate theo regime chỉ trượt dọc cùng đường đánh đổi, tổng vẫn ≈ baseline mà
  drawdown xấu hơn. Không tách được.
- **#2 (TP 2 tầng EMA): không áp dụng** cho method kiếm tiền (thuận-trend đã
  trùng Kane); chỉ liên quan ngược-trend/sideway mà bot đã loại/đã có zone reaction.
- Nguyên nhân gốc: công thức Kane là hệ THỦ CÔNG 2 tầng (TP1 chốt phần + TP2
  gồng runner, đọc nến bằng mắt). Tháo rời từng tham số nhét vào bot tự động
  1-TP thì mất tác dụng.

## Limit entry "canh trước" kiểu Kane (29/10 — KẾT QUẢ DƯƠNG)
Cờ `limitEntry` trong `scripts/backtest_1year.mjs` (mặc định tắt): đặt limit
post-only tại signal.entry, chỉ khớp (Maker) nếu giá hồi về chạm trong cửa sổ
chờ, chạy luôn = miss.

| Biến thể | Tổng R 5 năm | PF |
|---|---|---|
| BASELINE (Taker) | −4.61R | 0.99 |
| Maker (giả định luôn khớp = trần) | +31.43R | 1.06 |
| LIMIT thực tế (chờ retest) | +5.41R | 1.01 |

- **PHÍ là đòn bẩy mạnh nhất**: Taker→Maker lật −4.61R → +31.43R (chỉ đổi phí).
- Limit thực tế +5.41R: thắng baseline, đúng kỷ luật (không nới điều kiện vào).
  2022 (biến động) +18.89R tỏa sáng; 2024-25 (trend mạnh) hơi kém vì breakout
  chạy luôn không hồi → miss runner. Cửa sổ 4 vs 8 nến như nhau.
- **Chưa deploy được**: cần code đặt post-only limit THẬT trên OKX (bot đang
  paper, chưa có order API). Finding cho giai đoạn lên tiền thật.

## Auto-radar "canh trước" (29/10 — ĐÃ WIRE)
`src/server.js`: mỗi chu kỳ quét, coin áp sát cản/hỗ trợ → tự bắn Telegram
`🧭 CANH TRƯỚC`. Chống spam (đổi trạng thái/level hoặc >4h). Tắt bằng
`ENABLE_RADAR_ALERTS=false`. KHÔNG đụng logic vào lệnh. Chưa deploy Railway.

## Limit CHỈ phe SHORT thuận-trend (29/10 — THẮNG, robust 2 chu kỳ)
Cờ `limitEntrySide` trong `scripts/backtest_1year.mjs`: chỉ áp limit entry cho
đúng 1 chiều (SHORT). Bán tại cản = thuận xu hướng giảm, "chạm là quay đầu"
đáng tin; khác hẳn limit mù cả 2 chiều (thua) hay bắt đáy long (dao rơi).

| Giai đoạn | BASELINE | LIMIT short-only |
|---|---|---|
| 2024 → nay | +61.69R (PF 1.22) | **+66.56R (PF 1.25)** |
| FULL 2021-26 | −11.25R (PF 0.98) | **+28.35R (PF 1.06)**, DD tốt hơn |

→ Cải thiện dương sống sót trên CẢ 2 chu kỳ. **Caveat: cần code post-only limit
THẬT trên OKX (paper chưa có) → finding cho giai đoạn lên tiền thật.**

## Khiên Macro nhìn 2-3 cây BTC (29/10 — BÁC BỎ)
Cờ `btcShieldLookback` (đã test rồi revert khỏi engine): look2 tệ hơn cả 2 chu
kỳ; look3 chỉ nhỉnh 2024+ (+6.5R) nhưng full gần như không đổi, cắt bớt lệnh.
Nhiễu, không đáng đổi. Giữ khiên nhìn 1 cây như cũ.

## Còn lại đáng thử
- **#4 không đánh T7/CN** (lọc cuối tuần) — chưa test, rẻ, có cơ sở cấu trúc
  (cuối tuần thanh khoản mỏng = false break, đúng tử huyệt 2023).
