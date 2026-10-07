# Kế hoạch & tiến độ

File này là nơi duy nhất ghi **kế hoạch** và **nhật ký tiến độ**. Mỗi lần làm xong việc gì, cập nhật bảng trạng thái và thêm một dòng vào nhật ký (mới nhất ở trên cùng).

## Đọc trước tiên (tóm tắt để không phải nhớ lại cuộc trò chuyện)

**Chủ dự án**: giao dịch hợp đồng vĩnh cửu USDT, chủ yếu SOL (còn xem HYPE, BTC, ETH, LINK…). Đang dùng OKX, **định chuyển sang MEXC** (nhiều coin phí 0%). Vốn ~40$, thích đòn bẩy 15–20x, muốn lời 5–10$/lệnh (sau này vốn lớn hơn: cố định ~10$/lệnh). Có gói Claude Pro: **phân tích theo yêu cầu ngay trong chat**, không dùng API trả phí.

**Cách làm việc với Claude trong chat**
- "quét coin" / "phân tích SOL" → chạy `python -m service.scripts.market_brief [COIN]` (giá thật OKX; xu hướng, đỉnh/đáy, setup đã kiểm chứng ở 4h/1h/15m), rồi trả lời: LONG / SHORT / ĐỨNG NGOÀI + vào / dừng lỗ / chốt lời / mức làm hỏng kế hoạch.
- Nhận xét lệnh đang chạy: nêu mức giá làm hỏng lý do vào lệnh; **không liệt kê rủi ro ngắn hạn kiểu "giá có thể hồi"** (lần trước làm chủ dự án thoát sớm một lệnh short đúng hướng).
- Không hứa dự đoán; luôn kèm số liệu kiểm chứng.

**Web**: https://helpvictor.up.railway.app (Railway project `nurturing-presence`, service `web` + `Postgres`; deploy bằng `railway up --service web --ci --detach`). Có: phân tích nhiều khung, bảng "Coin đáng chú ý · 4h" (BOS / hai đỉnh-hai đáy, giá vào, dừng lỗ, chốt lời, đòn bẩy theo số tiền chấp nhận mất), nhật ký vị thế, nút AI (cần `ANTHROPIC_API_KEY`, hiện **không dùng**). GitHub `PacificPep26/Trading` (public; `data/` không lên git).

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

- Crypto perpetual (không còn forex/MT5; code bridge MT5 trong `service/app/` chưa dọn).
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
| 9 | Dọn code/README còn nhắc MT5 | Chưa làm |

## Kiến thức nền

Overfitting / data snooping (nhiều giả thuyết → hiệu chỉnh), năm kiểm tra riêng, look-ahead bias, expectancy, drawdown; phí + trượt giá; SL/TP cùng nến (giả định dừng lỗ trước); quản lý vốn theo số tiền chấp nhận mất; chế độ thị trường (xu hướng / đi ngang); transcript chỉ dùng cá nhân.

## Nhật ký tiến độ

- **2026-10-07 đêm**: Chủ dự án muốn đánh đòn bẩy cao 15–20x, đu sóng theo xu hướng (SOL, HYPE…). Backtest đúng bộ luật đã đưa trong chat (`service/scripts/trend_ride_study.py`): 4h & 1h cùng xu hướng, hồi chạm EMA20 1h, nến từ chối 15m, dừng lỗ sau cực trị 6 nến 15m (≤1,2%), 20x trên 40$ (800$), chốt nửa ở 1,5R + kéo dừng lỗ theo swing 15m, nghỉ ngày sau 2 lệnh thua, phí MEXC + trượt 0,02%/chiều, 10 coin 2023–2026: **2686 lệnh, thắng 39%, TB -0,29$/lệnh; 9/10 coin lỗ** (SOL -169$ / 282 lệnh, cháy 40$ 4 lần; HYPE -54$; chỉ XRP +19$). Lỗ TB khi thua -4,4$; chỉ 10% lệnh lời ≥7$.

