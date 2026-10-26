# Tài liệu Logic Toàn Diện — Bot OKX Dr. Kane

> Viết cho người đọc hiểu và tự điều chỉnh code, không phải người mới học trading.
> Đi theo đúng luồng dữ liệu thật: từ lúc fetch nến tới lúc gửi Telegram.
> Trạng thái tại commit `d289ed4` (26/10/2026). Baseline đã verify: PF 1.47,
> +60.32R/năm, 245 lệnh (xem `docs/REGIME_ADAPTIVE_PLAN.md` để biết lịch sử các
> lần tinh chỉnh và lý do từng quyết định).

## 1. Sơ đồ luồng chạy (1 chu kỳ quét = 60 giây)

```
server.js: runScanCycle()  [src/server.js:~670]
│
├─ 1. fetchOkxCandles('BTC-USDT-SWAP', H4 + H1)   → Đầu Tàu BTC Macro
│
├─ 2. updateOpenPositionPrices()                   → cập nhật SL/TP/Breakeven
│      cho các vị thế ĐANG MỞ (nếu có)
│
├─ 3. scanUniverseForCandidates(btcH4, btcH1)      → quét 6 coin, mỗi coin:
│      a. fetchOkxCandles(H4, H1, M15, D1)
│      b. checkAdaptiveTradeAllowed() — lọc kỷ luật chung
│      c. evaluateMarket()  ⭐ TRÁI TIM CỦA BOT (src/engine.js)
│      d. checkAdaptiveTradeAllowed() — lọc kỷ luật theo hướng
│      e. calculateSetupQualityScore() — chấm điểm 0-100
│      f. nếu score >= 75 → thêm vào candidateSignals[]
│
├─ 4. pickAndExecuteWinners(candidateSignals)      → xếp hạng, chọn tối đa
│      CONFIG.maxOpenPositions (=2) ứng viên điểm cao nhất → mở lệnh ảo
│
└─ 5. checkAndTriggerDailyBriefing()               → bản tin Gemini 07:00 sáng
```

## 2. `evaluateMarket()` — trái tim của bot (`src/engine.js:179-920`)

Nhận vào: `{symbol, candlesH4, candlesH1, candlesM15, candlesD1, btcH1Candles,
btcH4Candles, config}`. Trả về: `signal` (có lệnh), `{isBlocked, blockReason}`
(bị chặn, không lệnh), hoặc `null` (không khớp cấu trúc nào, im lặng).

### 2.1. Bước chuẩn bị ngữ cảnh (trước khi thử bất kỳ setup nào)

| Bước | Biến | Vai trò |
|---|---|---|
| EMA Kane | `ema34`, `ema89` (H4) | Xác định trend cơ bản: `isBullTrend = ema34>=ema89` |
| **marketPhase (H4)** | `detectMarketPhase()` | `STRONG_UPTREND` / `STRONG_DOWNTREND` / `RANGING` |
| **d1Phase (D1)** ⭐ mới | `detectMarketPhase()` áp lên D1 | Giống trên nhưng khung Ngày — bắt trend lớn mà H4 bỏ sót |
| **Momentum nhanh** ⭐ mới | `recentMovePct` (12 nến H4 gần nhất) | `isActiveDownMove`/`isActiveUpMove` nếu đổi giá ≥4% trong 2 ngày |
| Chop filter | `curADX` (H1), `atrRatio` | ADX≤20 hoặc ATR nén <0.70 → `chopBlockedSignal` (chặn Kane Long/Short) |
| Fractal pivots | `resistances[]`, `supports[]` | Đỉnh/đáy H4 làm cản/hỗ trợ, cộng thêm Tier-2 Liquidity + FVG chưa lấp |
| VSA | `volAbsorptionH4/M15` | Phát hiện Climax Absorption (hấp thụ khối lượng đột biến) |
| BTC Shield | `btcShield.canLong/canShort` | Nếu BTC đang Marubozu xả/bơm mạnh → cấm altcoin đi ngược |

### 2.2. 3 setup thử theo thứ tự ưu tiên (dừng ngay khi 1 cái khớp)

**`tryKaneLongSetup()`** (dòng ~352) — bắt đáy khi giá quét hỗ trợ:
1. `if (chopBlockedSignal) return null` — tắt khi đang chop
2. `if (!isFreshH4) return null` — chỉ chạy trong 8 nến M15 đầu sau khi H4 đóng (`config.freshH4Bars`)
3. Với mỗi `sup` trong `supports[]`: `lastH4.low < sup` (đã quét qua)
4. **Chặn nếu:** `marketPhase===STRONG_DOWNTREND` HOẶC `isActiveDownMove` HOẶC `d1Phase===STRONG_DOWNTREND` (3 lớp lọc "cấm bắt dao rơi", lớp cuối mới thêm hôm nay)
5. Lọc Inducement Trap (tránh bẫy thanh khoản con chưa quét)
6. Xác nhận wick + VSA + trend để quyết định `canLong`
7. M15 phải đóng xanh VÀ phá đỉnh M15 trước (`isM15Breakout`)
8. Entry nằm nửa dưới Discount Zone (chống đuổi giá)
9. SL = đáy H4 - đệm ATR; No-Chasing nếu SL xa >2.5%
10. Tìm kháng cự đối diện đạt RR ≥ `config.minRR` (2.0) → trả signal

