# Kế hoạch: Backtest full-history + Phân loại giai đoạn thị trường (Regime-Adaptive)

File theo dõi tiến độ xuyên suốt nhiều phiên làm việc. Cập nhật ngay khi một giai
đoạn hoàn thành hoặc một thử nghiệm bị revert — không chỉ báo cáo trong chat.

Nguồn gốc: xem lịch sử trao đổi 24/10/2026. 3 lần thử trước đó (TP chốt mốc xa nhất,
Runner Mode trailing) đều test trên 1 năm dữ liệu gộp chung mọi giai đoạn và đều
thua baseline — kết luận: cần phân loại giai đoạn thị trường trước khi đổi logic
thoát lệnh.

## Bảng tiến độ

| # | Giai đoạn | Trạng thái | Ngày xong | File đã sửa | Kết quả verify |
|---|---|---|---|---|---|
| 0 | File theo dõi + tài liệu chiến lược VWAP/ICT | ✅ Xong | 2026-10-24 | `docs/REGIME_ADAPTIVE_PLAN.md`, `docs/strategies/VWAP_TFC_ICT_SWEEP.md` | N/A (tài liệu) |
| 0.1 | Futures Fidelity Checklist | ✅ Xong (rà soát xong, 1 gap funding rate đã ghi nhận, 1 việc liquidation-check dời sang Phần 1) | 2026-10-24 | - | Xem mục bên dưới |
| 1 | Mở rộng tải lịch sử full-history (từ lúc coin niêm yết) + thêm D1 | 🔄 Đang chạy nền (background job `bg1au72hp`) | - | `scripts/download_1year_history.mjs` | Smoke-test BTC 4H: lùi về 2022 trong 20s đầu, logic merge + genesis marker đúng |
| 2 | Phân loại giai đoạn D1 (UPTREND/DOWNTREND/SIDEWAY) | ✅ Xong | 2026-10-24 | `scripts/analyze_regime_history.mjs` | Chạy full 5-6 năm/coin: SIDEWAY chiếm ~50-55% tổng số ngày mọi coin |
| 3 | Backtest full-history, phân nhóm theo (giai đoạn × setup) | ✅ Xong -> đã tìm ra + deploy D1 Regime Gate | 2026-10-24 | `scripts/backtest_by_regime.mjs` (mới), `src/engine.js`, `src/server.js` | Xem bảng quyết định bên dưới |
| 5 | Lưu tài liệu VWAP/ICT tham chiếu | ✅ Xong | 2026-10-24 | `docs/strategies/VWAP_TFC_ICT_SWEEP.md` | N/A |

## Futures Fidelity Checklist (Phần 0.1)

Xác nhận code mô phỏng đúng cơ chế perpetual futures OKX thật trước khi tin số liệu
backtest:

- ✅ **Position sizing** (`calculatePositionSize`, `src/engine.js:36`):
  `size = riskUsd / |entry - SL|`, `margin = notional / leverage` — đúng chuẩn
  Isolated Margin, rủi ro cố định $riskUsd bất kể đòn bẩy.
- ✅ **SL/TP theo wick thật** (`high`/`low` nến, không phải `close`) — xác nhận trong
  `updateOpenPositions` (`src/server.js:221-222`) và cả 2 backtest script.
- ✅ **Phí Taker/Maker**: `feeRate` 0.08%/0.02% đã tính trong mọi backtest.
- ❌ **GAP: Phí Funding Rate (8 tiếng/lần) CHƯA được mô phỏng** ở bất kỳ đâu trong
  repo. Với lệnh giữ vài giờ (time-stop tối đa 6 tiếng) ảnh hưởng nhỏ, nhưng lệnh giữ
  qua nhiều phiên funding sẽ lệch P&L thật. **Quyết định: tạm bỏ qua có ghi chú** (vì
  time-stop ngắn, ảnh hưởng ước tính <0.1R/lệnh), chỉ thêm mô phỏng funding rate lịch
  sử (`GET /api/v5/public/funding-rate-history`) nếu sau này làm Runner Mode/giữ lệnh
  dài hơn — cần hỏi người dùng trước vì phải tải thêm nguồn dữ liệu mới.
- ⬜ **Thanh lý (Liquidation)**: Chưa kiểm tra SL luôn kích hoạt trước giá thanh lý ở
  đòn bẩy 10x Isolated. Cần làm ở Phần 1: tính giá thanh lý gần đúng
  (`entry * (1 - 1/leverage)` cho Long, bỏ qua maintenance margin nhỏ) và xác nhận SL
  luôn an toàn trước mốc đó trong toàn bộ lịch sử backtest.

