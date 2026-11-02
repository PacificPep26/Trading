# Nhật ký nghiên cứu từ tài liệu học tập (31/10/2026) — BỘ NHỚ QUYẾT ĐỊNH

Phương pháp: đọc PDF trong `docs/strategies/`, rút quy tắc kiểm chứng được, bật từng quy tắc bằng công tắc
trên bản copy, đo bằng `backtest_1year.mjs` (6 coin, 10/2025–10/2026) và `backtest_multi_year.mjs`
(2021–2026), giữ cái cải thiện nhất quán, bỏ cái không. Đừng test lại các mục đã bác bỏ.

## 0. Phát hiện gốc: bản "tái cấu trúc" từng làm hỏng Kane/SMC
Cùng dữ liệu và phí, 1 năm: bản HEAD cũ 243 lệnh PF 1.30 +43.6R; bản tái cấu trúc 282 lệnh PF 0.62 -63R
(Kane/SMC chỉ còn 2 lệnh). Bisect từng công tắc:
| Thay đổi | Kết quả | Quyết định |
|---|---|---|
| Cổng "cản chắn dưới 1.2R" (MIN_CLEAR_R) | thủ phạm chính: 2 → 180 lệnh khi gỡ | GỠ |
| `isFreshH4 = true` (luôn tươi) | PF 1.09 → 1.32 khi quay lại 8 nến | KHÔI PHỤC `freshH4Bars=8` |
| Nhánh Bear-trend siết (cách EMA34 ≥2.5%, ở cản Tier-2) | PF 1.32 → 1.37 khi quay lại bản cũ | KHÔI PHỤC (`canLong = isSmcSweepLong`) |
| Đệm TP 0.25% trước cản | tắt đi: PF 1.32 → 1.15 | GIỮ (có ích) |
| Lọc nến con (minor bar sweep), volume M15, majorHigh | không ảnh hưởng | không đổi |
| Macro Fade Short/Long, Breakout/Breakdown, Trade Flip | PF 0.24–0.78, lỗ cả năm | TẮT mặc định (cờ `ENABLE_*`) |

## 1. SMC Nâng cao (`06_SMC_NangCao.pdf`)
Nền sau bước 0: 1 năm 121 lệnh PF 1.37 +22.7R DD -8.2R | đa năm 382 lệnh PF 1.06 +12.85R DD -33.3R.
| Quy tắc | 1 năm | Quyết định |
|---|---|---|
| Lọc cuối tuần (T7/CN) | PF 0.99 -0.5R | BÁC BỎ |
| Premium/Discount (N=30/60/120 nến H4) | PF 1.26/1.02/0.72 | BÁC BỎ (mâu thuẫn với vào lệnh đảo chiều sau sweep) |
| Phiên Á 00–07 UTC (chỉ giữ lệnh trong phiên Á) | PF 0.58 -7.9R | Phiên Á là phần lỗ |
| **Bỏ phiên Á: vào lệnh 07–24 UTC** | 1 năm PF 1.66 +30.5R DD -7.7R; đa năm PF 1.06→1.17, +12.85→+28.46R | **ĐÃ DEPLOY** (`sessionStartHourUtc=7`) |
| Chỉ 07–16 UTC | đa năm PF 1.27 +30.6R | ứng viên (chọn sau khi thấy kết quả, dễ khớp quá) |
| Chỉ 12–21 UTC | đa năm PF 1.33 +34.8R DD -21.3R | ứng viên (như trên) |
Chưa dựng: OTE 0.62–0.79, Breaker/IFVG, SMT Divergence, Power of 3.

