# Kế hoạch & tiến độ

Đây là file đọc **đầu tiên**: ai đang giao dịch, đánh thế nào, đã kiểm chứng gì, đang làm gì. Chi tiết theo ngày nằm ở:
- [docs/nhat-ky-giao-dich.md](docs/nhat-ky-giao-dich.md): lệnh thật, kế hoạch trong ngày, chấm điểm.
- [docs/nhat-ky-nghien-cuu.md](docs/nhat-ky-nghien-cuu.md): backtest, dữ liệu, web, triển khai.

Mỗi lần có kết luận mới: sửa phần tương ứng ở file này + thêm một dòng vào nhật ký phù hợp.

## Đọc trước tiên (tóm tắt để không phải nhớ lại cuộc trò chuyện)

**Chủ dự án**: giao dịch hợp đồng vĩnh cửu USDT, chủ yếu SOL (còn xem HYPE, BTC, ETH, LINK…). **Đã chuyển sang MEXC (2026-10-09), giao dịch không phí.** Giá phân tích vẫn lấy từ OKX (lệch MEXC < 0,01%). Lưu ý: Nghị định 284/2026 (hiệu lực 1/9/2026) chưa cấp phép sàn ngoại; mạng nhà chủ dự án đã chặn DNS mọi tên miền MEXC từ 2026-10-07 → dữ liệu trực tiếp lấy từ OKX (giá futures OKX/MEXC lệch < 0,01%). Vốn ~40$, thích đòn bẩy 15–20x, muốn lời 5–10$/lệnh (sau này vốn lớn hơn: cố định ~10$/lệnh). Có gói Claude Pro: **phân tích theo yêu cầu ngay trong chat**, không dùng API trả phí.

**Cách làm việc với Claude trong chat**
- "quét coin" / "phân tích SOL" → chạy `python -m service.scripts.market_brief [COIN]` (giá thật OKX; xu hướng, đỉnh/đáy, setup đã kiểm chứng ở 4h/1h/15m), rồi trả lời: LONG / SHORT / ĐỨNG NGOÀI + vào / dừng lỗ / chốt lời / mức làm hỏng kế hoạch.
- Nhận xét lệnh đang chạy: nêu mức giá làm hỏng lý do vào lệnh; **không liệt kê rủi ro ngắn hạn kiểu "giá có thể hồi"** (lần trước làm chủ dự án thoát sớm một lệnh short đúng hướng).
- Không hứa dự đoán; luôn kèm số liệu kiểm chứng.

**Web**: https://helpvictor.up.railway.app (Railway project `nurturing-presence`, service `web`; deploy `railway up --service web --ci --detach`). Một trang: **Scanner live** 21 coin (WebSocket OKX), chỉ luật 4h, có ô Vốn $, cỡ lệnh rủi ro 2,5%, TP 0,5R/1,5R, thông báo trình duyệt; khối "Luật & kiến thức". **Bot Telegram** chạy trong server (`instrumentation.ts` → `lib/telegram-alerts.ts`), quét 5 phút/lần, chỉ gửi tín hiệu mới hợp lệ (vào, SL, TP 0,5R/1,5R, cỡ lệnh). GitHub `PacificPep26/Trading` (public).

## Kết luận hiện tại: đánh thế nào (LUẬT DUY NHẤT, thống nhất 2026-10-09)

**Chỉ vào lệnh khi có tín hiệu 4h đã kiểm chứng, vừa xác nhận bằng nến 4h đóng cửa: BOS LONG, hoặc hai đỉnh/hai đáy CÙNG xu hướng ngày (BTC và coin so với EMA50 ngày: trên → chỉ hai đáy LONG, dưới → chỉ hai đỉnh SHORT). BOS SHORT = không đánh.** (cập nhật 2026-10-09) Không có tín hiệu 4h = không vào lệnh. Scanner trên web chỉ còn báo đúng hai kiểu này.