- **2026-10-07 đêm**: Chủ dự án có gói Claude Pro → phân tích theo yêu cầu ngay trong chat (`python -m service.scripts.market_brief [COIN]`), không cần `ANTHROPIC_API_KEY`. Thêm bảng "Coin đáng chú ý · 4h" trên web (`/api/watchlist`, `lib/patterns.ts`): quét 21 coin OKX tìm BOS / hai đỉnh-hai đáy, có giá vào (hoặc mức chờ), dừng lỗ, chốt 1.5R/2R, và tính đòn bẩy theo số tiền chấp nhận mất. Dừng lỗ khung 4h thường cách 4–8% → không dùng được 15x. **MEXC** (chủ dự án định chuyển): API công khai `contract.mexc.com/api/v1/contract/detail` trả phí từng hợp đồng: maker 0% cho 984/1074 hợp đồng; **taker 0% cho 547**, gồm XRP, DOGE, LINK, ADA, AVAX, ARB, PEPE, INJ, LTC, DOT, APT, OP, TIA, NEAR (14/21 coin đã kiểm chứng); SOL/ETH taker 0.01%, BTC/HYPE/SUI/BNB 0.02%. Chạy lại 10 kiểu với phí 0.04% (chỉ spread/trượt giá), kết quả `lib/styles-stats-zerofee.json`: vẫn không kiểu nào đạt tiêu chuẩn; tốt nhất **BOS 4h +0.038 đến +0.042R (71% coin lãi, t≈1.4)**, **hai đỉnh/hai đáy 4h +0.02R (2026 +0.06 đến +0.09R)**; 1h vẫn âm (ngẫu nhiên -0.074R).

- **2026-10-07 tối**: **Kiểm chứng toàn bộ 10 kiểu phân tích biểu đồ** (`service/backtest/patterns.py`, `service/scripts/styles_study.py`, kết quả `lib/styles-stats.json`) trên 21 coin, khung 1h và 4h, chốt 1.5R/2R/mục tiêu cấu trúc, phí 0.1% (market) / 0.07% (limit), tiêu chuẩn đặt trước: lãi sau phí 2023–25 với t≥3, 2026 vẫn lãi, ≥60% coin lãi. **Không kiểu nào đạt.** 1h: tất cả lỗ (ngẫu nhiên -0.136R; tốt nhất hai đỉnh/hai đáy -0.04R, FVG -0.06R, BOS -0.07R; tệ nhất VWAP -0.25 đến -0.31R, bật hỗ trợ/kháng cự -0.17R, hồi EMA20 -0.14R, Fibonacci+xác nhận -0.11R). 4h tốt hơn hẳn (ngẫu nhiên -0.051R): **BOS 4h +0.025 đến +0.029R (67% coin lãi, t≈1, 2026 ≈0)**, **hai đỉnh/hai đáy 4h +0.007R (2026 +0.045 đến +0.08R)**, phân kỳ RSI 4h -0.01 đến -0.03R (2026 +0.03 đến +0.05R). Order block quá ít mẫu. Kết luận: chưa có lợi thế chắc chắn; nếu đánh thì ưu tiên BOS / hai đỉnh-hai đáy khung 4h. Thêm **AI phân tích** (`app/api/ai-analysis`, `app/ai-card.tsx`): Claude Opus 5.5 đọc nến 15m/1h/4h + BTC + funding + bảng kiểm chứng, trả kết luận LONG/SHORT/ĐỨNG NGOÀI kèm vào/dừng lỗ/chốt lời/điều kiện hỏng, structured output, fallbacks mặc định, cache 3 phút mỗi coin (trang công khai). Cần biến `ANTHROPIC_API_KEY` trên Railway.

