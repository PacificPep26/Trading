# Từ điển trading (dùng trong dự án)

## Cấu trúc giá & tín hiệu
- **Nến (candle)**: mỗi cây nến là giá trong một khoảng thời gian (15m = 15 phút, 1h = 1 giờ, 4h = 4 giờ, 1D = 1 ngày). Có giá mở, cao nhất, thấp nhất, đóng cửa. Xanh = đóng cao hơn mở, đỏ = ngược lại. Râu = phần giá chạm tới rồi rút lại.
- **Khung thời gian (timeframe)**: loại nến đang xem. Dự án chỉ vào lệnh theo **khung 4h**, dùng khung ngày để chọn chiều.
- **Đỉnh / đáy (swing high / swing low)**: điểm cao nhất / thấp nhất mà quanh nó (3 nến trước và 3 nến sau) đều thấp hơn / cao hơn.
- **Xu hướng tăng (HH + HL)**: Higher High + Higher Low, đỉnh sau cao hơn đỉnh trước, đáy sau cao hơn đáy trước.
- **Xu hướng giảm (LH + LL)**: Lower High + Lower Low, đỉnh sau thấp hơn, đáy sau thấp hơn.
- **Đi ngang (range / sideway)**: không phải hai loại trên.
- **BOS (Break Of Structure, phá cấu trúc)**: nến **đóng cửa** vượt qua đỉnh gần nhất (trong xu hướng tăng → tín hiệu LONG) hoặc thủng đáy gần nhất (xu hướng giảm → SHORT). Ví dụ "OP: nến 4h đóng < 0,11814" = chờ OP thủng đáy 0,11814.
- **Hai đỉnh / hai đáy (double top / double bottom)**: giá chạm cùng một mức hai lần rồi thủng **đường viền cổ** (neckline: đáy giữa hai đỉnh, hoặc đỉnh giữa hai đáy).
- **Hỗ trợ / kháng cự (support / resistance)**: vùng giá từng đỡ giá (hỗ trợ, "nền") hoặc chặn giá (kháng cự, "cản").
- **Fibonacci (Fib)**: các mức hồi 0,382 / 0,5 / 0,618 / 0,786 của một nhịp giá; nhiều người chờ giá hồi về đó để vào. (Đã kiểm chứng: lỗ.)
- **FVG (Fair Value Gap)**: khoảng trống giá giữa 3 nến liên tiếp. **Order block**: nến ngược chiều ngay trước một cú chạy mạnh. (SMC/ICT: trường phái dùng các khái niệm này; kiểm chứng: không có lợi thế.)
- **Quét thanh khoản / quét SL (liquidity sweep)**: giá đâm nhanh qua đỉnh/đáy để kích hoạt lệnh dừng lỗ rồi quay lại.

## Chỉ báo
- **MA / EMA (đường trung bình)**: giá trung bình N nến; EMA ưu tiên nến gần đây. **EMA20 1h** = trung bình 20 nến 1h; **EMA50 ngày** = trung bình 50 ngày (dùng để chọn chiều: giá trên = xu hướng ngày tăng, dưới = giảm); **EMA200** = xu hướng dài.
- **RSI**: thang 0–100 đo tốc độ tăng/giảm. Dưới 30 = bị bán mạnh (quá bán), trên 70 = bị mua mạnh (quá mua).
- **ATR**: biên độ dao động trung bình của một nến; dùng để biết dừng lỗ xa hay gần.
- **Bollinger (BOLL)**: dải trên/dưới quanh MA20 theo độ biến động.
- **VWAP**: giá trung bình theo khối lượng trong ngày.
- **KL / Volume (khối lượng)**: số coin được mua bán trong nến. "KL gấp 3×" = gấp 3 lần trung bình.
- **Phân kỳ RSI (divergence)**: giá tạo đáy thấp hơn nhưng RSI tạo đáy cao hơn (hoặc ngược lại), báo lực đang yếu đi.

