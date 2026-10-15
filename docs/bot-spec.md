# Đặc tả bot Futures — `paper-v2.4.0`

Cập nhật: 2026-10-14. Nguồn chân lý về hành vi bot; số liệu kiểm chứng ở [nhật ký nghiên cứu](nhat-ky-nghien-cuu.md). Đổi luật vào lệnh thì tăng `STRATEGY_VERSION` (`lib/trading-policy.ts`) để tách sổ paper.

## 1. Phạm vi

- Dữ liệu giá công khai OKX (21 coin trong `COINS` của `lib/telegram-alerts.ts`); tự đặt lệnh trên MEXC; tin báo Telegram để chủ tài khoản vào tay.
- Vòng quét: `instrumentation.ts` gọi `scanAndAlert()` 30 giây sau khi khởi động, sau đó mỗi 5 phút. Gọi tay: `GET /api/cron/telegram`.
- Giao dịch tay được coi là **phí 0** khi đánh giá kèo; đường API MEXC trả taker 0.08%/chiều.
- Chỉ dùng nến đã đóng để ra tín hiệu.

## 2. Các kèo và trạng thái

| Kèo | Code | Bot làm gì | Kiểm chứng 2025–26 (phí 0, 2.5$/lệnh) |
|---|---|---|---|
| **Hai đỉnh/đáy 4H** thuận xu hướng ngày coin + BTC, volume nến tín hiệu ≥ 2x | `analyse` → `evaluateSetup` → `isLiveEligible` | Tự vào lệnh MEXC (khi bật live), **không TP**, SL trailing 3×ATR(4H) theo giá đóng tốt nhất (`trailingStop`) | Code live: 29 lệnh, +1.22R/lệnh, 2025 +45$ / 2026 +43$ |
| **📌 Đặt sẵn Limit dưới đáy 1H** (chỉ LONG, coin tăng ngày) | `restingLimit` + `lib/resting-limit.ts` | Tin 📌 + paper `data/paper-limit.json` | Code live: 2.005 lệnh, +0.063R (t=1.85), 2025 +145$ / 2026 +172$ |
| **🎯 ICT quét đỉnh hôm qua → SHORT 1H** | `ictSweepShort` (`lib/patterns.ts`) | Tin 🎯 + paper `data/paper-ict.json` | Code live: 193 lệnh, +0.42R (t=3.5), 2025 +119$ / 2026 +85$ |
| BOS 4H | `analyse` | Tin `📋 PAPER - KHÔNG ĐỦ CHUẨN LIVE` + sổ paper | Không đạt |
| Donchian 1D | `analyseDaily` | Chỉ paper | Không đạt (≈ vào ngẫu nhiên) |
| Toàn cảnh 5 lớp (`lib/overview.ts`) | `pickCoin` | Chỉ paper (`paper-overview.json`, Limit ở `paper-overview-limit.json`), **không gửi tin** | −0.02R/lệnh, điểm ≥ 5 còn tệ hơn |
| FVG 1H → quét 15m | `fvgSweepSignal` | Chỉ paper (`paper-fvg.json`) | 2025 không hơn vào ngẫu nhiên |

### 🎯 ICT luật chi tiết (`ictSweepShort`, video ICT quét thanh khoản)

- Ngày UTC: nến 1H đầu tiên vượt đỉnh hôm qua (PDH) = quét. Trong 24 nến sau, nến đóng dưới swing đáy gần nhất (xác nhận trước lúc quét) = ChoCh.
- FVG giảm mới nhất giữa quét và ChoCh (high[j] < low[j−2]) → Sell Limit **giữa FVG**; SL = đỉnh cao nhất từ quét tới ChoCh + 0.1 ATR; TP = đáy hôm qua (PDL); bỏ nếu TP < 1.5R.
- Báo đúng lúc nến ChoCh vừa đóng; paper như 📌 (24 nến chờ khớp, huỷ nếu chạm TP trước, tối đa 48 nến). Chiều LONG (quét PDL) ≈ 0 → không dùng; khung 15m lỗ.

### 📌 Luật chi tiết (`lib/patterns.ts` `restingLimit`)

- Đáy 1H vừa xác nhận (3 nến đóng sau đáy), xu hướng ngày của coin tăng.
- Bỏ nếu nến tạo đáy có volume ≥ 2.5x trung bình 20 nến trước (lực bán thật, giá hay xuyên qua Limit).
- Limit mua = đáy − 0.5×ATR(1H); SL = Limit − 1.5×ATR; TP = đỉnh 1H trước đáy (bỏ nếu < 1R). Tin kèm **TP1 = 1R: chốt 50% rồi dời SL về giá vào** (cách chủ dự án đánh; backtest 2025 +9$ / 2026 +165$, thắng ~53%). Paper vẫn đo theo TP đỉnh 1H.
- Hiệu lực 24 nến 1H; huỷ nếu giá chạm TP trước khi khớp. Mỗi coin 1 lệnh chờ: **đáy mới thay Limit cũ chưa khớp** (tin ghi "⚠️ huỷ Limit cũ @giá"); lệnh đã khớp thì không đặt thêm.
- Paper: nến chạm Limit là khớp ở min(Limit, giá mở); nến khớp mà chạm SL tính thua; không tính TP trên nến khớp; tối đa 48 nến; trượt giá 0.04%.
- SHORT không bật: +0.047R nhưng vào ngẫu nhiên +0.070R.

## 3. Bộ lọc decision engine (`lib/decision-engine.ts`, kèo 4H/1D)