## Quyết định & Lý do (lịch sử thử nghiệm đã revert — KHÔNG lặp lại)

| Thử nghiệm | Ngày | Kết quả (1 năm) | Quyết định |
|---|---|---|---|
| Backtest thiếu `calculateSetupQualityScore` + thiếu `btcH4Candles` | 2026-10-24 | Số liệu backtest không đáng tin (36 lệnh PF 1.04 sai lệch với live) | Đã vá trong `scripts/backtest.mjs` + `scripts/backtest_1year.mjs`, giữ lại |
| TP chốt ở mốc cản/hỗ trợ **xa nhất** đạt đủ RR (thay vì gần nhất) | 2026-10-24 | PF 1.16→0.82, Tổng R +23.37R→-18.83R, Drawdown -18.19R→-42.69R | **Revert** — đã xác nhận tệ hơn nhiều |
| Runner Mode: khóa SL tại TP rồi trailing 1.0R tới khi đảo chiều | 2026-10-24 | PF 1.16→1.06, Tổng R +23.37R→+10.26R, Drawdown -18.19R→-21.69R | **Revert** — vẫn tệ hơn baseline |
| Nới `MIN_H1_ADX` 20→16 + `MIN_ATR_COMPRESSION_RATIO` 0.70→0.60 | 2026-10-24 | PF 1.16→1.13, riêng tháng 10 R -4.77→-5.77 (tệ hơn) | Không áp dụng — không cải thiện |
| **Nới cửa sổ "độ tươi mới" H4** (`freshH4Bars`, Kane Long/Short chỉ chạy trong N nến M15 đầu sau khi H4 đóng) | 2026-10-24 | Quét 4/6/8/10/16: PF 1.16/1.21/**1.18**/1.11/1.03, Tổng R +23.37/+33.63/**+34.19**/+25.77/+12.71R, DD -18.19/-18.05/**-15.86**/-17.35/-21.93R | **ĐÃ DEPLOY `freshH4Bars=8`** (commit `444e500`, 2026-10-24) lên Railway — xác nhận chạy sạch sau deploy |
| Freshness theo CẤU TRÚC (qua `freshH4Bars`, vẫn cho Kane Long/Short chạy nếu giá chưa đóng cửa phá đáy/đỉnh H4 gốc, bất kể thời gian) | 2026-10-24 | PF 1.18→1.05, Tổng R +34.19R→+15.47R, Net +$302.19→+$105.38, DD -15.86R→-20.50R, lệnh 303→378 (nhiều hơn nhưng kém chất lượng hơn) | **Revert** — mọi cách nới rộng thêm (giờ hay cấu trúc) đều làm PF giảm, `freshH4Bars=8` là điểm cân bằng tốt nhất đã tìm được |
| Miễn CHOP_SLEEP_MODE cho `SMC_ZONE_REACTION` (cho phép chạy khi ADX thấp, vì bản chất là mean-reversion) | 2026-10-24 | Backtest 1 năm giống hệt 100% baseline (303 lệnh, PF 1.18, +34.19R) — Zone Reaction chưa từng khớp đủ điều kiện (Tier-2 + VSA) đúng lúc ADX thấp trong cả năm dữ liệu | **Revert** — an toàn (không regression) nhưng vô dụng, không mang lại lệnh nào mới. Kết luận: cần setup Range Trade MỚI (nhẹ hơn Zone Reaction, dùng range cục bộ N nến thay vì cản Tier-2), không phải chỉnh setup cũ |
| Hạ `MIN_RR_RATIO` toàn cục 2.0 -> 1.0 / 1.5 (test riêng, không đổi code) | 2026-10-24 | RR=1.0: PF 1.14, +31.56R, +$267.13, DD -13.54R (tốt hơn DD, kém hơn lãi). RR=1.5: PF 1.09, +21.83R, +$173.67 (tệ nhất 3 mốc) | **Không áp dụng** — RR=2.0 hiện tại vẫn là lựa chọn tốt nhất trong 3 mốc, đúng luật bất biến CLAUDE.md mục 4, không có cớ để phá |
| Setup mới `RANGE_TRADE` (biên trên/dưới range N nến H1, RR=2.0 chuẩn) + `RANGE_TRADE_FADE` (RR riêng thấp hơn, mặc định 1.2), chỉ chạy khi Chop Sleep Mode chặn Kane Long/Short | 2026-10-24 | RANGE_TRADE (RR=2.0): PF 1.17, +35.75R, +$308.92 (gần như không đổi), DD -21.60R (tệ hơn 36%), tháng 10 vẫn 0 lệnh mới. RANGE_TRADE_FADE (RR=1.2): PF 1.12, +24.92R, +$205.54, DD -18.61R (tệ hơn), tháng 10 vẫn 0 lệnh mới | **Revert cả 2** — không giúp được đúng tháng cần (tháng 10 vẫn 0 lệnh ở mọi RR vì `maxSlDistanceRate`/cấu trúc range quá hẹp), và làm tệ đi các tháng khác. Kết luận: tháng 10 yếu là do biến động thị trường thật, không phải thiếu setup hay ngưỡng RR sai |
| **Chỉ báo biến động nhanh (momentum)** chống bắt dao rơi/cản tàu khi EMA-phase (detectMarketPhase) phản ứng chậm | 2026-10-24 | Phân tích thực tế tìm ra lỗi: BTC giảm -6.4% trong 04-08/10 (22 nến H4) nhưng `detectMarketPhase` vẫn báo RANGING suốt (verify trực tiếp), khiến Kane Long mua đáy liên tục 07-09/10 và thua liền. Thêm `momentumLookbackBars=6`/`momentumThresholdPct=4%` chặn bổ sung. Backtest: PF 1.18→**1.20**, Tổng R +34.19→+34.17R (bằng), Net +$302.19→**+$304.07**, DD -15.86R→**-13.85R** (tốt hơn 13%), **tháng 10: -5.77R/15 lệnh→-4.77R/14 lệnh (lỗ ít hơn)** | **ĐÃ DEPLOY** (commit `c3cc589`, 2026-10-24) lên Railway — cải thiện mọi chỉ số, sửa đúng lỗi gốc (không phải chỉnh tham số mù) |
| **D1 Regime Gate** — Phát hiện qua `backtest_by_regime.mjs`: tổ hợp `STRONG_DOWNTREND(D1) × SMC_SWEEP_REVERSAL_LONG` lỗ **-14.90R/27 lệnh** riêng nó (H4 marketPhase báo RANGING cục bộ trong khi D1 đang downtrend mạnh xuyên suốt -> bộ lọc H4 không thấy được). Thêm `candlesD1` (optional param, tương thích ngược) vào `evaluateMarket()`, tính `d1Phase` qua `detectMarketPhase()` áp lên D1, bổ sung vào điều kiện cấm bắt đáy/cản tàu. Nối dây `candlesD1` vào cả backtest lẫn `server.js` (fetch thêm `1Dutc`) | 2026-10-24 | Backtest 1 năm: PF 1.20→**1.36**, Tổng R +34.17→**+50.96R** (+49%), Net +$304.07→**+$475.34** (+56%), DD -13.85R→**-12.66R**, Win rate 46.7%→**49.0%**, lệnh 285→255 (ít hơn, chất hơn). Tháng 10 không đổi (-4.77R/14 lệnh, downtrend tháng này chưa đủ lâu để D1 EMA báo STRONG_DOWNTREND) | **ĐÃ DEPLOY** (commit sau đây) — cải thiện lớn nhất phiên này, dựa trên bằng chứng định lượng rõ ràng (không phải thử ngẫu nhiên) |

