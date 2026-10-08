# Kế hoạch & tiến độ

Đây là file đọc **đầu tiên**: ai đang giao dịch, đánh thế nào, đã kiểm chứng gì, đang làm gì. Chi tiết theo ngày nằm ở:
- [docs/nhat-ky-giao-dich.md](docs/nhat-ky-giao-dich.md): lệnh thật, kế hoạch trong ngày, chấm điểm.
- [docs/nhat-ky-nghien-cuu.md](docs/nhat-ky-nghien-cuu.md): backtest, dữ liệu, web, triển khai.

Mỗi lần có kết luận mới: sửa phần tương ứng ở file này + thêm một dòng vào nhật ký phù hợp.

## Đọc trước tiên (tóm tắt để không phải nhớ lại cuộc trò chuyện)

**Chủ dự án**: giao dịch hợp đồng vĩnh cửu USDT, chủ yếu SOL (còn xem HYPE, BTC, ETH, LINK…). Dùng OKX, có tài khoản MEXC (nhiều coin phí 0%). Lưu ý: Nghị định 284/2026 (hiệu lực 1/9/2026) chưa cấp phép sàn ngoại; mạng nhà chủ dự án đã chặn DNS mọi tên miền MEXC từ 2026-10-07 → dữ liệu trực tiếp lấy từ OKX (giá futures OKX/MEXC lệch < 0,01%). Vốn ~40$, thích đòn bẩy 15–20x, muốn lời 5–10$/lệnh (sau này vốn lớn hơn: cố định ~10$/lệnh). Có gói Claude Pro: **phân tích theo yêu cầu ngay trong chat**, không dùng API trả phí.

**Cách làm việc với Claude trong chat**
- "quét coin" / "phân tích SOL" → chạy `python -m service.scripts.market_brief [COIN]` (giá thật OKX; xu hướng, đỉnh/đáy, setup đã kiểm chứng ở 4h/1h/15m), rồi trả lời: LONG / SHORT / ĐỨNG NGOÀI + vào / dừng lỗ / chốt lời / mức làm hỏng kế hoạch.
- Nhận xét lệnh đang chạy: nêu mức giá làm hỏng lý do vào lệnh; **không liệt kê rủi ro ngắn hạn kiểu "giá có thể hồi"** (lần trước làm chủ dự án thoát sớm một lệnh short đúng hướng).
- Không hứa dự đoán; luôn kèm số liệu kiểm chứng.

**Web**: https://helpvictor.up.railway.app (Railway project `nurturing-presence`, service `web` + `Postgres`; deploy bằng `railway up --service web --ci --detach`). Trang tự tải lại mỗi 60 giây. Có: phân tích nhiều khung, bảng "Coin đáng chú ý · 4h" (BOS / hai đỉnh-hai đáy, giá vào, dừng lỗ, chốt lời, đòn bẩy theo số tiền chấp nhận mất), nhật ký vị thế, nút AI (cần `ANTHROPIC_API_KEY`, hiện **không dùng**). GitHub `PacificPep26/Trading` (public; `data/` không lên git).

## Kết luận hiện tại: đánh thế nào

Đã kiểm chứng trên 21 coin Binance perp, 2023–2026 (2026 dùng làm năm kiểm tra), đã trừ phí, so với vào lệnh ngẫu nhiên. Đơn vị R = số tiền chấp nhận mất mỗi lệnh.

1. **Khung 15m / 1h: không có cách vào lệnh nào có lời**, kể cả phí 0%. Lướt nhanh đòn bẩy cao = thua dần (bộ luật đu sóng 20x: 2686 lệnh, -0,29$/lệnh, SOL cháy 40$ 4 lần).
2. **Khung 4h là nơi duy nhất gần có lãi**: phá cấu trúc (BOS) +0,03R (OKX) / +0,04R (MEXC, 71% coin lãi); hai đỉnh/hai đáy +0,01 / +0,02R (2026 +0,06 đến +0,09R). Lợi thế mỏng, **chưa đạt tiêu chuẩn thống kê** (t≈1,4 < 3).
3. **Phí quyết định rất nhiều** → dùng MEXC, ưu tiên coin taker 0%: XRP, DOGE, LINK, ADA, AVAX, ARB, PEPE, INJ, LTC, DOT, APT, OP, TIA, NEAR. SOL/ETH 0,01%, BTC/HYPE 0,02%. Lệnh limit 0% mọi coin.
4. **Đòn bẩy không tạo lợi thế, chỉ phóng to kết quả.** Ở 4h dừng lỗ cách 4–8% → với 40$ và chấp nhận mất 2$, vị thế ~40$ (~1x), lời ~3$ ở 1,5R. Mục tiêu 10$/lệnh hợp lý khi vốn ~500$ (rủi ro 1,5%/lệnh).

**Cách đánh khuyến nghị (theo số liệu)**: chờ BOS hoặc hai đỉnh/hai đáy khung 4h trên coin phí 0% (xem bảng 4h trên web hoặc hỏi "quét coin") → vào khi nến 4h đóng qua mức → dừng lỗ ở cấu trúc → chốt 1,5–2R → mỗi lệnh chịu mất 1–2$ (tối đa ~5$) → đòn bẩy suy ra từ khoảng cách dừng lỗ → giữ 0,5–2 ngày.
**Nếu chủ dự án vẫn đánh nhanh 15–20x**: dừng lỗ ≤1,2%, mỗi lệnh mất ≤8–10$, chốt nửa ở 1,5R rồi dời dừng lỗ về giá vào, **thua 2 lệnh thì nghỉ hết ngày**, không nạp thêm để gỡ. Số liệu cho thấy kiểu này lỗ dài hạn.

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
| 7 | Bot cảnh báo Telegram cho setup 4h | Chưa làm (cần token BotFather do chủ dự án tạo) |
| 8 | Chuyển nguồn giá web sang MEXC | Chưa làm |
| 9 | Dọn code/README còn nhắc MT5 | Xong (2026-10-08) |

## Kiến thức nền

Overfitting / data snooping (nhiều giả thuyết → hiệu chỉnh), năm kiểm tra riêng, look-ahead bias, expectancy, drawdown; phí + trượt giá; SL/TP cùng nến (giả định dừng lỗ trước); quản lý vốn theo số tiền chấp nhận mất; chế độ thị trường (xu hướng / đi ngang); transcript chỉ dùng cá nhân.

## Đang mở (cập nhật mỗi ngày)

- **SOL (2026-10-08)**: 4h & 1h giảm, đi ngang 115,14–117,17. Kế hoạch A: limit short 117,0, SL 117,4, TP 116,4 / 115,15 (chưa đặt lúc 10h16). Kế hoạch B: nến 1h đóng dưới 115,14 → hủy A, short khi hồi 115,3–115,5, SL 116,0, mục tiêu 112,5–113. Không đuổi giá giữa vùng.
- **LINK BOS 4h short** (từ 2026-10-07, vào 13,373, SL 14,14, TP 12,22): chỉ là tín hiệu, chưa rõ chủ dự án có vào không.