Từ chối với mã: `INVALID_DATA` (thiếu/lỗi dữ liệu), `BOT_LOCKED` (xem mục 4), `TREND_MISMATCH`, `BTC_MOMENTUM_BLOCKED` (2 nến BTC 1H gần nhất ngược chiều ≥ 0.7%), `EXTREME_FUNDING` (|funding| > 0.03%), `LOW_VOLUME` (< 0.75x SMA20), `STALE_SIGNAL`, `INVALID_STOP` (SL ngoài 1.5–6%), `RUNAWAY_PRICE` (giá trôi > 0.25% so với giá đóng nến tín hiệu).

## 4. Vốn, đòn bẩy, MEXC

- **Kèo 4H đủ chuẩn live ("kim cương")**: ký quỹ = **90% vốn**, x10 (chủ dự án chọn đánh full vốn, `calculateTierSizing(isDiamond)`). Ví dụ vốn 29$, SL 3% → lỗ khi chạm SL ≈ 7.8$ (~27% tài khoản).
- Kèo khác dùng bậc vốn (`lib/capital-tier.ts`): dưới 80$ (kể cả < 30$) rủi ro **4$/lệnh**, tối đa 2 lệnh; 80–119.99$ 4$/3 lệnh; 120–149.99$ 4.8$/3 lệnh; 150–199.99$ 6$/4 lệnh; ≥ 200$ 8$/4 lệnh.
- `BOT_LOCKED`: vốn < 3$, hoặc sụt ≥ 20% từ đỉnh khi vốn ≥ 20$ (dưới 20$ bỏ cầu dao drawdown).
- Isolated tối đa x10; SL > 6% thì hạ x5. Lệnh thật chỉ khi `MEXC_LIVE_TRADING=true` **và** `MEXC_DRY_RUN=false`; setup không đạt `isLiveEligible` luôn bị ép dry-run.
- SL gắn ngay khi mở; không xác nhận được SL thì đóng vị thế. Không mở trùng coin đang giữ.
- Tin tay ghi đòn bẩy gợi ý `x≤` = min(10, 0.8 ÷ %SL) để chạm SL mất ≤ 80% ký quỹ. Khối lượng nên tính từ số tiền chấp nhận mất mỗi lệnh ÷ %SL.

## 5. Tin Telegram (mẫu chung 2 dòng)

```
📋 KÈO MỚI 16:15
🟢 LONG NEAR · 📌 Limit 4,933
   SL 4,779 (−3.1%) · TP1 5,087 · TP2 5,181 · x10
🤖 Bot đã vào 🟢 LONG SOL · 4H kim cương 118,2
   SL 115,0 (−2.7%) · không TP, SL tự dời theo 3 ATR · ký quỹ 26$ x10
```

- Kèo tay gộp trong 1 tin `📋 KÈO MỚI` mỗi lượt quét, tối đa 5 kèo (R:R cao nhất). TP1 = 1R: chốt 50% rồi dời SL về giá vào; TP2 = mục tiêu. `x` = đòn bẩy gợi ý (≤ 10). Tin thay Limit có thêm "huỷ Limit cũ …".
- Mỗi coin + chiều tối đa 1 tin/6 giờ, trừ tin thay Limit.
- Tin Mỹ (`lib/us-events.ts`, lịch CPI/NFP/FOMC trong `lib/us-events.json`): `⏰ 19:30 tin CPI Mỹ (còn ~N phút)` trước ≤ 60 phút; `⚡ CPI vừa ra · BTC nến 5m đầu 🔴 −0.60% (…)` khi nến 5m đầu đóng. **Chỉ là thông tin** — vào theo nến đầu và mở long+short x30 trước tin đều lỗ trong backtest. Cập nhật lịch tin hằng năm từ BLS/Fed.
- Lệnh MEXC: `📈` dời SL trailing, `🚪` đóng khi giá qua SL trailing, `🎯/🛑 [MEXC ĐÃ ĐÓNG]` kèm lãi/lỗ thật, `🛑/🚨` lỗi SL.
- Paper 📌: `🧪 … paper KHỚP / ĐÓNG`, `⌛` hết 24h, `↗️` chạy tới TP trước khi khớp. Kèo đã tắt tin (Toàn cảnh, FVG, BOS, Donchian) ghi paper im lặng.
- Webhook `@VictorHuynh_trading_bot`: gõ tên coin để xem kèo; lệnh "thống kê" so lệnh thật với backtest.

## 6. Vận hành

- `/api/mexc-check?secret=CRON_SECRET`: số dư + vị thế MEXC. `/api/watchlist`, `/api/paper`, `/api/live/levels`.
- File paper và dedup nằm trong `data/` → production cần volume (Railway `web-volume`).
- Kiểm tra trước khi push: `npm run test:policy`, `node tests/test_overview.mjs`, `node tests/test_resting_limit.mjs`, `python -m pytest -q`, `npm run build`.
- Kiểm chứng lại bằng code live: `node --experimental-strip-types --no-warnings service/scripts/live_replay_study.mjs`.

## 7. Giới hạn

- Chỉ 2 năm dữ liệu (2025–26) và các kèo được chọn sau khi xem chính giai đoạn đó → kết quả thật thường thấp hơn. Theo dõi paper trước khi tăng tiền.
- Dữ liệu backtest từ Binance futures, giá lệch nhẹ so với OKX/MEXC.
- Kèo 4H ít lệnh (~1–2/tháng); 📌 nhiều lệnh nhưng thắng ~35%, chuỗi thua 5–7 lệnh là bình thường.