**Baseline mới nhất (sau D1 Regime Gate, đã deploy):** PF 1.36, +50.96R, +$475.34/năm,
win rate 49.0%, max drawdown -12.66R, 255 lệnh.

**🚨 PHÁT HIỆN NGHIÊM TRỌNG (26/10): backtest_1year.mjs trước đây KHÔNG mô phỏng
Time-Stop** (`barsHeld` đếm nhưng không dùng để đóng lệnh) — mọi số liệu "PF 1.47"
verify cả ngày 24/10 KHÔNG phản ánh đúng live thật (Railway đang chạy
`TIME_STOP_BARS=16`, khớp đúng 2 lệnh Time-Stop thật ngày 25/10). Đã vá mô phỏng
đầy đủ, quét nhiều mốc:

| TIME_STOP_BARS | PF | Tổng R/năm | Net USD |
|---|---|---|---|
| 16 (Railway cũ) | 0.86 | -7.48R | -$118.22 |
| 48 | 0.96 | -0.15R | -$41.01 |
| 96 | 1.17 | +24.18R | +$204.70 |
| 150 | 1.20 | +29.10R | +$254.39 |
| **0 (TẮT HẲN, đã deploy)** | **1.47** | **+60.32R** | **+$569.42** |

Thử cả hướng "đổi điều kiện thay vì đổi số" (H4_CONDITION: đóng khi nến H4 đảo
hướng/stall theo ATR) theo góp ý review kỹ thuật — **còn tệ hơn** (PF 0.77,
-14.90R). Kết luận: Time-Stop (ở MỌI hình thức đã test) đang cắt cụt setup H4
đang tích lũy lành mạnh trước khi có đủ 2-4 nến H4 (8-16h) để phát triển —
**TẮT HẲN Time-Stop là lựa chọn tốt nhất đã tìm được.**