## 2. Wyckoff + phá hộp (`09/10_Wyckoff`, `22_MoHinhGia`, `12_HiddenBase`) — BÁC BỎ, giữ TẮT
Dựng `src/strategies/wyckoff_box.js` (Spring/UTAD sau nhịp test volume thấp; phá hộp thật rồi retest LPS/LPSY, TP measured move),
nối sau Kane/Zone, cờ `ENABLE_WYCKOFF_SPRING` / `ENABLE_WYCKOFF_BREAKOUT` (mặc định TẮT). Có 15 test và kiểm thử đột biến.
Tiêu chí giữ đặt trước: >=60 lệnh/5 năm, PF >= 1.2, dương >= 3/5 giai đoạn, danh mục gộp không tệ hơn nền.
| Cấu hình | Phạm vi | Lệnh | PF | Tổng R | DD |
|---|---|---|---|---|---|
| Nền (Kane + SMC, 07-24 UTC) | 1 năm | 96 | 1.66 | +30.5R | -7.7R |
| + Spring/UTAD (qua bộ chấm điểm Kane) | 1 năm | 102 | 1.58 | +30.1R | -7.7R (chỉ 6 lệnh Wyckoff) |
| + Spring/UTAD (bỏ chấm điểm) | 1 năm | 177 | 1.15 | +15.4R | -14.5R (Spring Long PF 0.17, UTAD Short PF 1.18) |
| + Phá hộp/retest (bỏ chấm điểm) | 1 năm | 192 | 1.08 | +8.4R | -23.3R (Breakout Long PF 0.00, Breakdown Short PF 1.47) |
| + Wyckoff chỉ Short | 1 năm | 195 | 1.41 | +46.3R | -12.8R |
| Nền | 2021-26 | 285 | 1.17 | +28.5R | -37R (dương 4/5 giai đoạn) |
| + Wyckoff chỉ Short | 2021-26 | 608 | 1.01 | +3.9R | -108R (dương 2/5) |
| + Wyckoff cả hai chiều | 2021-26 | 941 | 1.00 | -0.5R | -120R (dương 2/5) |
**Kết luận:** 1 năm gần nhất (thị trường nghiêng về Short) cho kết quả đẹp ở phía Short, nhưng 5 năm thì biến mất và drawdown tăng ~3x.
Không đạt tiêu chí -> KHÔNG bật. Phía Long (Spring, phá trần) lỗ ở cả hai khung. Bộ chấm điểm Kane giết gần hết tín hiệu hộp
(6 lệnh/năm), và bỏ nó ra thì tín hiệu quá nhiều và kém chất lượng.
HYPE (chỉ để soi): bật cả hai -> 11 lệnh Wyckoff 15/9-31/10, 1 lệnh thắng lớn (Spring 26/10 +3.6R), còn lại lỗ nhỏ;
vẫn không bắt 22/9, 6/10, 29/10. Đừng test lại các biến thể này nếu không có ý tưởng khác biệt về bản chất.

## 3. Cách vào lệnh: chờ xác nhận vs vào ngay vs canh Limit (31/10/2026)
Backtest 2021-26 (6 coin, Kane + SMC, 07-24 UTC), `limitDepth` = đặt limit sâu hơn giá tín hiệu theo tỷ lệ khoảng cách tới SL.
| Cách vào | Lệnh | PF | Tổng R | DD |
|---|---|---|---|---|
| **A hiện tại: chờ 60p rồi vào market** | 285 | **1.17** | **+28.5R** | -37R |
| B vào ngay (không chờ) | 296 | 0.98 | -3.6R | -46R |
| C limit tại đúng giá tín hiệu | 296 | 1.07 | +10.8R | -36R (khớp gần như ngay = chỉ đổi phí) |
| E limit giá tín hiệu, chỉ phe SHORT | 288 | 1.21 | +33.3R | -35R (hơn A ~5R, trong nhiễu) |
| F/G/H limit sâu 25%/50%/75% | 237/138/68 | 0.88/0.55/0.24 | -14.9/-36.8/-34.8R | tệ dần |
| I limit sâu 50% chỉ SHORT | 252 | 1.23 | +31.9R | -38R (ngang E, lợi ích không đến từ độ sâu) |
Kết luận: giữ "chờ 60p xác nhận". Limit sâu hơn BỊ chọn lọc ngược (chỉ khớp khi giá đi sai hướng) nên càng sâu càng lỗ.
Limit chỉ phe Short chỉ hơn nền chút (trong nhiễu) và cần code đặt lệnh Limit thật trên OKX (bot đang paper).
Tháng 9-10/2026: 15 lệnh +9.2R PF 2.67 (T9 10 lệnh +11R, T10 5 lệnh -1.7R, từ 7/10 tới 31/10 không có lệnh vì thị trường ngang).
Lệnh HYPE Long 89.6 sáng 31/10 vào lúc 01:45 UTC (phiên Á) -> bộ lọc phiên 07-24 UTC sẽ chặn.