- **2026-10-07 tối**: Kiểm chứng kiểu "vào giá đẹp theo cấu trúc + Fibonacci" (`service/backtest/structure.py`, `service/scripts/structure_study.py`, kết quả `lib/structure-stats.json`): xu hướng 1h từ đỉnh/đáy (swing W=3), đặt limit ở mức hồi Fibonacci của nhịp gần nhất (0.382/0.5/0.618/0.786), dừng lỗ trên đỉnh/dưới đáy swing + 0.1 ATR, chốt lời 1.8R hoặc đáy/đỉnh cấu trúc, giữ tối đa 24 nến 1h, 21 coin 2023–2026. **Kết quả: mọi mức Fibonacci đều lỗ khoảng -0.28 đến -0.45R/lệnh, tệ hơn vào lệnh ngẫu nhiên (-0.10R)**, 0% coin có lãi, 2026 giống hệt. Tốt nhất là 0.5–0.618 (khoảng -0.28R với short). 17% lệnh limit khớp xong chạm dừng lỗ ngay trong cùng nến: lệnh chờ ở vùng hồi thường chỉ khớp khi nhịp hồi đủ mạnh để đảo chiều (adverse selection). Sửa lỗi dấu chốt lời trong script trước khi chạy. Ý tưởng tiếp: vào lệnh khi có xác nhận tại vùng Fibonacci (nến từ chối, phân kỳ RSI) thay vì limit mù.

- **2026-10-07**: Nâng dashboard thành bộ phân tích Long/Short đa khung tự cập nhật 60 giây: 15m/1h/4h, OI history, long/short ratio, funding, BTC, scanner và đánh giá vị thế nhập tay. Thêm thống kê xác suất TP trước SL có khoảng tin cậy từ 21 coin, cảnh báo entry đuổi theo nến sâu, tin tức chỉ làm cảnh báo, và lưu vị thế tùy chọn trong Postgres qua `/api/positions` (không xác thực theo quyết định của chủ dự án).

- **2026-10-07 ~16:30**: Chủ dự án **đóng lệnh SOL long thủ công** trước khi chạm TP/SL, vì lý do vào lệnh yếu đi (SOL tạo đỉnh thấp dần từ 13h, BTC thử đáy 83.800). Giá đóng khoảng 118,05–118,10 → ước tính **-1,3 đến -1,5$ trước phí, khoảng -1,6 đến -1,8$ sau phí** (chờ số chính xác từ OKX). So với chạm dừng lỗ (-7,45$) là tiết kiệm khoảng 5,6$. Bot theo playbook sẽ không vào lệnh này (không setup nào xuất hiện; kiểu quét đáy rồi bắt đáy kém hơn ngẫu nhiên trên 21 coin).
- **2026-10-07**: Chủ dự án không cần dashboard cập nhật liên tục; cần **hướng dẫn vào lệnh dựa trên biểu đồ thật**. Làm: 4 setup (`service/backtest/setups.py`, bản TS giống hệt ở `lib/setups.ts`): quét đáy/đỉnh rồi rút lại (kiểu của chủ dự án), phá vỡ kèm khối lượng, hồi trong xu hướng, nhấn chìm tại vùng cực. `service/scripts/build_playbook.py` đo trên 21 coin Binance perp (tải 15m từ 2023, gộp ra 1h), dừng lỗ theo setup, chốt lời 1/1.5/2R, đóng trước 0h VN, train 2023–2025, test 2026, so với ngẫu nhiên → `lib/playbook.json`. Web: bỏ tự cập nhật, thêm nút "Phân tích" + khung Hướng dẫn (setup nào đang xuất hiện, giá vào/dừng lỗ/chốt lời, thống kê, kết luận có lợi thế hay đứng ngoài). **Kết quả: không setup nào có lợi thế ổn định sau phí.** 15m: tất cả -0.13 đến -0.20R/lệnh (taker), không hơn ngẫu nhiên. 1h: tốt nhất là phá vỡ kèm khối lượng, gần hòa (taker -0.01 đến -0.02R, maker +0.01 đến +0.02R, chỉ 38–43% coin có lãi). Quét đáy rồi rút lại: 1h -0.12 đến -0.15R, **kém hơn cả ngẫu nhiên**. Tải thêm 6 sách hết bản quyền từ Project Gutenberg vào `data/books/` (chưa nạp vào Postgres).