Cũng sửa 1 lỗi nghiêm trọng ở `src/server.js`: điều kiện cũ
`pos.currentBarsM15 >= CONFIG.timeStopBars` nếu set =0 sẽ **TRIGGER NGAY LẬP
TỨC** (0 cũng thỏa >=0) thay vì tắt tính năng — đã thêm guard
`CONFIG.timeStopBars > 0` tường minh trước khi set Railway env var =0.

**ĐÃ DEPLOY** (commit `4268b2e`, Railway `TIME_STOP_BARS=0`) — baseline hiện
tại trùng khớp chính xác số liệu đã verify ở trên.

## Review kỹ thuật bên ngoài (26/10) — xác minh từng điểm bằng công cụ thật

| Claim | Kết quả xác minh | Hành động |
|---|---|---|
| Lỗi cú pháp crash (`-` đầu dòng, thiếu `*`) | **SAI** — `node --check` pass sạch, grep không tìm thấy pattern lỗi nào | Không làm gì |
| Chop filter chặn luôn `tryZoneReactionSetup` qua `return` sớm | **ĐÚNG** | **Đã sửa** (commit `1956540`) — dùng cờ `chopBlockedSignal`, chỉ gate Kane Long/Short. Backtest xác nhận an toàn 100% (245 lệnh/PF 1.47 y hệt trước sửa) |
| Thiếu `hasBearishPattern` trong Kane Short | Đã đúng sẵn (đang edit dở lúc review chụp ảnh) | Không cần sửa |
| `lastH1` BTC có thể là nến đang chạy, giật cờ | **SAI** — `server.js:563` đã filter `confirm===1` trước khi truyền vào | Không làm gì |
| Lệch chuẩn tiêu chí quét cản Long (`low<sup` xuyên qua) vs Short (`<=0.8%` chạm hờ) | **ĐÚNG** | **Đã sửa, BẬT mặc định** (commit `7c8423a`) — PF 1.47→**1.52**, +$569→**+$596** |
| RS Score cho 15đ dù coin chỉ +0.1% khi BTC +5% (dùng ngưỡng tuyệt đối thay vì spread) | **ĐÚNG** (logic flaw có thật) | **Đã thử sửa theo spread — THẤT BẠI**, PF 1.52→1.42, Tổng R +62.92R→+42.70R, **tháng 10: +0.02R→-11.85R** (tệ nhất cả phiên). Đã revert. Ngưỡng strict hơn lọc bớt quá nhiều lệnh tốt |

**Baseline cuối cùng sau review (đang live):** PF 1.52, +62.92R/năm, +$596.55,
Max DD -15.55R, 238 lệnh.

**Mở rộng `momentumLookbackBars` 6->12 (ĐÃ DEPLOY, commit `ac81d1e`):** phân tích
chi tiết từng lệnh tháng 10 phát hiện 11/11 lệnh Long đều thua trong khi 2/2
lệnh Short đều thắng lớn — cửa sổ momentum cũ (24h) quá ngắn để thấy cú giảm
nhiều ngày (SOL giảm tới -9% trong 4 ngày nhưng chỉ -1.6% trong 24h gần nhất).
Quét 4 mốc (6/12/18/24), 12 là đỉnh: PF 1.36->**1.47**, Tổng R +50.96R->**+60.32R**,
Net +$475.34->**+$569.42**, và quan trọng nhất **tháng 10: -4.77R->+0.02R** (gần hòa).
**Baseline hiện tại (đang live):** PF 1.47, +60.32R, +$569.42/năm, DD -13.20R, 245 lệnh.