**`tryKaneShortSetup()`** (dòng ~469) — đối xứng, bắt đỉnh khi giá test kháng cự.

**`tryZoneReactionSetup()`** (dòng ~600) — đón đầu tại Tier-2 Major Level (không
cần `isFreshH4`, không bị `chopBlockedSignal` chặn), đòi hỏi VSA Climax với
altcoin, chỉ cần wick với BTC/ETH (coin dẫn dắt).

→ Không setup nào khớp: trả `blockedSignal || chopBlockedSignal` (lý do bị chặn,
để log minh bạch) hoặc `null`.

## 3. Các lớp lọc kỷ luật NGOÀI `evaluateMarket()` (`src/server.js`, `src/learning.js`)

```
checkAdaptiveTradeAllowed(symbol, direction, btcH1, btcH4)  [src/learning.js:277]
```
Đọc `data/trade_memory.json`:
- `systemCircuitBreakerUntil` — đóng băng TOÀN HỆ THỐNG sau nhiều lệnh thua liên tiếp
- `penalties[symbol]` — án phạt riêng từng coin, 2 kiểu:
  - **Neo theo cấu trúc Đầu Tàu** (`requiredBtcConfirmation`): chỉ gỡ khi BTC xác
    nhận đảo chiều thật (không phải hẹn giờ cứng)
  - **Phạt thường** (`penaltyUntil`): hẹn giờ tối thiểu 4 tiếng

```
calculateSetupQualityScore({signal, candlesH4, candlesH1, candlesM15, btcH1Candles})
  [src/engine.js, hàm riêng]
```
Thang 100 điểm, 4 thành phần (~25đ mỗi phần): độ sạch râu nến, VSA Climax, cấp độ
cản SMC/FVG, sức mạnh tương đối so với BTC. Ngưỡng qua: `config.minSetupQualityScore` (75).

## 4. Quản lý vị thế đang mở (`updateOpenPositions`, `src/server.js:218-350`)

Chạy mỗi chu kỳ cho MỌI vị thế mở, theo thứ tự:
1. Tính `currentR` theo giá đóng cửa, `curMaxR` theo wick thuận lợi nhất
2. **Profit Lock:** `curMaxR >= beTriggerR(1.4)` → dời SL lên `entry + lockProfitR(0.05)*riskDist`
3. **Check SL trước TP** (nguyên tắc bảo toàn vốn — nếu 1 nến giật cả 2 đầu)
4. **Check TP:** đóng 100%, ghi `logClosedTrade(..., 'TP', ...)`
5. **Time-Stop:** ⚠️ **ĐÃ TẮT HẲN (26/10, `timeStopBars=0` cả code lẫn
   Railway)** sau khi phát hiện backtest trước đó không hề mô phỏng bước này —
   khi vá đúng, số liệu lật từ +60.32R thành -7.48R với `TIME_STOP_BARS=16`
   (giá trị Railway cũ, chính là nguyên nhân 2 lệnh Time-Stop thật ngày
   25/10). Mọi mốc đã test (16/48/96/150 nến, và cả kiểu đổi điều kiện theo H4)
   đều tệ hơn tắt hẳn — xem bảng đầy đủ trong `REGIME_ADAPTIVE_PLAN.md`.

**Lưu ý quan trọng:** không có Runner Mode, không có Partial Exit — cả 2 đã
test và làm TỆ HƠN baseline (xem Phần "Quyết định & Lý do" trong
`REGIME_ADAPTIVE_PLAN.md`). TP/SL là all-or-nothing.

## 5. Bảng tham số điều chỉnh được (file `src/config.js`, có thể override qua `.env`)

| Tham số | Giá trị hiện tại | Ảnh hưởng | Đã test gì chưa |
|---|---|---|---|
| `MIN_RR_RATIO` | **2.0** | RR tối thiểu để vào lệnh | Đã test 1.0/1.5 → tệ hơn, giữ 2.0 |
| `FRESH_H4_BARS` | **8** | Cửa sổ Kane Long/Short còn hoạt động sau H4 đóng | Quét 4/6/8/10/16, 8 là đỉnh |
| `MOMENTUM_LOOKBACK_BARS` | **12** | Số nến H4 nhìn lại để bắt trượt giá nhanh | Quét 6/12/18/24, 12 là đỉnh |
| `MOMENTUM_THRESHOLD_PCT` | **4** | Ngưỡng % coi là "đang trượt nhanh" | Chưa quét riêng |
| `MIN_H1_ADX` | 20 | Ngưỡng Chop Sleep Mode | Đã test 16 → tệ hơn |
| `MIN_SETUP_QUALITY_SCORE` | 75 | Điểm tối thiểu để vào lệnh | Chưa test riêng |
| `BE_TRIGGER_R` | 1.4 | Mốc dời SL hòa vốn | Chưa test riêng |
| `TIME_STOP_BARS` | **0 (TẮT HẲN, đã deploy)** | Số nến M15 trước khi đóng chủ động | Đã quét 16/48/96/150/H4_CONDITION — tắt hẳn là tốt nhất (PF 1.47), xem bảng đầy đủ trong REGIME_ADAPTIVE_PLAN.md |
| `SCAN_MODE` | WATCHLIST | 6 coin cố định hay quét Top volume | Giữ WATCHLIST theo khuyến nghị cũ |

