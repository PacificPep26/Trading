# Ngữ cảnh dự án — đọc trước khi làm gì

> **Việc đang làm dở: đọc [BAN-GIAO.md](BAN-GIAO.md) trước.**

Cập nhật 2026-10-15 · version `v3.0.0`. Chủ dự án: Victor, giao dịch tay USDT perpetual trên MEXC (phí 0 khi đánh tay),
tối đa x10, thích tin nhắn ngắn, đánh nhanh (chốt 50% ở 1R rồi dời SL hoà vốn). Trao đổi bằng tiếng Việt.

## Bot làm gì

Next.js 16 trên Railway (`main` push là tự deploy). Quét 21 coin bằng dữ liệu OKX mỗi 2 phút (`instrumentation.ts`),
**chỉ gửi tin Telegram** — không tự đặt lệnh. Mỗi kèo có sổ paper để so với backtest.

| Kèo | Code | Paper | Code live chạy lại 2025 / 2026 (2.5$/lệnh, phí 0) |
|---|---|---|---|
| 🎯 ICT quét đỉnh hôm qua → ChoCh → Sell Limit giữa FVG, TP đáy hôm qua (1H, SHORT) | `ictSweepShort` (`lib/patterns.ts`) | `data/paper-ict.json` | +119$ / +85$ · +0.42R · 193 lệnh |
| 📌 Limit mua 0.5 ATR dưới đáy 1H vừa xác nhận, coin tăng ngày (LONG) | `restingLimit` | `data/paper-limit.json` | +131$ / +169$ · +0.06R · 2.003 lệnh |
| 📊 Hai đỉnh/đáy 4H thuận ngày coin + BTC, volume ≥ 2x, không TP, SL trailing 3 ATR | `analyse` + `isSwingSetupOk` (`lib/trading-policy.ts`) | `data/paper-4h.json` (`lib/swing-4h.ts`) | +46$ / +45$ · +1.26R · 29 lệnh |

**15/10: chủ dự án bỏ kèo cũ — 📌 và 📊 TẮT TIN, chỉ ghi paper** (`recent_replay.mjs` 1–15/10: 📌 −105$, 📊 −2$). Tin đang gửi: 🎯 ICT, 🔨 high test, 📈 Supertrend 4H, 🔁 hồi đỉnh cũ, 👤 🚀 🕯 (SO Trading).

**🔨 Nến high test 4H → lệnh chờ phá** (`highTestSetup`, Jason Graystone, đạt chuẩn): 2025 +303$ / 2026 +132$, sổ `data/paper-hightest.json`.

**📈 Supertrend 4H đổi màu → vào ngay, không TP, SL dời theo dải** (`stFlipSetup` + `swing-4h.ts` `trail: "st"`, Wysetrade, đạt chuẩn): 2025 +139$ / 2026 +85$, sổ `data/paper-st.json`, tin `📈 Supertrend … dời SL` / `🚪`.

**Thêm 4 kèo SO Trading 1H** (`lib/so-setups.ts`, sổ `data/paper-so-*.json`): 🔁 hồi đỉnh cũ (+212$ / +195$, đạt chuẩn mỏng), 👤 vai–đầu–vai, 🚀 phá vỡ sau nén, 🕯 chòm râu — 3 kèo sau KHÔNG đạt chuẩn; chủ dự án vẫn chọn nhận tin, mỗi tin ghi số backtest để tự cân nhắc. Đừng tự xoá chúng.

Kèm: nhắc tin Mỹ CPI/NFP/FOMC (`lib/us-events.ts`, lịch `lib/us-events.json` — cập nhật mỗi năm), theo dõi giá chủ dự án đặt (`lib/price-watch.ts`).

## Sơ đồ file

- `lib/telegram-alerts.ts` — vòng quét: tin Mỹ → theo dõi giá → (nến 4H vừa đóng) 📊 → (nến 1H vừa đóng) 🎯 📌 → 1 tin `📋 KÈO MỚI` mẫu 2 dòng (`planText`).
- `lib/patterns.ts` — nhận diện kèo. `analyse` phải khớp `service/backtest/patterns.py` (`tests/test_parity.py`).
- `lib/resting-limit.ts` (sổ Limit 📌/🎯), `lib/swing-4h.ts` (sổ 4H + nhắc dời SL), `lib/snapshot.ts` (trạng thái coin cho web + Telegram).
- `app/api/telegram/webhook` (lệnh: tên coin, `thống kê`, `theo dõi …`), `app/api/watchlist` + `app/live-scanner.tsx` (bảng web), `app/api/cron/telegram` (gọi tay).
- `service/backtest/` khung backtest Python; `service/scripts/` mọi nghiên cứu (giữ hết làm bằng chứng; `legacy/` là code kèo đã loại để script cũ chạy lại).
- `data/` (không vào git, là volume Railway): dữ liệu nến, sổ paper, chống trùng tin.

## Quy tắc vàng

1. **Kèo chỉ được báo khi đạt chuẩn** (chốt trước khi chạy): dương riêng 2025 và 2026 · t ≥ 2 · hơn vào ngẫu nhiên cùng SL/TP · chạy lại bằng code live (`service/scripts/live_replay_study.mjs`) ra cùng số. Phí 0 (tay), trượt 0.04%.
2. **Tra `docs/so-tay-kien-thuc.md` trước khi thử ý mới** — đã có hơn 20 ý bị loại kèm lý do. Thử xong thì thêm dòng.
3. Backtest Limit: **không tính TP trên nến khớp**, SL trước nếu cùng nến; không nhìn nến chưa đóng.
4. Đổi luật vào lệnh → chạy lại `live_replay_study.mjs`, tăng `STRATEGY_VERSION`, ghi `docs/nhat-ky-nghien-cuu.md`.
5. Không thêm lớp "AI"/chấm điểm chưa backtest; không báo kèo chỉ vì "nhìn chart thấy đúng hôm qua".
6. Trả lời chủ dự án bằng tiền ($) và tỷ lệ thắng, ngắn; không giảng về phí.

## Thêm kiến thức (quy trình với `docs/research/MASTER_VIDEO_HUB.md`)

Một agent khác lấy video (lời thoại) vào `docs/research/MASTER_VIDEO_HUB.md` — **không sửa file đó**. Việc của agent này: đọc mục mới →
viết luật đo được → backtest (thêm vào `service/scripts/video_hub_study.py` hoặc script riêng) → nhật ký + bảng "Đối chiếu MASTER_VIDEO_HUB"
trong `docs/so-tay-kien-thuc.md` (theo số #). Chủ dự án quyết định kèo nào vào bot (có thể chọn báo cả kèo không đạt, ghi số backtest trong tin).

## Kiểm tra trước khi push

```powershell
npm run test:policy        # test JS: ICT, Limit, 4H, tin Mỹ, theo dõi giá
python -m pytest -q        # khung backtest + parity TS/Python
npm run lint; npm run build
node --experimental-strip-types --no-warnings service/scripts/live_replay_study.mjs   # 3 kèo phải ra số như bảng trên
```

**Cẩn thận:** `.env` ở máy có token Telegram thật — chạy `next start`/gọi `/api/cron/telegram` ở máy sẽ gửi tin thật và tự quét mỗi 2 phút.
