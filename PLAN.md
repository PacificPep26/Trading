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

**Web**: https://helpvictor.up.railway.app (Railway project `nurturing-presence`, service `web`; deploy `railway up --service web --ci --detach`). Một trang: **Scanner live** 21 coin (WebSocket OKX), tín hiệu chính 4h, isolated x10, SL cấu trúc và TP hiển thị theo giá/1R. **Bot Telegram** chạy trong server (`instrumentation.ts` → `lib/telegram-alerts.ts`), quét 5 phút/lần; tín hiệu 4h và cảnh báo sớm 1h được ghi nhãn riêng. GitHub `PacificPep26/Trading` (public).

## Kết luận hiện tại: đánh thế nào (HỆ THỐNG CHUẨN HÓA MỚI, 2026-10-09 chiều)

Chủ dự án bỏ hoàn toàn kiểu đánh cũ (bỏ bold mode cược hết margin, bỏ BOS SHORT). Hệ thống được chuẩn hóa dựa trên backtest 0% phí MEXC (2023–2026):

1. **Khung 4H (Đánh theo cấu trúc)**:
   - **BOS LONG**: khi nến 4h đóng vượt đỉnh cấu trúc. (BOS SHORT = KHÔNG ĐÁNH).
   - **Hai đỉnh SHORT / hai đáy LONG**: chỉ khi BTC và coin cùng xu hướng ngày với lệnh; nến 4h phải đóng xuyên neckline.
   - **Báo trước**: Bot Telegram gửi tin báo trước ~5 phút (khi coin cách mức kích hoạt <= 1,2%).
   - **Chốt lời trên UI/bot**: luôn ghi trực tiếp giá coin dưới nhãn **TP gần** và **TP chính**, kèm USD ước tính; không bắt người dùng tự hiểu ký hiệu R. Nội bộ vẫn tính TP gần ở 0,5R và TP chính ở 1R. Có thể chốt nửa tại TP gần rồi dời SL hòa vốn, hoặc giữ tới TP chính.
   - **Thoát sớm**: Đóng lệnh ngay nếu nến 4h sau đóng ngược lại qua mức vừa phá.

2. **Khung 1H: CẢNH BÁO SỚM ĐỂ CANH, KHÔNG PHẢI TÍN HIỆU CHÍNH**:
   - Backtest 2023–2026: hai đỉnh SHORT 1H TP 0,5R đạt 66,7% thắng nhưng expectancy −0,0016R (t=−0,19); TP 1R +0,0126R nhưng t=+1,12. Tỷ lệ thắng cao không đồng nghĩa có lợi thế.
   - Bot vẫn báo khi hai đỉnh SHORT 1H vừa kích hoạt để mở chart canh sóng, nhưng ghi rõ “chưa phải lệnh 4H”, không gắn ★★★ và không tuyên bố có lợi thế chắc chắn.

3. **Quản lý vốn & Kỷ luật sống còn (Unified Policy: `lib/trading-policy.ts`)**:
   - Vốn: ~40$, dùng toàn bộ làm isolated margin **x10** (vị thế khoảng 400$). SL luôn theo cấu trúc: dưới đáy với LONG, trên đỉnh với SHORT. Không giới hạn lỗ cố định 5$; số tiền rủi ro = 400$ × khoảng cách SL (SL 4% ≈ 16$, SL 8% ≈ 32$).
   - Chỉ nhận setup có SL cách 0,4–8%. Với x10, vùng 8% đã gần mức thanh lý lý thuyết nên phải tính thêm maintenance margin/slippage thực tế của sàn trước khi vào.
   - Thua 2 lệnh liên tiếp: nghỉ hết ngày, tuyệt đối không gỡ.
   - Sàn: Ưu tiên MEXC (0% phí giao dịch). Bot lấy giá OKX để quét nến.
   - Dùng chung 1 policy `lib/trading-policy.ts` cho Website, API và Telegram alerts. File `service/telegram-sent.json` chống gửi trùng qua restart trên cùng volume (không thay thế database khi chạy nhiều replica).

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
