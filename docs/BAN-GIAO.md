# Bàn giao cho agent tiếp theo (2026-10-15 khuya)

Đọc theo thứ tự: file này → [CONTEXT.md](CONTEXT.md) (bot làm gì, quy tắc vàng, deploy) → [bot-spec.md](bot-spec.md) (luồng quét, từng kèo) → [so-tay-kien-thuc.md](so-tay-kien-thuc.md) (kết luận mọi ý tưởng/video) → đầu [nhat-ky-nghien-cuu.md](nhat-ky-nghien-cuu.md) (số liệu mới nhất).

## Chủ dự án và cách làm việc

- Victor, trader Việt, **vào lệnh tay trên MEXC, phí 0** (backtest không tính phí, chỉ trượt 0.04%), đòn bẩy ≤ 10, thích đánh nhanh. Trả lời **tiếng Việt, ngắn**, báo kết quả bằng **$ ròng (2.5$/lệnh)** 2025 và 2026, không nói về phí.
- Bot Telegram **chỉ báo tin** (không tự đặt lệnh). Next.js 16 trên Railway, push `main` = deploy live. Chủ dự án hay đồng ý push; vẫn nên báo trước khi push thay đổi luật.
- Một agent khác thêm video vào `docs/research/MASTER_VIDEO_HUB.md` (+ `README.md`, `MASTER_VIDEO_DATABASE.xlsx`, `add_video.py`). **Không sửa, không commit các file đó** (kể cả `docs/research/temp_sub.*.vtt` nó để lại). Việc của mình: đọc video mới → viết luật đo được theo **lời thoại** → backtest → ghi nhật ký + sổ tay (bảng "Đối chiếu MASTER_VIDEO_HUB") → kèo nào lời thì đưa vào bot.
- **Yêu cầu đang hiệu lực của chủ dự án**: "chỉ cần có lời là vô hết cho tôi, đúng kỹ thuật thì cứ vô", **cả 2 chiều**. Tức là: luật đúng video + dương cả 2025 và 2026 (code live chạy lại) → thêm vào bot, tin ghi kèm số backtest (`BT +x$/+y$`, ghi "mỏng" nếu t < 2 hoặc không hơn ngẫu nhiên). Vẫn phải báo thật thà nếu kèo yếu.
- **Test đúng khung video dùng** (chủ dự án nhắc 15/10): mỗi video ghi khung nó dùng. Đánh trong ngày: cấu trúc **1H/15m**, vào lệnh **5m/1m**; giữ vài ngày: khung **ngày → 4H/1H**. Wysetrade Supertrend = ngày → 1H; The Trading Channel = 15m → 5m (ngày trong ngày) hoặc ngày → 4H/1H; SO Trading = 15m; VN Rebates = 1H/15m → 5m/1m.

## Bảo mật / không được làm

- `.env` có token Telegram thật: **không chạy `next start`/`next dev` hay gọi `/api/cron/telegram` cục bộ** (sẽ gửi tin thật). Không in `CRON_SECRET`, token. Không dùng/lưu API key OKX mà chủ dự án từng chụp màn hình.

## Đang làm dở (CHƯA commit)

1. **Video TradingLab "You're Using Liquidity Wrong"** (mồi nhử + FVG → Limit ở vùng A):
   - Backtest: `service/scripts/tradinglab_study.py` (`python -m service.scripts.tradinglab_study`, đặt `PYTHONIOENCODING=utf-8` trên Windows). Kết quả 1H, Limit chờ 24 nến: **2025 +28$ / 2026 +117$** (1.061 lệnh, t ≈ 0.9, thắng 25%) — lời cả 2 năm nhưng mỏng; ngẫu nhiên cùng SL/TP (bản chờ 48 nến) +146$ / −206$. 15m: +274$ / −75$ ❌. Đối chứng xác nhận logic video: vào ở A không có FVG −133$ / −304$; vào ở B (bẫy) −89$ / +47$.
   - Code live đã viết: `inducementSetup()` cuối `lib/so-setups.ts`; nối vào `lib/telegram-alerts.ts` (khối 1H, sổ `data/paper-idm.json`, `IDM_PAPER`, tin `🧲 Mồi nhử + FVG, Limit vùng A`, lệnh mới thay lệnh chờ cũ); mục **G** trong `service/scripts/live_replay_study.mjs`. `npx tsc` OK.
   - **Code live đã chạy lại (mục G): 1.000 lệnh +0.092R (t=1.4), 2025 +60$ / 2026 +169$** → dương cả 2 năm, khớp hướng Python → giữ trong bot; tin đã ghi `BT +60$/+169$ mỏng`.
   - **Còn phải làm**: dòng `🧲` trong `stats()` + `HELP` ở `app/api/telegram/webhook/route.ts` (mẫu: dòng 📈 Supertrend), test nhỏ trong `tests/test_so_setups.mjs`, thêm vào `service/scripts/recent_replay.mjs` (mẫu: `stFlipSetup`), docs (nhật ký, sổ tay dòng TradingLab, bot-spec mục mới + bảng luồng quét, CONTEXT "Tin đang gửi"), rồi `npx tsc --noEmit -p .`, `npm run -s test:policy`, `npm run -s lint`, `npm run -s build`, commit, push, xem `railway deployment list` tới SUCCESS.
2. **Chạy lại video cũ ở khung nhỏ**: `service/scripts/lowtf_study.py` (`python -m service.scripts.lowtf_study 15m 5m`) chạy Rayner T.A.E, The Trading Channel hai đáy, Graystone high test, TradingLab trên **15m và 5m** (dữ liệu 5m 21 coin vừa tải: `data/crypto/*-PERP_5m.csv`, từ 2024-11). Chưa có kết quả. Kèo nào lời cả 2 năm → viết code live + replay như trên. Chưa test: SO Trading trên 15m (`service/scripts/sotrading_study.py` đang chạy 1H/4H) — nên làm.
3. Commit cuối cùng đã push: `872f2d9` (Supertrend ngày→1H đúng video ❌). Trước đó `2b9c127` thêm **📈 Supertrend 4H đổi màu** vào bot (code live 2025 +139$ / 2026 +85$).

## Kèo bot đang báo (v3.0.0)

🎯 ICT quét đỉnh hôm qua → SHORT 1H · 🔨 high test 4H (Graystone) · 📈 Supertrend 4H đổi màu (Wysetrade) · 🔁 👤 🚀 🕯 SO Trading 1H. 📌 Limit dưới đáy và 📊 hai đỉnh/đáy 4H **tắt tin** (chỉ ghi paper) vì 14 ngày gần nhất lỗ. Chi tiết luật: bot-spec.md.

## Cách kiểm một kèo (bắt buộc)

Python backtest (21 coin, 2025 và 2026 riêng, phí 0, trượt 0.04%, SL trước TP, không TP trên nến khớp Limit, không nhìn trước) → so với vào ngẫu nhiên (`fee0_shootout.fixed_control`) → viết TS trong `lib/` → `live_replay_study.mjs` chạy code live ra số gần Python → mới báo tin. Lỗi hay gặp: điều kiện "chạy tới TP trước khi khớp" ngược chiều; dùng chung biến `busy` giữa 2 chiều; chọn biến thể sau khi xem số (ghi rõ trong nhật ký).