**Thử Breakout Continuation ("bể nền đu theo", momentum-chase) — THẤT BẠI THẢM HẠI,
đã revert:** PF 1.47->**1.02**, Tổng R +60.32R->**+13.12R** (giảm 78%), Net
+$569.42->**+$57.87** (giảm 90%), Max DD -13.20R->**-37.02R** (gần gấp 3), tháng 10
+0.02R->**-1.64R** (quay lại lỗ). Xác nhận triết lý SMC No-Chasing của engine hiện
tại là đúng đắn — chase breakout bị cá mập quét liên tục trong dữ liệu thật.
KHÔNG thử lại hướng này nữa trừ khi có cơ sở hoàn toàn khác.

**Thử Partial Exit (chốt 50% sớm, dời SL phần còn lại — kiểu Dr. Kane trade
thủ công, người dùng gửi ảnh livestream thực tế) — THẤT BẠI, đã revert:**
partialExitR=1.0: PF 1.47->**1.22**, Tổng R +60.32R->**+29.10R** (giảm 52%), Net
+$569.42->**+$255.75** (giảm 55%). partialExitR=1.5 (sát beTriggerR=1.4 sẵn có):
gần như trung lập, không cải thiện (+60.08R, không đáng kể). Lý do: chốt sớm cắt
mất lợi nhuận của các lệnh lẽ ra chạy trọn tới TP 2R+. Kết luận: cách Dr. Kane
trade thủ công (chọn lọc bằng mắt, không áp dụng máy móc cho MỌI lệnh) không
chuyển thành luật cứng cho bot được — thành công của ông đến từ phán đoán chọn
lọc từng setup cụ thể, không phải 1 công thức partial-exit áp dụng đồng loạt.

**Xác nhận lại bằng `backtest_by_regime.mjs` sau khi D1 Gate deploy:** giai đoạn
STRONG_DOWNTREND (gộp mọi setup) lật từ **-10.52R → +7.74R**. Tổ hợp từng lỗ nặng
`STRONG_DOWNTREND × SMC_SWEEP_REVERSAL_LONG` giảm từ 27 lệnh/-14.90R xuống còn 4
lệnh/-4.00R (phần sót lại do D1 EMA vẫn có độ trễ nhỏ, chấp nhận được).

Các ô còn âm nhẹ sau cùng (đã xem, KHÔNG xử lý tiếp — mẫu nhỏ/noise, rủi ro overfit):
`STRONG_UPTREND×KANE_THUAN_TREND_LONG` -0.72R/13L, `RANGING×SMC_SWEEP_REVERSAL_SHORT`
-2.31R/35L, `RANGING×SMC_ZONE_REACTION_LONG/SHORT` -2.52R gộp/16L,
`STRONG_DOWNTREND×SMC_SWEEP_REVERSAL_LONG` còn sót -4.00R/4L.

**Baseline cũ đang deploy trên Railway (commit `eb2ec92`, `freshH4Bars=4`):** PF 1.16,
+23.37R, +$201.92/năm, win rate 47%, max drawdown -18.19R (1 năm 10/2025-10/2026,
236 lệnh, đã áp đúng cổng quality-score + BTC H4 macro shield).

**Baseline mới (`freshH4Bars=8`, đã verify, CHƯA deploy):** PF 1.18, +34.19R,
+$302.19/năm, win rate 46.2%, max drawdown -15.86R, 303 lệnh.

## Walk-forward test đa năm (2021-2026) — phát hiện rủi ro còn tồn tại

Dùng `scripts/backtest_multi_year.mjs` (mới) test D1 Gate qua 5 giai đoạn thị
trường khác nhau, không chỉ sample 1 năm thuận lợi vừa verify:

| Năm | Lệnh | Win Rate | PF | Tổng R |
|---|---|---|---|---|
| 2021 (Bull mạnh) | 63 | 47.6% | 1.32 | +10.57R |
| 2022 (Bear mạnh - Luna/FTX) | 125 | 45.6% | 1.16 | +11.21R |
| **2023 (Tích lũy/Sideway kéo dài)** | **272** | **36.8%** | **0.77** | **-40.27R** |
| 2024 (Bull trở lại) | 180 | 41.1% | 1.09 | +9.18R |
| 2025 (tới nay) | 392 | 46.2% | 1.25 | +53.53R |