- **Vào**: khi nến 4h đóng xác nhận (giờ đóng VN: 3h, 7h, 11h, 15h, 19h, 23h), giá chưa chạy quá 0,5R.
- **SL**: ở cấu trúc 4h (thường cách 4–8%). **Đòn bẩy suy ra từ SL**, không chọn trước: chạm SL không được mất quá số tiền đã định (~3–5$ với vốn 40$; lệnh LINK 8/10 chủ dự án chọn mất tối đa ~28$).
- **Chốt theo chất lượng lệnh** (chủ dự án chọn 2026-10-09, "1R là đẹp rồi"): **lệnh ★ (coin cùng xu hướng ngày với lệnh) → TP 1R; lệnh thường → TP 0,5R**. 21 coin: +0,042R/lệnh, thắng 55% (chốt hết 0,5R: +0,021R; ★ 1,5R + thường 0,5R: +0,061R nếu muốn ăn thêm).
- **Giữ**: nửa ngày – 2 ngày; không đóng tay vì giá đi ngang buổi trưa; phiên tối (sau 20h30) thường chạy mạnh.
- **Coin**: ưu tiên phí 0% trên MEXC (LINK, APT, ARB, ADA, OP, DOT, …). Coin nhỏ đòn bẩy thấp (~5x).
- Kết quả kiểm chứng: BOS 4h +0,03 đến +0,04R/lệnh, thắng ~47% (mỏng, chưa đạt t≥3). Mọi kiểu khung 15m/1h (vùng hồi 1h, Fibonacci, hỗ trợ/kháng cự, VWAP, bắt đáy, đu sóng 20x, lọc khối lượng, chốt ở nền cũ) đều **lỗ** → **không dùng**.
- Thua 2 lệnh liên tiếp: nghỉ hết ngày, không gỡ.
- **Cỡ lệnh** (chủ dự án chọn trước mắt, 2026-10-09): **lời 5$ ở 0,5R** → mọi lệnh chịu mất 10$; lệnh thường chốt 0,5R (+5$), lệnh ★ chốt 1R (+10$); ký quỹ 20$; đòn bẩy = mất ÷ (20 × khoảng SL), tối đa x20. Telegram: ALERT_PROFIT / ALERT_MARGIN trên Railway.

## Đã / chưa backtest

| Kiểu | Khung | Kết quả (R/lệnh sau phí) | Script |
|---|---|---|---|
| SMA 20/50, engulfing, xu hướng + khối lượng | 1h, 4h | lỗ (SOL 4h có năm lãi, không ổn định) | `run_backtest.py` |
| Kiểu đánh target 5–10$, gồng / SL $ cố định, đòn bẩy 15–50x | 15m, 1h | lỗ mọi tổ hợp; đòn bẩy cao lỗ nhanh hơn | `intraday_study.py` |
| BTC dẫn SOL | 15m, 1h | không dẫn trước (tương quan cùng nến 0,72) | `btc_lead_study.py` |
| 4 setup (quét đáy, phá vỡ + KL, hồi xu hướng, nhấn chìm) | 15m, 1h | lỗ; quét đáy kém hơn ngẫu nhiên | `build_playbook.py` |
| Cấu trúc + limit tại Fibonacci 0.382–0.786 | 1h | -0,28 đến -0,45R (tệ hơn ngẫu nhiên) | `structure_study.py` |
| 10 kiểu phân tích đồ thị (Fib+xác nhận, phân kỳ RSI, bật/phá-test hỗ trợ kháng cự, hai đỉnh/đáy, FVG, order block, VWAP, BOS, hồi EMA20) | 1h, 4h | không đạt; tốt nhất BOS & hai đỉnh/đáy 4h | `styles_study.py` (+ `--fee-market 0.0004` cho MEXC) |
| Đu sóng 15–20x (4h+1h cùng xu hướng, hồi EMA20 1h, nến từ chối 15m) | 15m | -0,29$/lệnh, 9/10 coin lỗ | `trend_ride_study.py` |
| **Chưa làm**: mô phỏng tài khoản 40$ theo kiểu 4h; giữ lệnh dài hơn với dừng lỗ kéo theo (Donchian/BOS 4h–1D); tín hiệu funding / open interest / thanh lý; kỹ thuật trích từ video Nukida (32/191 transcript) và sách; dữ liệu 1m để phân xử SL/TP cùng nến | | | |

## Tự rà soát: chỗ còn thiếu / sai sót (2026-10-09)