## 4. "Nhiều lệnh hơn + TP ngắn hơn": đo trên engine đã khôi phục (31/10/2026)
Nền 2021-26 (6 coin): 285 lệnh, thắng 27.4%, PF 1.17, +28.5R, DD -37R.
| Thay đổi | Lệnh | PF | Tổng R |
|---|---|---|---|
| Hạ điểm tối thiểu chỉ cho BTC 75 / 70 / 65 / 60 | 112 / 166 / 222 / 299 | 1.11 / 0.83 / 0.71 / 0.79 | +7.1 / -16.7 / -39.4 / -38.8R |
| TP ngắn: minRR 1.5 / 1.2 / 1.0 | 304 / 301 / 272 | 1.01 / 0.90 / 0.92 | +2.1 / -17.1 / -13.4R |
| Dời SL sớm: co +0.6R / khóa +1.0R / co 0.5 + khóa 1.0 / khóa 0.8 | ~286-289 | 1.08 / 1.16 / 1.00 / 0.96 | +12.2 / +24.2 / -0.4 / -6.1R |
Toàn bộ 1,777 tín hiệu 2021-26 khi KHÔNG lọc điểm: PF 0.87 (học 2021-23 PF 0.98, thử 2024-26 PF 0.80).
Theo điểm (học / thử): <50: 0.86 / 0.67; 50-64: 1.27 / 0.92; 65-74: 0.72 / 0.95; 75-84: 0.91 / 1.06; 85+: 1.48 / 1.11.
-> Dải 50-74 KHÔNG có sức dự đoán nhất quán; chỉ >=75 hơi dương ở cả hai giai đoạn. Yếu tố nhất quán dương ở cả hai giai đoạn:
VSA cùng chiều (PF 1.23 / 1.09, n nhỏ), giờ 07-12 UTC (1.35 / 1.04), coin NEAR (1.36 / 1.58). Yếu tố còn lại đảo dấu giữa hai giai đoạn.
Kết luận: nhiều lệnh hơn bằng cách nới điểm hoặc TP ngắn hơn đều làm kỳ vọng âm đi; hệ thống đang gần tối ưu ở phần quản lý lệnh.
Lưu ý kỹ thuật: `minSetupQualityScore: 0` bị code đổi thành 75 (`0 || 75`), dùng 1 để tắt lọc.

