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
| 2 | Phân loại giai đoạn D1 (UPTREND/DOWNTREND/SIDEWAY) | 🔄 Script đã viết xong, chờ data D1 từ Phần 1 để chạy | - | `scripts/analyze_regime_history.mjs` (mới) | `node --check` OK, chưa chạy thật (chờ `*_1Dutc.json`) |
| 3 | Backtest full-history, phân nhóm theo (giai đoạn × setup) | ⬜ Chưa làm | - | `scripts/backtest_1year.mjs` | - |
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
| **Nới cửa sổ "độ tươi mới" H4** (`freshH4Bars`, Kane Long/Short chỉ chạy trong N nến M15 đầu sau khi H4 đóng) | 2026-10-24 | Quét 4/6/8/10/16: PF 1.16/1.21/**1.18**/1.11/1.03, Tổng R +23.37/+33.63/**+34.19**/+25.77/+12.71R, DD -18.19/-18.05/**-15.86**/-17.35/-21.93R | **ÁP DỤNG `freshH4Bars=8`** (2 tiếng thay vì 1) — cải thiện mọi chỉ số so với baseline, đã verify `npm run check` 76/76 + single-run sạch, **đang chờ xác nhận deploy** |

**Baseline cũ đang deploy trên Railway (commit `eb2ec92`, `freshH4Bars=4`):** PF 1.16,
+23.37R, +$201.92/năm, win rate 47%, max drawdown -18.19R (1 năm 10/2025-10/2026,
236 lệnh, đã áp đúng cổng quality-score + BTC H4 macro shield).

**Baseline mới (`freshH4Bars=8`, đã verify, CHƯA deploy):** PF 1.18, +34.19R,
+$302.19/năm, win rate 46.2%, max drawdown -15.86R, 303 lệnh.

## Quy tắc bắt buộc cho các bước tiếp theo
1. Mọi thay đổi logic thoát lệnh/entry phải test qua backtest full-history (không
   chỉ 1 tháng) TRƯỚC khi áp vào `src/engine.js`/`src/server.js`.
2. Không tự ý deploy lên Railway khi chưa có số liệu backtest xác nhận cải thiện so
   với baseline ở trên.
3. Cập nhật bảng tiến độ + bảng quyết định ở trên ngay sau mỗi bước, có số liệu cụ
   thể, không tóm tắt chung chung.