## Lệnh & quản lý vốn
- **Long** = đặt cược giá tăng (Mua). **Short** = đặt cược giá giảm (Bán).
- **Perp / Hợp đồng vĩnh cửu (perpetual futures)**: hợp đồng tương lai không đáo hạn, cho long/short có đòn bẩy. Mã như **SOL-USDT-SWAP**, **SOLUSDT Vĩnh cửu**.
- **Spot**: mua bán coin thật, không đòn bẩy.
- **Đòn bẩy (leverage, 10x, 15x)**: vị thế = ký quỹ × đòn bẩy. 40$ × 10x = vị thế 400$. Giá đi 1% → lời/lỗ 4$.
- **Ký quỹ (margin)**: tiền bạn bỏ ra cho lệnh. **Cô lập (isolated)**: lệnh chỉ mất tối đa ký quỹ của nó. **Chéo (cross)**: dùng chung cả tài khoản.
- **Giá thanh lý (liquidation)**: giá mà sàn tự đóng lệnh, mất gần hết ký quỹ. Dừng lỗ phải nằm **trước** giá thanh lý.
- **SL (Stop Loss, dừng lỗ)**: giá tự đóng lệnh để cắt lỗ. **TP (Take Profit, chốt lời)**: giá tự đóng lệnh để lấy lời. **TP1 / TP2**: chốt lời lần 1 / lần 2.
- **Trailing stop**: dừng lỗ tự dời theo giá khi giá đi đúng hướng (giữ lời).
- **R (đơn vị rủi ro)**: số tiền mất nếu chạm SL. "Chốt 1,5R" = lời gấp 1,5 lần số tiền chịu mất. "+0,04R/lệnh" = trung bình mỗi lệnh lời 4% của mức rủi ro.
- **Lệnh thị trường (market)**: khớp ngay giá hiện tại (phí taker). **Lệnh giới hạn (limit)**: chờ đúng giá (phí maker, thường rẻ hơn).
- **Maker / Taker**: người đặt lệnh chờ / người khớp ngay. MEXC nhiều coin phí 0% ("0 phí").
- **Trượt giá (slippage)**: giá khớp thực tế lệch so với giá thấy.
- **Reduce-only**: lệnh chỉ được giảm vị thế, không mở thêm.
- **PnL**: lời/lỗ. **Funding (lãi suất funding)**: phí trả giữa phe long và short mỗi 8 giờ trên perp; dương = long trả short (phe long đông).
- **OI (Open Interest, hợp đồng mở)**: tổng giá trị lệnh đang mở trên thị trường.
- **Tỷ lệ long/short (tài khoản)**: số tài khoản long chia số tài khoản short.

## Dự án / kiểm chứng
- **Backtest**: chạy luật trên dữ liệu quá khứ để xem có lời không. **Forward test / paper trading**: chạy thử bằng tiền ảo theo thời gian thật.
- **Ngẫu nhiên (baseline)**: vào lệnh bừa với cùng SL/TP, để so: một kiểu chỉ có giá trị nếu tốt hơn ngẫu nhiên.
- **t (t-stat)**: độ tin cậy thống kê. t ≥ 3 mới coi là chắc; t ≈ 1–2 là "có thể, chưa chắc".
- **Tỷ lệ thắng (win rate)**: % lệnh có lời. Không đủ để biết có lời: còn phụ thuộc lời/lỗ mỗi lệnh.
- **Overfit**: luật trông đẹp trên quá khứ do may mắn, không lặp lại được.
- **Phiên Á / Âu / Mỹ**: Á ≈ sáng–trưa VN (ít biến động), Âu ≈ 14–15h VN, Mỹ ≈ 20h30 VN (thường chạy mạnh).

## Tên coin (mã)
BTC Bitcoin · ETH Ethereum · SOL Solana · HYPE Hyperliquid · XRP · DOGE Dogecoin · BNB · ADA Cardano · AVAX Avalanche · LINK Chainlink · DOT Polkadot · LTC Litecoin · SUI · ARB Arbitrum · **OP Optimism** · NEAR · APT Aptos · INJ Injective · TIA Celestia · PEPE · WIF. **USDT**: đồng đô-la số dùng làm tiền định giá.

## Thị trường & tin tức
- **ETF**: quỹ niêm yết trên sàn chứng khoán (Mỹ) nắm giữ coin thật; "dòng tiền ETF" = tiền vào/ra các quỹ này (vào nhiều thường đẩy giá lên).
- **FOMC / CPI / NFP**: họp lãi suất Fed / lạm phát Mỹ / việc làm Mỹ, các tin hay làm giá chạy mạnh.
- **Mở khóa token (unlock)**: lượng coin mới được phép bán ra, hay gây áp lực giảm.
- **P2P**: mua bán coin trực tiếp giữa hai người qua sàn trung gian.