## 5. LỖ HỔNG LOGIC: co SL + khóa lãi cắt cụt lệnh thắng (31/10/2026) — ĐÃ SỬA
Đo MFE/MAE 285 lệnh: 57% lệnh thua không bao giờ chạy quá +0.3R, chỉ 6% từng đạt +0.8R, giữ trung vị 24 nến M15 ->
lệnh thua là thất bại ngay từ đầu, KHÔNG phải lãi bị trả lại; lệnh thắng chịu âm TB chỉ 0.36R. Nên co SL (+0.8R -> -0.3R)
và khóa lãi (+1.4R -> +0.05R) chỉ cắt lãi của lệnh thắng. Tắt từng phần (2021-26, 6 coin):
| Quản lý lệnh | Lệnh | Thắng | PF | Tổng R | DD |
|---|---|---|---|---|---|
| nền (co +0.8R, khóa +1.4R) | 285 | 27.4% | 1.17 | +28.5R | -37R |
| tắt co SL | 283 | 29.7% | 1.14 | +25.9R | -38R |
| tắt khóa lãi | 285 | 29.1% | 1.18 | +31.7R | -39R |
| **tắt cả hai (SL/TP thuần)** | 278 | **36.3%** | **1.26** | **+52.4R** | **-31.7R** |
Theo năm (nền -> SL/TP thuần): 2021 +4.2->+6.6R, 2022 +4.2->+9.7R, 2023 -2.3->-4.1R, 2024 +8.6->+9.2R, 2025 +13.8->+31.0R (4/5 năm tốt hơn).
1 năm gần nhất: PF 1.66 -> 1.86, +30.5R -> +47.7R, thắng 46.7%, DD -6.75R. ĐÃ DEPLOY: `ENABLE_BE_MANAGEMENT` mặc định TẮT
(ngưỡng step1/lock = 99). Lưu ý: CLAUDE.md mục 4 mô tả trailing khóa lãi là quy tắc bất biến -> thay đổi này đi ngược mục đó có chủ đích.
Còn sót: `customBeTriggerR` của engine vẫn khóa lãi ở +1.0R khi D1 volume thấp (isLowVolD1); số liệu trên đã gồm trường hợp này.
Cần xem lại các thử nghiệm bị bác bỏ trước đây (minRR, ngưỡng điểm) dưới cách quản lý mới vì chúng được đo khi còn co/khóa.

## 6. ĐO LẠI các ý tưởng bị bác bỏ dưới cách quản lý mới SL/TP thuần (31/10/2026)
Nền mới 2021-26: 278 lệnh, thắng 36.3%, PF 1.26, +52.4R, DD -31.7R. Tiêu chí đặt trước: hơn nền ở >=4/5 năm và PF không thấp hơn.
| Thay đổi | Lệnh | PF | Tổng R | DD | Tốt hơn nền |
|---|---|---|---|---|---|
| minRR 1.5 / 1.2 | 300 / 295 | 1.07 / 0.98 | +15.8 / -4.5R | -50 / -54R | 0/5 |
| điểm tối thiểu 70 / 65 / 60 | 429 / 562 / 767 | 1.14 / 1.01 / 0.97 | +46.6 / +6.2 / -19.4R | -37 / -49 / -69R | 2/5, 1/5, 2/5 |
| độ tươi H4 12 / 16 nến | 332 / 370 | 1.14 / 1.09 | +35.7 / +24.5R | -36 / -39R | 1/5 |
| **TẮT chop-sleep** | **382** | 1.21 | **+60.8R** | -38.2R | 3/5 (2023 -4.1->+1.7R, 2025 +31->+38.8R; 2021, 2024 kém hơn) |
Kết luận: các bác bỏ trước đó vẫn đúng dưới cách quản lý mới. Chỉ "tắt chop-sleep" cho nhiều lệnh hơn (+37%) và tổng R cao hơn
(+8.4R) nhưng PF thấp hơn (1.21 vs 1.26) và DD xấu hơn (-6.6R), không đạt tiêu chí (3/5 năm). Là lựa chọn đánh đổi, KHÔNG deploy mặc định;
bật bằng `ENABLE_CHOP_SLEEP_MODE=false` nếu ưu tiên số lệnh.

## 7. Quyết định của chủ hệ thống + hệ thống Price Action của Pat (31/10/2026)
- **Tắt chop-sleep** theo yêu cầu của chủ hệ thống (`ENABLE_CHOP_SLEEP_MODE=false` trong `.env`). Đánh đổi đã đo: +37% lệnh, +8.4R, nhưng PF 1.26 -> 1.21 và DD sâu hơn ~6.6R (mục 6).
  Các test chop-sleep trong check.mjs đã được làm độc lập với `.env` của máy.
- **Hệ thống Pat (naked chart)** dựng độc lập (`scratchpad/pat_system.mjs`, không dùng Kane/SMC): BOS 1-2-3 làm xu hướng, vùng đảo vai (đỉnh cũ -> hỗ trợ)
  và vùng cầu tổ chức (>=3 nến thân lớn + FVG + chiết khấu <50% Fib), vào khi rút râu hoặc nhấn chìm, SL dưới vùng, TP tại đỉnh sóng đẩy, RR>=2, phiên 07-21 UTC.
