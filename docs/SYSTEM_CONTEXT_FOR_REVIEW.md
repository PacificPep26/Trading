# SYSTEM CONTEXT — Crypto Futures Quant Bot (để AI khác đọc & đánh giá độc lập)

> Tài liệu này gom toàn bộ hệ thống thành 1 context duy nhất cho một AI/chuyên
> gia khác đọc và đánh giá khách quan. Viết trung thực: nêu rõ cái gì ĐÃ verify
> bằng số liệu, cái gì CHƯA, và các rủi ro đã biết. Cập nhật: 28/10/2026.

---

## 0. YÊU CẦU ĐÁNH GIÁ (gửi reviewer)
Hãy đánh giá: (1) chiến lược có edge thật hay overfit? (2) kiến trúc code có lỗ
hổng logic/rủi ro gì? (3) hệ thống đã đủ chín để chuyển từ paper sang tiền thật
chưa, nếu chưa thì thiếu gì? (4) các quyết định đã revert (xem Mục 7) có hợp lý
không? Phản biện thẳng, ưu tiên tìm điểm yếu hơn là khen.

---

## 1. TỔNG QUAN
- **Mục tiêu:** Bot định lượng giao dịch OKX USDT-M perpetual futures, chiến lược
  "Dr. Kane H4/M15" (Smart Money Concept + Sonic R Fibonacci EMA 34/89).
- **Trạng thái:** PAPER TRADING (mô phỏng 100%, CHƯA đặt lệnh tiền thật). Chạy
  24/7 trên Railway, kết nối OKX Public REST API (chỉ đọc dữ liệu nến).
- **Giao diện:** Telegram bot (báo lệnh, chat Gemini AI 2 chiều, ảnh chart).
- **Ngôn ngữ:** Node.js thuần ESM, không framework. ~10.600 dòng (gồm scripts test).
- **Repo:** GitHub, deploy tự động Railway khi push `main`.

---

## 2. KIẾN TRÚC FILE (src/)
| File | Vai trò |
|---|---|
| `indicators.js` | Thư viện hàm toán thuần (pure functions): EMA, ATR, ADX, Fractal Pivots, FVG, Volume Profile, Breaker Block, VSA Absorption, detectCandlePattern (16 mẫu nến), normalizeCandle (Data Contract). |
| `engine.js` | Lõi chiến lược. `evaluateMarket()` = hàm chính, trả signal hoặc null. 3 setup: Kane Long/Short (thuận/nghịch trend), SMC Zone Reaction. Position sizing 1R, BTC Locomotive Shield, regime detection (H4+D1), quality score 0-100. PURE, chống look-ahead. |
| `server.js` | Runtime live: quét OKX mỗi 60s, quản lý vị thế paper (SL/TP/trailing wick-level), hàng đợi Entry Delay (pendingSignals), lịch tin tức, lưu state. |
| `config.js` | Toàn bộ tham số tập trung. Đọc env override. |
| `news_calendar.js` | Lịch cứng FOMC/CPI/NFP Mỹ, tạm dừng vào lệnh ±2h quanh tin. |
| `learning.js` | Hệ thống phạt kỷ luật sau thua (ĐÃ TẮT mặc định — xem Mục 7). |
| `telegram.js` | Gửi thông báo Telegram (báo lệnh + nhãn hạng kèo, SL/TP/trailing). |
| `telegram_bot.js` | Trợ lý Gemini 2 chiều: chat tự do (nhớ 6 lượt + biết vị thế + đọc knowledge base), /status, /radar, soi ảnh chart. |
| `ai_agent.js` | Gọi Gemini API, bản tin sáng, knowledge base loader. |

**scripts/:** `check.mjs` (95 unit test), `backtest_1year.mjs` (walk-forward
chuẩn), `backtest_multi_year.mjs` (2021-2026), `backtest_portfolio.mjs` (cấp
danh mục), + nhiều script test tham số (phần lớn là nghiên cứu 1 lần).

---

## 3. CHIẾN LƯỢC CHI TIẾT
### 3 Setup (trong `evaluateMarket`)
1. **KANE_THUAN/NGUOC_TREND_LONG/SHORT:** chạy khi H4 vừa đóng nến "fresh". Cản/
   hỗ trợ từ Fractal Pivot H4 + Tier-2 Major Level + FVG H1. Vào khi nến H4 quét
   thanh khoản (sweep) + râu từ chối ≥35-45% + M15 xác nhận (đóng cùng chiều +
   phá đỉnh/đáy nến M15 trước).