1. **Không tách LONG/SHORT** trong mọi nghiên cứu trước 9/10 → phát hiện muộn BOS 4h chỉ có lợi thế ở chiều LONG. Mọi kết quả cũ cần xem lại theo chiều.
2. **Thử quá nhiều biến thể, chưa hiệu chỉnh đa giả thuyết** → t≈2 có thể do may. **Đã kiểm tra trên 18 coin mới (2026-10-09): ≈ 0 → lợi thế chưa được xác nhận ngoài 21 coin gốc.** Cần forward test (ghi mọi tín hiệu từ nay) trước khi tăng rủi ro.
3. **Dữ liệu 2023–2026 thiên về thị trường tăng**; 21 coin chọn theo danh sách hiện tại (bỏ sót coin đã chết) → có thể đẹp hơn thực tế.
4. ~~Chưa tính funding/phí OKX~~ → đã tính (rule_study, 2026-10-09). Trượt giá coin nhỏ chưa đo thực tế.
5. **SL/TP cùng nến** giả định SL trước (bảo thủ), chưa có dữ liệu 1m để phân xử.
6. ~~Test đối chiếu Python ↔ scanner~~ → xong, khớp 21 coin (`tests/test_parity.py`).
7. ~~Mô phỏng tài khoản~~ → xong (rủi ro 2,5%: sụt tối đa ~55%, chuỗi thua 13).
8. **Lời khuyên trong chat từng đi trước kiểm chứng** (vùng hồi 1h cho APT/ETH/SOL) → quy tắc: không đề xuất kiểu chưa backtest.
9. **Mục tiêu gốc chưa làm**: trích kỹ thuật từ video Nukida (32/191 transcript) và sách để kiểm chứng.

## Mục tiêu dự án

Phòng thí nghiệm kiểm chứng kỹ thuật trading crypto: nạp kiến thức (video Nukida, sách hết bản quyền), biến kỹ thuật thành luật, backtest có phí và năm kiểm tra riêng, chỉ dùng kỹ thuật vượt kiểm chứng; ghi nhật ký quyết định. "Không kỹ thuật nào thắng sau phí" vẫn là kết quả hợp lệ.

## Quyết định đã chốt

- Crypto perpetual (không còn forex/MT5; code bridge MT5 đã xóa 2026-10-08).
- Dữ liệu lịch sử: Binance Data Vision (`data/crypto/*-PERP_15m.csv`, 21 coin từ 2023). Giá trực tiếp: OKX public API; MEXC public API (`contract.mexc.com`) có phí từng hợp đồng.
- Không huấn luyện model; kho tri thức + backtest. Tiêu chuẩn "đánh được": lãi sau phí 2023–25 với t≥3, 2026 vẫn lãi, ≥60% coin lãi, ≥300 lệnh.
- Mục "Non-negotiable safety constraints" đã bị chủ dự án yêu cầu xóa khỏi CONTEXT.md (2026-10-07). API vị thế không có mật khẩu theo quyết định chủ dự án.

## Trạng thái

| # | Việc | Trạng thái |
|---|---|---|
| 1 | Dữ liệu nến: 21 coin perp 15m (→1h, 4h) 2023-01 → 2026-09 | Xong |
| 2 | Funding rate, open interest, thanh lý lịch sử; dữ liệu 1m | Chưa làm |
| 3 | Transcript kênh Nukida → Postgres | 32/191 (YouTube chặn IP; chạy lại `fetch_transcripts.py --delay 30`) |
| 4 | Bộ khung backtest + 7 script nghiên cứu | Xong (xem bảng trên) |
| 5 | Trích kỹ thuật từ transcript/sách thành luật | Chưa làm (6 sách Gutenberg ở `data/books/`) |
| 6 | Web: phân tích, bảng 4h, nhật ký vị thế | Xong, đang chạy trên Railway |
| 7 | Bot cảnh báo Telegram cho setup 4h | Xong (Telegram Bot @VictorHuynh_trading_bot + Railway API cron `/api/cron/telegram`) |
| 8 | Chuyển nguồn giá web sang MEXC | Chưa làm |
| 9 | Dọn code/README còn nhắc MT5 | Xong (2026-10-08) |

## Kiến thức nền

Overfitting / data snooping (nhiều giả thuyết → hiệu chỉnh), năm kiểm tra riêng, look-ahead bias, expectancy, drawdown; phí + trượt giá; SL/TP cùng nến (giả định dừng lỗ trước); quản lý vốn theo số tiền chấp nhận mất; chế độ thị trường (xu hướng / đi ngang); transcript chỉ dùng cá nhân.

## Đang mở (cập nhật mỗi ngày)

- **2026-10-09**: không có lệnh hợp lệ (BTC ngày TĂNG → chỉ BOS LONG / hai đáy LONG). OP BOS SHORT bị luật loại. Chờ nến 4h đóng; bot Telegram tự báo.
- **Forward test**: từ 2026-10-09 ghi mọi tín hiệu bot gửi vào docs/nhat-ky-giao-dich.md để so với backtest.