| Khung | Lệnh | PF chưa phí | PF sau phí | Tổng R sau phí |
|---|---|---|---|---|
| 4H | 213 | 0.89 | 0.72 | -53.5R |
| 1H | 911 | 0.91 | 0.57 | -409.9R |
| 15m | 2,615 | 1.07 | 0.40 | -2,138R |
Vùng cầu tổ chức gần như không bao giờ thỏa (2-25 lệnh), 99% lệnh là retest vùng đảo vai. Rút râu và nhấn chìm đều lỗ; hạ RR 1.5 (PF 0.78) và nâng RR 3 (PF 0.61) không cứu.
Kết luận: BOS + retest đảo vai + nến xác nhận KHÔNG chọn lọc đủ, không có lợi thế ngay cả trước phí ở 4H/1H. Bước 4 "Checklist" của video không có trong bản mô tả nên chưa mô phỏng.

## 8. Kiểm tra giá/dữ liệu + chỉ báo Pine của Pat (31/10/2026)
- **Cache của 5 coin (BTC/ETH/SOL/LINK/NEAR) từng dừng ở 24/10 10:00 UTC** (chỉ HYPE mới hơn) -> mọi backtest/phễu "tháng 10" trước mục này thiếu tuần 24-31/10
  (gồm cú rơi BTC về 76,260). Đã nối nến mới tới 31/10 (`data/cache_1year` bị .gitignore; script tạm `scratchpad/refresh_cache.mjs`); `PERIODS` đa năm kéo tới 2026-10-31.
  Giá sau cập nhật khớp biểu đồ (BTC 4H 77,561.8 so với 77,537.9). Cần làm mới cache định kỳ trước khi tin số liệu "gần đây".
- **Chỉ báo Pine (swing 5, vùng flip dày 0.2 ATR, mọi swing bị phá thành vùng, FVG>=0.3 ATR)** port sang JS (`scratchpad/pine_port.mjs`), vào lệnh khi rút râu/nhấn chìm
  tại vùng, SL dưới vùng, TP đỉnh swing gần nhất, RR>=2: vẫn LỖ ở mọi khung (4H PF 0.64-0.71, 1H 0.65, 15m 0.50); lọc xu hướng và thêm FVG không giúp.
  Định nghĩa vùng khác (swing 2 vs 5) không đổi kết luận.
- **Nền mới (chop-sleep TẮT, SL/TP thuần, dữ liệu tới 31/10):** 1 năm 127 lệnh thắng 41.7% PF 1.52 +43.8R DD -9.0R; đa năm 385 lệnh thắng 35.3% PF 1.20 +57.4R DD -38.2R.
- Cú rơi BTC 24-31/10: bot chỉ có 3 lệnh, đều LONG sweep ngược xu hướng (BTC 24/10, ETH và LINK 28/10), cả ba dính SL (~-3.4R); không có Short nào.

## 9. "Chỉ thuận xu hướng" kiểu Pat áp lên bot hiện tại (31/10/2026) — BÁC BỎ
Nền (chop-sleep tắt, SL/TP thuần, 6 coin, dữ liệu tới 31/10): 2021-26 385 lệnh PF 1.20 +57.4R DD -38.2R; 1 năm 127 lệnh PF 1.52 +43.8R DD -9.0R.
| Bộ lọc (Long chỉ khi xu hướng tăng, Short chỉ khi giảm) | Lệnh | PF | Tổng R | DD |
|---|---|---|---|---|
| EMA34/89 H4 | 322 | 1.14 | +33.2R | -46.5R |
| Cấu trúc BOS H4 (kiểu Pat) | 180 | 1.18 | +25.2R | -17.0R |
| Cấu trúc BOS D1 | 288 | 1.14 | +31.4R | -33.0R |
| EMA và BOS H4 cùng đồng ý | 352 | 1.11 | +29.1R | -46.4R |
Riêng 1 năm: lọc BOS H4 còn 65 lệnh, PF 1.47, +21.2R (nền +43.8R), DD không đổi (-9.2R).
Lọc BOS H4 dương cả 5 năm nhưng tổng R giảm một nửa (DD giảm một nửa nên R/DD ngang nền ~1.5); lệnh ngược xu hướng (SMC sweep đảo chiều) kiếm +31.8R riêng năm 2025
và lỗ ở 2023-24 -> không phải nguồn lỗ cố định. 3 lệnh Long thua 24-28/10 vẫn lọt bộ lọc (BTC đang hồi, BOS H4 tạm "tăng").
Nới điểm tối thiểu cho lệnh thuận xu hướng (cả H4 và D1 BOS đồng ý): 65 / 55 / 45 -> 518 / 681 / 821 lệnh, PF 1.08 / 0.95 / 0.95, +30.2 / -24.8 / -31.5R (nền 385 lệnh, PF 1.20).
Kết luận: không có bằng chứng chặn ngược xu hướng hay ưu tiên thuận xu hướng làm tốt hơn. Giữ nguyên.