2. **SMC_ZONE_REACTION:** mean-reversion tại Tier-2 Major Level, đòi VSA Climax
   Absorption (với altcoin bắt buộc) + M15 đảo chiều.
3. **SMC_SWEEP_REVERSAL:** biến thể sweep xác nhận (BULLISH/BEARISH_SWEEP_CONFIRMED).

### Các lớp lọc (gate) — thứ tự
1. Giá tối thiểu ($1), freshness H4
2. Regime: cấm Long khi STRONG_DOWNTREND / cấm Short khi STRONG_UPTREND (xét cả
   H4 phase, D1 phase, và momentum nhanh recentMovePct)
3. Chop Sleep Mode: H1 ADX ≤20 hoặc ATR nén (chỉ chặn Kane, Zone Reaction vẫn chạy)
4. SMC Inducement trap filter (tránh bắt tại cản con Equal Highs/Lows chưa quét)
5. Anti-chase (pullback rule): cấm Long ở đỉnh / Short ở đáy
6. BTC Locomotive Shield: altcoin không đánh ngược hướng BTC đầu tàu
7. `minSetupQualityScore ≥ 75` (chấm 4 phần: wick purity, VSA, key-level tier, RS vs BTC)
8. **Entry Delay:** chờ 4 nến M15 (~60 phút) xác nhận trước khi khớp thật; huỷ
   nếu SL/TP gốc bị chạm trước hoặc RR suy giảm <1.0
9. **News filter:** tạm dừng ±2h quanh FOMC/CPI/NFP

### Quản trị vốn & thoát lệnh
- Fixed 1R: `size = riskUsd / |entry-SL|`, Isolated 10X
- Trailing: chạm +1.4R → kéo SL lên +0.05R (gần hòa, đệm phí), gồng 100% tới TP ≥2R
- Time-Stop: TẮT (backtest xác nhận có hại)
- SL/TP wick-level (theo high/low nến), ưu tiên SL nếu 1 nến chạm cả 2

---

## 4. THAM SỐ LIVE HIỆN TẠI (BOT_CONFIG)
```
riskUsd=10, leverage=10, minRR=2.0, beTriggerR=1.4, lockProfitR=0.05
timeStopBars=0 (tắt), maxSlDistanceRate=0.025, atrBufferMultiplier=0.75
minSetupQualityScore=75, freshH4Bars=8, entryDelayBars=4
strictShortSweep=true, useBreakerBlocks=true (AND_FILTER, pivot 1/1)
minH1ADX=20, maxOpenPositions=3 (Railway override; default code=2)
watchlist=[BTC,ETH,SOL,LINK,NEAR]-USDT (+HYPE trên live)
News filter BẬT, Penalty system TẮT (ENABLE_PENALTY_SYSTEM!=true)
```

---

## 5. KẾT QUẢ BACKTEST (đã verify)
Walk-forward, chống look-ahead, phí Maker 0.02%, 1R=$10. Cấu hình live hiện tại:

**1 năm (10/2025-10/2026), 5 coin:**
- 212 lệnh | Win Rate 52.4% | PF **1.70** | Tổng **+74.68R** (+$715) | Max DD -13.18R
- Phân bổ: TP đầy đủ 71 (33%), trailing khóa lãi 40 (19%), SL 101 (48%)

**Đa năm 2021-2026 (chống overfit):**
- 816 lệnh | PF **1.24** | Tổng **+106.18R** | Max DD -42.03R
- Theo năm: 2021 PF1.10, 2022 PF1.30, **2023 PF0.78 (-29.63R, điểm yếu nhất)**,
  2024 PF1.36, 2025 PF1.57

**Ngưỡng chất lượng (1 năm):** score 75→WR52%/PF1.70/+74R | 80→54%/1.93/+55R |
85→58%/2.04/+39R | 90→quá ít lệnh (19), sụp.

---