## 6. Nơi dữ liệu được lưu

| File | Nội dung | Git? |
|---|---|---|
| `positions.json` | Vị thế ĐANG MỞ | gitignore |
| `data/trade_history.json` ⭐ mới | **Toàn bộ lệnh đã đóng** (TP/SL/TIME_STOP) | gitignore |
| `data/trade_memory.json` | Án phạt kỷ luật + 28 "bài học" gần nhất | **có commit** (snapshot, không phải log sống) |
| `docs/REGIME_ADAPTIVE_PLAN.md` | Lịch sử MỌI thử nghiệm đã làm (thành công + thất bại) kèm số liệu | có commit |
| `data/cache_1year/` | Nến lịch sử đầy đủ từ lúc coin niêm yết (dùng cho backtest) | gitignore |

## 7. Nếu bạn muốn tự điều chỉnh — gợi ý hướng chưa khai thác

Đọc kỹ `docs/REGIME_ADAPTIVE_PLAN.md` TRƯỚC khi thử bất kỳ gì — **11 hướng đã
thử và thất bại được liệt kê rõ ràng ở đó**, tránh lặp lại công sức. Hướng còn
mở, có cơ sở từ hôm nay nhưng chưa test:

- ✅ **ĐÃ XONG (26/10): Time-Stop tắt hẳn.** Đã test cả đếm nến cố định
  (16/48/96/150) lẫn đổi điều kiện theo H4 (H4_CONDITION) — tắt hẳn luôn tốt
  nhất. Xem bảng đầy đủ trong `REGIME_ADAPTIVE_PLAN.md`. Không cần làm gì thêm
  ở mục này trừ khi muốn thử lại với giả thuyết hoàn toàn khác.
- **ATR Compression chặt hơn theo chuỗi ngày liên tục** (ví dụ
  `ATR(H1) < 0.75 × SMA(ATR(H1), 24)` duy trì liên tục ≥3 nến H1, không phải 1
  nến tức thời như hiện tại) — rất phù hợp đặc tính crypto hay nén volume
  trước khi xả mạnh. Đã ghi trong kế hoạch, chưa làm.
- Mọi backtest PHẢI qua `scripts/backtest_1year.mjs` (so baseline PF 1.47) +
  `scripts/backtest_multi_year.mjs` (test qua 2021-2025, tránh overfit vào 1 năm).

### Lưu ý hạ tầng (Railway)
- `positions.json` và `data/trade_history.json` đều đã trỏ vào Railway Volume
  bền vững (`/data/...` qua `STATE_FILE`/`TRADE_HISTORY_FILE`) — sống sót qua
  redeploy/restart. **Mọi file dữ liệu runtime mới thêm sau này đều phải trỏ
  vào `/data/` qua biến môi trường tương tự, nếu không sẽ mất sạch khi
  redeploy** (đã từng thiếu sót với `trade_history.json` lúc mới thêm,
  đã sửa — xem commit theo sau `d289ed4`).
- Mỗi chu kỳ quét fetch ~26 request OKX public API (2 cho BTC macro + 6 coin ×
  4 khung H4/H1/M15/D1), cấu trúc là **tuần tự giữa các coin, song song trong
  từng coin** (`Promise.all` cho 4 khung của 1 coin, nhưng `for` loop tuần tự
  giữa 6 coin) — không phải full-parallel 26 request cùng lúc. Thực tế quan
  sát qua log: chu kỳ luôn đóng đúng ~60-61s, chưa thấy trượt chu kỳ hay lỗi
  429 Rate Limit — nhưng nếu sau này tăng số coin quét (vd mở `DYNAMIC_TOP`),
  cần theo dõi lại điểm này.

## 8. Quy trình bắt buộc trước khi đổi bất cứ gì (theo CLAUDE.md)

```bash
npm run check                    # 76 test phải PASS 100%
node src/server.js --single-run  # chạy live thật, xác nhận không lỗi
npm run backtest                 # backtest nhanh 1 tháng (sanity check)
node scripts/backtest_1year.mjs  # backtest đầy đủ 1 năm, so với baseline PF 1.47
```
Chỉ `git push` lên `main` sau khi cả 4 bước trên đều xác nhận **cải thiện hoặc
không đổi** — Railway tự deploy ngay khi push, không có bước duyệt thủ công.