## 10. Bật lọc cấu trúc BOS H4 + công cụ tua lại (31/10/2026)
- **Đã bật** theo yêu cầu: `ENABLE_TREND_ALIGN_FILTER=true` trong `.env` (`computeStructTrend` trong regime.js; chặn Long khi BOS H4 giảm, Short khi tăng; log "TREND_ALIGN").
  Số liệu với cấu hình hiện tại (chop-sleep tắt, SL/TP thuần, lọc BOS H4 bật): 2021-26 180 lệnh PF 1.18 +25.2R DD -17.0R; 1 năm 65 lệnh PF 1.47 +21.2R DD -9.2R.
  Đánh đổi đã đo: lãi giảm ~một nửa so với không lọc (R/DD ngang nhau).
- **Công cụ tua lại** `scripts/export_replay.mjs` -> `docs/replay/replay.html` (mở trực tiếp) + artifact: nến M15 OKX thật, mọi tín hiệu của bot (vào lệnh / hủy khi chờ / điểm thấp / bị chặn),
  vùng lãi-lỗ, nhật ký quyết định. `backtestSymbol` nhận `cfg.signalLog` (mảng) để ghi tín hiệu. Dùng cùng backtestSymbol với backtest chính nên khớp 100%.
  Giới hạn: dữ liệu chỉ OHLC mỗi 15 phút; hiệu ứng nến "chạy trong thân" là mô phỏng.

## Việc kế tiếp (chưa làm)
Hidden Base (vùng fresh/tested làm bộ lọc cho SMC Sweep), Imbalance, VSA/Volume Profile,
Quản lý vốn & tâm lý. Mỗi mục: đọc → rút quy tắc → công tắc → đo 1 năm + đa năm → giữ/bỏ.

## 11. Bối cảnh lớn từ toàn bộ lịch sử (01/11/2026)
Nguồn: nến ngày OKX từ lúc niêm yết hợp đồng (BTC/ETH 11/2019, LINK 02/2020, NEAR 12/2020, SOL 01/2021, HYPE 02/2025); BTC nối Bitstamp từ 08/2011, ETH từ 08/2017. Module `src/strategies/macro_context.js` (ATH/ATL, xu hướng tháng/tuần/ngày theo cấu trúc BOS, vị trí so với MA200 ngày, thống kê theo năm, mốc tuần/tháng/năm). Điểm bối cảnh = xu hướng M + W + D (mỗi cái +1/0/-1) + (giá trên MA200 ? +1 : -1).

Câu hỏi: biết bức tranh lớn có làm bot tốt hơn không? Đo hậu kiểm trên 188 lệnh backtest 2021-26 (phí 2 chiều, cấu hình hiện tại), bối cảnh tính tại đúng thời điểm vào lệnh chỉ bằng nến ngày đã đóng (không nhìn trước).
Tiêu chí đặt trước: chỉ làm bộ lọc "chặn lệnh ngược bối cảnh" nếu PF tăng >= 0.15, mất <= 40% số lệnh, nhóm thuận dương >= 3/5 năm.