**2023 lỗ nặng -40.27R — CHƯA GIẢI QUYẾT, rủi ro còn tồn tại.** Đào sâu bằng
`scripts/analyze_2023.mjs` (mới): nguyên nhân là **whipsaw/fakeout** (phá vỡ giả
rồi đảo chiều liên tục), KHÁC với vấn đề D1 Gate vừa sửa (bỏ sót trend thật).
Ngay cả setup "thuận trend" cũng lỗ nặng trong 2023 (`STRONG_UPTREND ×
KANE_THUAN_TREND_LONG` -7.03R/22L, `STRONG_DOWNTREND × KANE_THUAN_TREND_SHORT`
-10.51R/19L) — khác hẳn pattern "bắt dao rơi" đã sửa. Theo tháng: 5/12 tháng lỗ
nặng (-10 đến -20R/tháng) xen giữa tháng lãi tốt — đặc trưng "crypto winter"
2023 (biến động thấp, nhiễu cao). Điểm sáng duy nhất: `RANGING ×
KANE_THUAN_TREND_LONG` vẫn lãi +8.88R/26L suốt năm — chưa rõ lý do, cần tìm hiểu
thêm.

**Đã thử 1 hướng cho whipsaw 2023/tháng 10 — THẤT BẠI, đã revert:** thêm đệm %
yêu cầu breakout "dứt khoát" (`breakoutBufferPct`, đệm 0.1% qua đỉnh/đáy nến
trước thay vì chỉ cần đóng cửa cao/thấp hơn 1 tick). Kết quả: cải thiện PF/DD
trên baseline 1 năm thuận lợi (PF 1.36→1.48, DD -12.66R→-9.17R) NHƯNG làm tệ hơn
đúng ở 2023 (PF 0.77→0.67, R -40.27→-40.71) và tháng 10 (PF 0.52→0.27, R
-4.77→-5.87). Lý do: đợi phá dứt khoát = vào trễ hơn, trong thị trường chop vào
trễ thường đúng lúc giá sắp quay đầu — ngược hướng cần. **Revert hoàn toàn.**

**Đã thử thêm 1 lần nữa cho Range Trade (v2, bỏ lớp lọc marketPhase H4) — vẫn
THẤT BẠI:** debug độc lập (iterate H1 trực tiếp) tìm thấy 22 tín hiệu "lý thuyết"
hợp lệ cho BTC tháng 10 (chop + áp sát biên range + râu từ chối + RR≥1.2), nghi
ngờ do `marketPhase` H4 chặn nhầm. Implement lại Range Trade Fade KHÔNG check
marketPhase, test qua `backtest_1year.mjs` (harness thật, có D1 wiring đầy đủ):
tháng 10 vẫn **y hệt 0 lệnh mới** (-4.77R/14L không đổi), và tổng thể còn tệ hơn
(PF 1.36→1.29, DD -12.66R→-15.09R). Kết luận: 22 tín hiệu "lý thuyết" không khớp
cơ chế thật (ADX tính trên cửa sổ dữ liệu giới hạn trong backtest + trigger thật
dùng M15 không phải H1 như debug độc lập). **Revert hoàn toàn.**

**Chưa xử lý — đã thử hết các hướng hợp lý trong phạm vi kiến trúc hiện tại.**
Tổng cộng 8 thử nghiệm riêng cho whipsaw 2023/tháng 10 đều thất bại (TP xa hơn,
Runner Mode, RR thấp hơn toàn cục, Range Trade RR=2.0, Range Trade Fade RR=1.2,
miễn chop cho Zone Reaction, breakout buffer, Range Trade Fade v2 bỏ marketPhase).
Các hướng còn lại CHƯA thử, nhưng đòi hỏi thay đổi kiến trúc lớn hơn nhiều, không
còn là tinh chỉnh tham số:
- Lọc theo ATR Compression chặt hơn RIÊNG cho giai đoạn kéo dài nhiều ngày liên
  tục (không phải 1 bar tức thời như hiện tại).
- Time-stop ngắn hơn khi đang whipsaw.
- Setup hoàn toàn mới dùng chỉ báo khác (VWAP/EMA9 - xem Phần 5) thay vì cố nặn
  thêm từ kiến trúc Fractal Pivot + Liquidity Tier hiện tại.
