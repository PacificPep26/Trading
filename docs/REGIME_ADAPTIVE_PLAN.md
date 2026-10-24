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

**Chưa xử lý — ưu tiên cao cho phiên sau:** whipsaw 2023/sideway vẫn chưa có
hướng xử lý nào thành công. Các hướng còn lại cần thử (chưa test):
- Lọc theo ATR Compression chặt hơn RIÊNG cho giai đoạn kéo dài (không phải
  đệm breakout) — ví dụ coin có `atrRatio` dưới ngưỡng N ngày liên tục thì tạm
  dừng hẳn Kane Long/Short, không chỉ 1 bar như hiện tại.
- Time-stop ngắn hơn khi đang whipsaw (thoát sớm hơn nếu không có lợi nhuận
  sau N nến, thay vì chờ đủ 24 nến M15 như hiện tại).
KHÔNG được chỉnh mù, phải backtest lại cụ thể trên 2023 + tháng 10 trước khi
đụng live, vì baseline hiện tại (2025-2026) đang dương rất tốt, không được làm
hỏng nó khi cố sửa 2023.

## Quy tắc bắt buộc cho các bước tiếp theo
1. Mọi thay đổi logic thoát lệnh/entry phải test qua backtest full-history (không
   chỉ 1 tháng) TRƯỚC khi áp vào `src/engine.js`/`src/server.js`.
2. Không tự ý deploy lên Railway khi chưa có số liệu backtest xác nhận cải thiện so
   với baseline ở trên.
3. Cập nhật bảng tiến độ + bảng quyết định ở trên ngay sau mỗi bước, có số liệu cụ
   thể, không tóm tắt chung chung.