Kết quả (điểm tính theo hướng lệnh):
- Thuận bối cảnh (>=1): n=82, PF 1.14, +8.7R. Trung tính (0): n=53, PF 0.72, -13.3R. Ngược (<=-1): n=53, PF 2.09, +35.9R.
- Theo BTC: thuận PF 0.93 (-5.0R), ngược PF 2.42 (+38.7R). Xu hướng tuần/tháng thuận PF 0.96/0.98, ngược PF 1.54/1.41.
- Chia đôi thời gian: 2021-23 ngược PF 2.75 vs thuận 1.01; 2024-26 ngược PF 1.68 vs thuận 1.24. Trung tính cả hai nửa đều lỗ (PF 0.64 và 0.78).
- Theo từng coin lẫn lộn: BTC/ETH/LINK ngược tốt hơn; SOL/NEAR ngược kém hơn (mẫu 4-9 lệnh).

Kết luận:
- BÁC BỎ bộ lọc thuận xu hướng theo bối cảnh lớn: nó sẽ chặn đúng nhóm lệnh có lãi nhất (khớp với việc lọc BOS H4 trước đó làm giảm cả lãi lẫn drawdown). Lợi thế của bot là đảo chiều tại vùng quét thanh khoản, không phải đi theo xu hướng.
- ỨNG VIÊN chưa bật (cần kiểm chứng ngoài mẫu + paper): bỏ lệnh khi điểm bối cảnh = 0 (chuyển pha/đi ngang). Nhất quán ở cả hai nửa thời gian nhưng đã xem ~15 lát cắt trên cùng 188 lệnh nên rất dễ là ngẫu nhiên; mẫu nhỏ.
- Bối cảnh lớn hiện chỉ dùng để HIỂN THỊ và đính kèm tin Telegram, không đổi quyết định vào lệnh, nên số liệu backtest không thay đổi.
- Giới hạn dữ liệu: M15 của OKX chỉ từ 2019-11 nên chiến lược M15 không thể backtest trước 2021; lịch sử dài chỉ giúp đọc bối cảnh (tháng/tuần/ngày), không mở rộng được backtest chiến lược.

## 12. Backtest "từ lúc sinh ra" (BTC 2014-2020, ETH 2018-2020) - 01/11/2026
Dữ liệu: nến M15 Bitstamp (spot USD) nối với cache OKX từ 12/2019; H1/H4/D1 của giai đoạn đầu gộp từ M15. BTC từ 01/2014 (2012-2013 bỏ vì 92% nến không có giao dịch), ETH từ 09/2017. Cùng mã backtest, cùng phí 2 chiều, cùng cấu hình hiện tại (không tinh chỉnh lại).
- BTC 2014-2020: 73 lệnh, PF 1.53, +27.3R. Theo năm: 2014 -8.9R (PF 0.35), 2015 -7.3R (PF 0.48), 2016 +17.4R, 2017 +4.9R, 2018 +6.7R, 2019 +10.0R, 2020 +4.4R (mỗi năm chỉ 3-20 lệnh).
- ETH 2018-2020: 25 lệnh, PF 0.89, -2.2R (2018: 0/6 lệnh thắng). Không có lợi thế rõ.
- Thành phần đảo vai: 2014-2020 BTC Kane thuận xu hướng PF 2.34 (+29.4R) còn SMC Sweep PF 0.93 (-2.2R); 2021-26 thì ngược lại (SMC Sweep PF 1.45, Kane PF 0.95). LỢI THẾ TỪNG THÀNH PHẦN KHÔNG BỀN QUA CÁC GIAI ĐOẠN; chỉ có danh mục gộp là dương ở cả hai.
Kết luận: BTC dương trên giai đoạn chưa từng dùng để chọn tham số (ngoài mẫu) nhưng 2014-15 lỗ (thị trường mỏng, phí/spread thực tế lúc đó cao hơn giả định), ETH không xác nhận. Không đổi cấu hình dựa trên kết quả này. Giới hạn: spot chứ không phải hợp đồng, không có funding, mẫu mỗi năm rất nhỏ.