- **2026-10-07**: Triển khai. GitHub: `PacificPep26/Trading` (**public**; `data/` và `.env` bị gitignore, transcript không lên GitHub). Railway project `nurturing-presence`: service `web` (Next.js, dashboard OKX trực tiếp: nến 15m/1h/4h, funding, OI, BTC 1h, cảnh báo, máy tính lệnh) tại https://helpvictor.up.railway.app; service `Postgres` chứa kho kiến thức (191 video, 32 có transcript, 13.482 đoạn) nạp bằng `service/scripts/sync_knowledge.py`. `web` có biến `DATABASE_URL` trỏ tới Postgres qua mạng nội bộ. Postgres đang bật TCP proxy công khai (có mật khẩu) để nạp dữ liệu từ máy; có thể tắt trong Settings → Networking khi không cần. Deploy hiện bằng `railway up --service web` (Railway chưa có quyền đọc repo GitHub nên chưa tự deploy khi push).

- **2026-10-07**: Lệnh thật đầu tiên của chủ dự án (để ghi nhật ký khi đóng): long SOLUSDT perp OKX, 4.77 SOL @118.36, 15x cô lập, ký quỹ 37.66$, TP 120.00 (+7.82$), SL 116.80 (-7.45$, đặt lúc ~15:46 VN). Lý do vào: mua sau cú quét 8–9h sáng xuống 116.88, khối lượng gấp 6–9 lần bình thường.
- **2026-10-07**: `service/scripts/btc_lead_study.py`: BTC vs SOL perp 2023–2026. Tương quan cùng nến 0.72, beta 1.37 (BTC +1% → SOL ~+1.37%). **BTC không đi trước SOL**: tương quan lệch 1 nến ≈ 0 (15m và 1h), hai đồng chạy gần như cùng lúc. Có hiệu ứng hồi nhẹ: sau nến 1h BTC giảm ≥1%, SOL trung bình +0.12% nến sau, +0.26% sau 4 nến (nhỏ hơn hoặc ngang phí). Vào lệnh SOL theo BTC (target/SL 10$): taker đều lỗ như ngẫu nhiên; maker tốt nhất +0.06$/lệnh (BTC ±0.5% 15m, SOL tụt lại, 799 lệnh), không khác ngẫu nhiên đáng kể. Hôm nay: cú giảm 8–9h là BTC giảm (-1.37%, -0.61%), SOL giảm đúng theo, không phải SOL tự giảm.
- **2026-10-07**: Mục tiêu chủ dự án: lời 7–10$/lệnh, đòn bẩy cao "cho nhanh", tùy coin. `intraday_study.py` đổi target sang 7$/10$. SOL 15m, vào ngẫu nhiên, phí taker: đòn bẩy 15x lỗ TB -0.4 đến -0.8$/lệnh; 30x -1.1 đến -1.6$; 50x -2.0 đến -2.6$. Lý do: target/SL tính bằng $ cố định nhưng phí tính theo notional, nên đòn bẩy gấp đôi thì phí gấp đôi trong khi target giữ nguyên. Đòn bẩy cao chỉ làm lệnh đóng nhanh hơn, không làm phép tính tốt hơn.
- **2026-10-07**: Thêm `service/scripts/intraday_study.py`: mô phỏng kiểu đánh của chủ dự án (40$ × 15x ≈ 600$ notional, target 5$/10$, SL không/3/5/10/20$, đóng trước 0h giờ VN), so vào lệnh ngẫu nhiên với 3 chiến lược, SOLUSDT-PERP 2023–2026. Phí taker 0.1% khứ hồi: **cả 40 tổ hợp đều lỗ** ở cả 15m và 1h, khoảng -0.3 đến -1$/lệnh, chiến lược không hơn ngẫu nhiên. Phí maker 0.04%: gần hòa vốn (-0.27 đến +0.08$/lệnh); tốt nhất là target 10$/SL 10$ hoặc 5$, vẫn chỉ ngang ngẫu nhiên. Giả định lệnh limit luôn khớp nên kết quả maker là lạc quan. Kết luận: lỗ chủ yếu là phí; cách chọn target/SL không tạo lợi thế, cần điểm vào tốt hơn ngẫu nhiên.
- **2026-10-07**: Đo kiểu "gồng" của chủ dự án trên SOLUSDT-PERP 15m (2023–2026), 20.000 lệnh vào ngẫu nhiên, target +0.89% (~5$ trên 565$ notional), phí khứ hồi 0.1%: không SL thì 85.6% chạm target trước, 14.4% bị thanh lý (-6.2%, ~37$) → trung bình khoảng -1.05$/lệnh. Trong các lệnh thắng, 61% từng âm >0.5% và 41% từng âm >1% trước khi về target. Có SL 2.5$/5$/10$: thắng 26%/43%/63%, trung bình -0.59/-0.71/-0.63$ mỗi lệnh. Kết luận: "quét rồi vô lại" là bình thường, nhưng vào lệnh ngẫu nhiên thì không cách đặt SL nào thắng phí; cần điểm vào có lợi thế thật.
- **2026-10-07**: Theo yêu cầu chủ dự án, **đã mở holdout 2026** cho `trend_volume` trên SOLUSDT-PERP (phí 0.05% + slip 0.02%): 15m lỗ 82% (1265 lệnh, thắng 35%), 1h lỗ 5% (330 lệnh, thắng 39%), không khác ngẫu nhiên. Holdout 2026 không còn "sạch" cho chiến lược này; chiến lược mới vẫn dùng được nhưng phải ghi rõ đã xem 2026.
- **2026-10-07**: Chủ dự án thực tế giao dịch **SOL perpetual trên OKX** (không phải sàn 0 phí: taker ~0.05%/chiều + funding), đòn bẩy 15x isolated, vốn ~40 USDT, target 5–10 USD/lệnh, khung 15m–1h. Tải SOLUSDT futures 15m và 1h (từ 2023, file `SOLUSDT-PERP_*.csv`). `trend_volume` với phí 0.05% + slippage 0.02%: 15m lỗ 80–95% mỗi năm (2023–2025), 1h quanh hòa vốn/lỗ nhẹ. Tính toán: 15x trên 40 USD là ~565 USD notional; target 5–10 USD = giá chạy 0.9–1.8%; phí khứ hồi ~0.57 USD; thanh lý ở -6.2% mất ~37 USD → không đặt SL thì cần thắng ~80–88% số lệnh mới hòa vốn.
- **2026-10-07**: Chủ dự án: giao dịch long/short altcoin (SOL, HYPE...) trên sàn **không phí**; cách tiếp cận là xu hướng + khối lượng + khung nến. Thêm chiến lược `trend_volume` (giá trên/dưới SMA200 + nến cùng màu có khối lượng > 1.5x trung bình 20 nến), cờ `--interval/--fee/--slippage` cho backtest, cờ `--market futures` cho script tải (HYPE spot mới niêm yết, dùng futures từ 2025-05-30). Tải thêm khung 4h, 1d cho BTC/ETH; 1h, 4h cho SOL, HYPE. Kết quả (phí 0, slippage 0.05%/chiều): 1h không khác ngẫu nhiên trên SOL và HYPE; SOL 4h lãi 3/4 năm, riêng 2025 nổi bật (p≈0, t=2.4) nhưng 2022 và 2024 lỗ; HYPE 4h quanh hòa vốn (44 lệnh, quá ít để kết luận). Chưa hiệu chỉnh cho số lần thử.
- **2026-10-07**: Agent xác minh nguồn sửa `docs/research/candlestick-trading.md`. Đính chính hai kết luận cũ: (1) Caginalp & Laurent 1998 **đã được lặp lại một phần** (Lu, Chen & Hsu 2015, DJIA 1992–2012, sau phí 0.5% và kiểm định Step-SPA); (2) yếu tố quyết định là **cách giữ lệnh / thoát lệnh**, không phải định nghĩa xu hướng. Bằng chứng intraday nghiêng về âm (Duvinage và cộng sự 2013, nến 5 phút). Vẫn chưa có nghiên cứu chặt chẽ nào về mẫu nến crypto ở khung 1h trở xuống. Hệ quả cho backtest: thử mỗi mẫu với cả hai cách thoát (kiểu Caginalp–Laurent và giữ cố định kiểu Marshall), tính cả hai vào số giả thuyết.
- **2026-10-07**: Bộ khung backtest `service/backtest/` (chạy: `python -m service.scripts.run_backtest <chiến lược>`). Luật: chiến lược chỉ thấy nến đã đóng, vào lệnh ở giá mở nến sau, SL/TP theo ATR, SL thắng khi cùng nến chạm cả hai, phí 0.1%/chiều + slippage 0.02%/chiều, chia fold theo năm 2022–2025, so với vào lệnh ngẫu nhiên (p-value) và mua-giữ. Dữ liệu 2026 bị khóa (holdout), chỉ mở bằng `--holdout`. 7 test ở `tests/test_backtest.py` đều qua. Chạy thử 2 chiến lược mẫu (SMA 20/50, engulfing có lọc xu hướng): đều lỗ mọi năm trên cả BTC và ETH, không khác vào lệnh ngẫu nhiên (p-value 0.16–0.99). Chi phí khoảng 0.24%/lệnh, nên lệnh ngẫu nhiên trung bình lỗ khoảng 0.25%.
- **2026-10-07**: Agent nghiên cứu viết xong `docs/research/candlestick-trading.md` (mẫu nến, định nghĩa định lượng, bằng chứng học thuật, cạm bẫy, đề xuất kiểm chứng). Kết luận chính: bằng chứng học thuật phần lớn âm, crypto 1h gần như chưa có nghiên cứu chặt chẽ, SMC/order block không có nguồn học thuật. 3 trích dẫn đánh dấu [cần xác minh]; ngưỡng định lượng là đề xuất, không phải từ nguồn gốc. Quyết định đề xuất: giữ 2026-01 → 2026-09 làm holdout chỉ chạy một lần.
- **2026-10-07**: Viết `service/scripts/fetch_transcripts.py` (yt-dlp lấy danh sách, youtube-transcript-api lấy phụ đề, lưu `data/knowledge.db`: bảng `videos` và `segments`). Kênh có 191 video (tab videos; không có streams/shorts). Lấy được 32 transcript (đều là phụ đề tự động tiếng Việt, chất lượng đọc tốt), 4 video không có phụ đề, 155 video lỗi `IpBlocked` (YouTube giới hạn tần suất; yt-dlp cũng bị 429). Script chạy lại được, tự bỏ qua video đã xong: chạy lại sau vài giờ với `--delay 30`.
- **2026-10-07**: Tải xong BTCUSDT và ETHUSDT 1h (41.615 nến mỗi cặp, 2022-01 → 2026-09) bằng `service/scripts/download_klines.py`. Dữ liệu ở `data/crypto/`, nguồn ghi trong `manifest.json`. Đã sửa lỗi đơn vị thời gian (file mới của Binance dùng micro giây, script chuẩn hóa về mili giây).
- **2026-10-07**: Chốt hướng: crypto, kho tri thức có trích dẫn + backtest, không huấn luyện model. Viết file này.