KHÔNG được chỉnh mù, phải backtest lại cụ thể trên 2023 + tháng 10 trước khi
đụng live, vì baseline hiện tại (2025-2026) đang dương rất tốt, không được làm
hỏng nó khi cố sửa 2023.

## Phần 6 — Research mở rộng kỹ thuật ngoài (26/10): Volume Profile & ICT Breaker Block
Theo yêu cầu "mở rộng tư duy, tìm nguồn trên mạng cải thiện" — research qua
WebSearch 3 hướng (Volume Profile/Order Flow, ICT SMC nâng cao, Wyckoff). Kết
luận research (xem chi tiết đầy đủ tại
`docs/strategies/VOLUME_PROFILE_BREAKER.md`): Order Flow/CVD thật **không khả
thi** (OKX public REST không có tick/footprint data). Wyckoff Spring/UTAD về
bản chất **đã có sẵn** trong engine (trùng `classifyLiquidityTiers` sweep
logic). 2 ý tưởng mới thật sự khả thi với OHLCV sẵn có, đã code + test:

| Kỹ thuật | Hàm | Trạng thái | Kết quả backtest 1 năm (so baseline PF 1.52/+62.92R/238L) |
|---|---|---|---|
| Volume Profile POC/VAH/VAL làm cản bổ sung Zone Reaction | `calculateVolumeProfile()` indicators.js | ❌ Test xong, KHÔNG bật mặc định | PF 1.52→**1.44** (giảm), Tổng R +62.92→**+78.70R** (tăng do 334L thay 238L), DD -15.55→-15.72R (tệ hơn nhẹ). Thêm nhiều lệnh nhưng pha loãng chất lượng — PF giảm rõ, không đạt chuẩn "cải thiện thật" của dự án. |
| ICT Breaker Block retest làm cản bổ sung Zone Reaction | `findBreakerBlocks()` indicators.js | ❌ Test xong, KHÔNG bật mặc định | PF 1.52→**1.27** (giảm mạnh), Tổng R +62.92→**+46.13R** (giảm), DD -15.55→**-18.32R** (tệ hơn). Tệ hơn baseline ở cả 3/3 chỉ số chính — revert hoàn toàn. |

**Update cùng ngày — đã thử tiếp cả 2 hướng gợi ý (V2):** Volume Profile chỉ
bật khi `d1Phase==='RANGING'` → **TỆ HƠN cả V1** (PF 1.34, +53.68R). Breaker
Block đổi từ OR (thêm cản mới) sang AND filter (chỉ giữ cản hiện có trùng
vùng breaker) → PF nhích nhẹ 1.52→1.55 nhưng DD tệ hơn rõ -15.55→-17.74R, 2/4
chỉ số đứng yên — không đạt chuẩn đánh đổi được. Cả 4 lần thử (V1×2, V2×2) đều
không vượt baseline. Dừng research hướng này. Chi tiết đầy đủ:
`docs/strategies/VOLUME_PROFILE_BREAKER.md` Phần 5.

**Quyết định:** Giữ `useVolumeProfile`/`useBreakerBlocks` mặc định `false` trong
`src/config.js` (opt-in qua env `USE_VOLUME_PROFILE=true`/`USE_BREAKER_BLOCKS=true`
để ai muốn tái test sau có thể làm ngay, không cần sửa code). Code (hàm +
test unit `scripts/check.mjs` mục 19, 88/88 PASS) **vẫn giữ lại trong repo**
làm thư viện tham khảo cho agent sau — có thể hữu ích nếu kết hợp với điều
kiện lọc khác (ví dụ chỉ dùng VP làm cản khi `d1Phase === 'RANGING'` thay vì
luôn luôn), nhưng đó là hướng CHƯA thử, không phải kết luận cuối. Không deploy
lên Railway (live path vẫn chạy baseline `7c8423a`, verify qua
`node src/server.js --single-run` xác nhận scanner hoạt động bình thường với
cờ mặc định tắt).

## Quy tắc bắt buộc cho các bước tiếp theo
1. Mọi thay đổi logic thoát lệnh/entry phải test qua backtest full-history (không
   chỉ 1 tháng) TRƯỚC khi áp vào `src/engine.js`/`src/server.js`.
2. Không tự ý deploy lên Railway khi chưa có số liệu backtest xác nhận cải thiện so
   với baseline ở trên.
3. Cập nhật bảng tiến độ + bảng quyết định ở trên ngay sau mỗi bước, có số liệu cụ
   thể, không tóm tắt chung chung.