## 13. Mô hình 2 đỉnh / 2 đáy (02/11/2026)
Phát hiện: 2 đỉnh (đáy) lệch <= 0.6 ATR, cách nhau 8-120 nến, chiều cao >= 1.5 ATR; cổ = đáy (đỉnh) giữa hai điểm. Vào tại đóng cửa thủng/vượt cổ (chờ tối đa 30 nến, lúc phát hiện chưa thủng nên không nhìn trước), SL ngoài đỉnh/đáy thứ hai 0.3 ATR, TP1 = chiều cao mô hình (1x), tối đa 120 nến. Phí 0.19% khứ hồi. Dữ liệu: BTC từ 2014, ETH 2017, SOL/LINK/NEAR từ lúc niêm yết.
- 4H gộp 5 coin: 744 lệnh, thắng 68%, PF 1.17, +39.5R (BTC 228 lệnh PF 1.51 +29.8R; ETH 166 PF 1.24 +11.8R; SOL 108 PF 0.91; LINK 138 PF 1.02; NEAR 104 PF 1.02).
- 1H gộp: 3444 lệnh, thắng 64%, PF 0.88, -151.6R (LỖ).
Kết luận: tỉ lệ thắng cao nhưng R:R gần 1:1 nên lợi thế rất mỏng ở 4H và âm ở 1H; không có tách trong/ngoài mẫu, BTC chiếm phần lớn lãi, mẫu giai đoạn Bitstamp 2014-19 dùng giá spot. KHÔNG đưa vào quyết định của bot; chỉ hiển thị trong viewer như thông tin tham khảo kèm số đo này. Muốn dùng làm tín hiệu cần: đặt tiêu chí trước, chạy qua backtest_multi_year có phí, chia trong/ngoài mẫu, theo dõi paper.

## 14. Quy tắc "kịch bản" của viewer đo trên lịch sử (02/11/2026)
Quy tắc: mỗi nến đóng, tính vùng cản/hỗ trợ (cụm pivot, gộp vùng) và kế hoạch chỉ từ dữ liệu tới nến đó; kích hoạt khi nến chạm vùng rồi đóng cửa quay lại phía ngoài; vào tại giá đóng; SL/TP1 theo kế hoạch (R:R >= 1); SL ưu tiên; tối đa 120 nến; phí 0.19% khứ hồi. 6 coin, dữ liệu từ lúc có (BTC 2014).
Tiêu chí đặt trước: >= 200 lệnh, PF sau phí >= 1.2, dương >= 4/6 coin.
- 15m: 16189 lệnh, thắng 41%, PF 0.67, -3885R (từ 2021: PF 0.66). 1H: 5729 lệnh, PF 0.85, -555R. 4H: 1784 lệnh, PF 0.82, -198R.
- Chỉ lấy lần có khối lượng xác nhận (climax + râu): 15m 622 lệnh PF 0.61; 1H 200 lệnh PF 0.65; 4H 63 lệnh PF 0.46: còn tệ hơn, không cứu được.
- Không coin nào dương ở 15m; 4H chỉ NEAR/HYPE dương nhẹ (mẫu 60-156 lệnh).
Kết luận: BÁC BỎ. Vào lệnh ở mọi lần giá chạm vùng cấu trúc rồi rút râu là chiến lược lỗ, nên việc engine của bot (chỉ vào ở vùng thanh khoản tier 1/2 + điểm chất lượng >= 75) bỏ qua phần lớn các cú chạm là ĐÚNG, không phải lỗi. Ví dụ 30/10/2026 BTC chọt lên vùng 78.544-78.886 (3 lần chạm, râu 64% ở nến 4H 04:00 UTC): engine không phát hiện tín hiệu (kể cả khi bỏ bộ lọc phiên) vì vùng đó không phải vùng thanh khoản của engine. Viewer đánh dấu rõ "vùng engine" và "vùng cấu trúc (bot không vào)".