## 6. ĐÃ VERIFY vs CHƯA VERIFY (quan trọng cho reviewer)
**✅ Verify bằng backtest multi-year:**
- Entry Delay 4 nến (PF 1.13→1.24, +71% tổng R multi-year)
- Breaker Block AND-filter (PF cải thiện cả 1-năm lẫn multi-year)
- strictShortSweep, D1 regime gate, Time-Stop tắt

**⚠️ KHÔNG/CHƯA verify bằng số liệu:**
- **News filter** — không có dữ liệu lịch sử thời điểm tin trong cache để backtest.
  Là "bảo hiểm dựa logic", chưa chứng minh tăng PF.
- **Penalty system** — backtest cho thấy KHÔNG giúp (PF giữ 1.64, chỉ bỏ lỡ 6%
  lệnh) → đã TẮT.
- Entry Delay + news filter mới deploy, CHƯA chạy trọn chu kỳ thật trên live.

---

## 7. CÁC HƯỚNG ĐÃ THỬ & REVERT (đừng gợi ý lại nếu không có cách tiếp cận mới)
Tất cả đều test bằng backtest rồi bác bỏ vì tệ hơn baseline:
- Hạ RR (1.0/1.5): lợi nhuận giảm 50-65%
- Partial Exit (chốt 50% sớm): PF 1.47→1.22
- Volume Profile làm cản (V1 OR & V2 RANGING-gate): PF giảm
- Runner Mode, TP mốc xa, Breakout Continuation: đều tệ
- **M5 trigger** thay M15: PF 1.33→1.25 (nhiễu hơn)
- **H1 structure** thay H4: PF 1.70→1.35
- **Cản H4 + phản ứng H1** (hybrid): PF 1.70→1.10 (tệ nhất)
- **Hybrid slot** (slot 1 vào ngay, 2-3 chờ): PF 1.64→1.46
- **Adaptive delay theo quality score:** multi-year không cải thiện (-3.4%)
- → **Bài học lặp lại 3 lần:** khung thời gian nhỏ hơn = nhanh hơn nhưng nhiễu
  hơn, cái giá nhiễu luôn thắng. H4/M15 là điểm cân bằng.

**2023 lỗ nặng (-29 đến -40R tùy cấu hình) CHƯA GIẢI QUYẾT** — nguyên nhân
whipsaw/crypto winter biến động thấp nhiễu cao; đã thử ~8 hướng đều thất bại.

---

## 8. THIẾU GÌ ĐỂ ĐÁNH TIỀN THẬT (đã audit code, xác nhận)
1. **KHÔNG có code đặt lệnh thật** — `grep` toàn repo: không có private API/ký
   HMAC/place-order. Bot CHỈ mô phỏng (tính entry/SL/TP ghi vào file). Cần viết
   module đặt lệnh OKX: ký request, đặt Limit, xử lý không khớp/lỗi/trượt giá,
   đối soát vị thế.
2. **KHÔNG mô phỏng funding rate** (8h/lần) — lệnh giữ lâu lệch P&L.
3. **KHÔNG kiểm tra thanh lý** — chưa verify SL luôn an toàn trước giá liquidation 10x.
4. Backtest giả định Limit khớp 100% — thực tế một số % không khớp (giá chạy thẳng).

---

## 9. RỦI RO & NỢ KỸ THUẬT ĐÃ BIẾT
- Lịch news cứng, cần cập nhật tay sau ~1/2027
- Nhiều script test/ là nghiên cứu 1 lần, không maintain
- `maxOpenPositions=3` tăng tổng rủi ro đồng thời lên 3R
- Hôm nay (28/10) sửa 4 bug thật (VSA sai chiều, penalty khóa 2 hướng, memory
  path không trên Volume, cổng penalty) → hệ thống còn đang ổn định, chưa "chín"
- Telegram bot token từng bị lộ 1 lần, đã rotate

---

## 10. QUY TẮC VẬN HÀNH (CLAUDE.md — bất biến)
- Mọi hàm nến phải qua `normalizeCandle()` (Data Contract)
- Verify 3 bước trước khi deploy: `npm run check` → `node src/server.js
  --single-run` → `npm run backtest`
- Chỉ phân tích cấu trúc trên nến đã đóng (confirm===1), chống look-ahead 100%
- Không deploy thay đổi logic khi chưa backtest xác nhận cải thiện so baseline
