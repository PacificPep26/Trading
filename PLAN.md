# Kế hoạch & tiến độ

File này là nơi duy nhất ghi **kế hoạch** và **nhật ký tiến độ**. Mỗi lần làm xong việc gì, cập nhật bảng trạng thái và thêm một dòng vào nhật ký (mới nhất ở trên cùng).

## Mục tiêu

Phòng thí nghiệm kiểm chứng kỹ thuật trading trên crypto (BTC, ETH):
1. Nạp kiến thức trading từ kênh YouTube Nukida Trading (https://www.youtube.com/@NukidaTradingOfficial) vào kho tri thức riêng, có trích dẫn.
2. Biến mỗi kỹ thuật thành luật máy đọc được, backtest trên dữ liệu thật.
3. Bot chỉ dùng kỹ thuật vượt ngưỡng kiểm chứng out-of-sample. Mọi quyết định và kết quả được ghi lại.
4. Giao diện hiển thị kỹ thuật, kết quả kiểm chứng và nhật ký quyết định.

Kết quả "không kỹ thuật nào thắng sau khi tính phí" vẫn là kết quả hợp lệ.

## Quyết định đã chốt

- Chuyển từ forex/MT5 sang **crypto**. MT5 đã gỡ khỏi máy, code bridge MT5 trong `service/` chưa dọn.
- Dữ liệu giá: Binance Data Vision (miễn phí, không cần key).
- Không huấn luyện model. Dùng kho tri thức + truy xuất có trích dẫn + backtest.
- LLM chỉ để đọc, trích xuất và giải thích. Quyết định dựa trên luật đã kiểm chứng.
- Làm dữ liệu và phần học trước, giao diện sau.
- Mục "Non-negotiable safety constraints" đã bị chủ dự án yêu cầu xóa khỏi CONTEXT.md (2026-10-07).

## Trạng thái

| # | Việc | Trạng thái |
|---|---|---|
| 1 | Tải dữ liệu nến BTC/ETH 1h (2022-01 → 2026-09) | Xong |
| 2 | Tải thêm khung 1m/15m, funding rate, open interest | Chưa làm |
| 3 | Lấy danh sách video + transcript kênh Nukida, lưu SQLite (nguồn, mốc thời gian) | Đang làm: 32/191 video có transcript, 155 bị YouTube chặn IP, chờ chạy lại |
| 4 | Bộ khung backtest: phí, slippage, spread, walk-forward, baseline | Xong bản đầu (`service/backtest/`). Còn thiếu: dữ liệu 1m để phân xử SL/TP cùng nến, hiệu chỉnh đa giả thuyết |
| 5 | Trích xuất kỹ thuật từ transcript thành dạng có cấu trúc (kèm trích dẫn) | Chưa làm |
| 6 | Chuyển kỹ thuật thành luật code được, chạy qua backtest | Chưa làm |
| 7 | Bảng xếp hạng kỹ thuật + độ tin cậy thống kê | Chưa làm |
| 8 | Nhật ký quyết định + bộ nhớ bài học (SQLite, có phiên bản) | Chưa làm |
| 9 | Giao diện (danh sách video, kỹ thuật, kết quả, nhật ký) | Chưa làm |
| 10 | Dọn code/README còn nhắc MT5 và forex | Chưa làm |

## Kiến thức cần nắm / còn thiếu

- **Thống kê**: overfitting, data snooping (hiệu chỉnh theo số lần thử), walk-forward, look-ahead bias, expectancy, profit factor, max drawdown, Sharpe/Sortino, tối thiểu ~100 lệnh, Monte Carlo.
- **Mô phỏng**: phí maker/taker (~0.1%), slippage, funding rate, thứ tự chạm SL/TP trong cùng một nến (cần dữ liệu 1m).
- **Quản lý vốn**: % rủi ro mỗi lệnh, Kelly một phần, giới hạn drawdown.
- **Định nghĩa kỹ thuật**: nhiều kỹ thuật cảm tính (cung cầu, cấu trúc thị trường) phải định lượng được mới backtest; phần không định lượng chỉ làm ngữ cảnh.
- **Regime thị trường**: xu hướng vs đi ngang, chọn kỹ thuật theo trạng thái.
- **Dữ liệu ngoài giá**: funding rate, open interest, thanh lý, on-chain.
- **Thước đo "AI đã học"**: học thêm kỹ thuật nào thì kết quả out-of-sample tăng bao nhiêu. So với baseline: mua và giữ, ngẫu nhiên, MA đơn giản.
- **Transcript tiếng Việt**: phụ đề tự động hay sai thuật ngữ, có thể cần Whisper.
- **Bản quyền**: transcript chỉ dùng cá nhân để học, không đăng lại.

## Nhật ký tiến độ

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
