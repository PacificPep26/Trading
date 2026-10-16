# Nghiên cứu: Giao dịch theo mẫu nến và price action

> Phạm vi: định nghĩa định lượng, bằng chứng thực nghiệm, cạm bẫy khi backtest và đề xuất kiểm chứng cho dự án (BTCUSDT, ETHUSDT, nến 1h, 2022-01 → 2026-09).
> Ngày lập: 2026-10-07. Đã rà soát trích dẫn cùng ngày (xem mục 6 "Nhật ký xác minh"). Mỗi dòng trong bảng 2.1 ghi rõ nguồn của con số: **[toàn văn]**, **[abstract]** hoặc **[không xác minh được]**.

---

## 0. Ký hiệu chung

Với nến thứ t: `O, H, L, C`.

- `body = |C − O|`, `range = H − L` (bỏ nến có range = 0)
- `upper = H − max(O,C)`, `lower = min(O,C) − L`
- `bull = C > O`, `bear = C < O`
- `ATR_n`: Average True Range n kỳ (Wilder), **chỉ tính đến nến t−1** nếu dùng để lọc tín hiệu tại t.
- Xu hướng trước đó (dùng cho mọi mẫu đảo chiều). Chọn một định nghĩa và giữ cố định:
  - (a) `C[t−k] > SMA_n[t−k]` và độ dốc `SMA_n > 0`; hoặc
  - (b) lợi suất k nến trước `C[t−1]/C[t−1−k] − 1` lớn hơn hoặc nhỏ hơn 0 (Caginalp & Laurent 1998 và Marshall và cộng sự 2006 dùng các định nghĩa xu hướng kiểu này; xem mục 2).
  - Tham số gợi ý: n = 10–20, k = 5–10 nến.
- Tín hiệu chỉ được xác nhận **sau khi nến cuối của mẫu đã đóng**. Lệnh vào tại **open của nến kế tiếp**.

Mọi ngưỡng dưới đây (0.3, 2.0, 0.1...) là **tham số**, không phải chân lý. Các sách (Nison 1991; Bulkowski 2008) mô tả bằng lời. Con số cụ thể là lựa chọn của người viết code và phải đăng ký trước (pre-register) khi backtest.

---

## 1. Danh mục mẫu hình và định nghĩa định lượng

### 1.1 Mẫu một nến

| Mẫu | Định nghĩa định lượng (gợi ý) | Tham số | Ngữ cảnh |
|---|---|---|---|
| **Doji** | `body ≤ d·range`, với d = 0.05–0.1 | d | Không có hướng tự thân. Nison coi doji sau xu hướng dài là cảnh báo |
| **Hammer** | `lower ≥ m·body`, `upper ≤ u·range`, `body ≤ b·range`, thân nằm ở 1/3 trên của range | m = 2, u = 0.1, b = 0.3 | Chỉ tính khi có downtrend trước đó. Nếu xuất hiện trong uptrend thì gọi là hanging man |
| **Shooting star** | Đối xứng với hammer: `upper ≥ m·body`, `lower ≤ u·range` | như trên | Có uptrend trước đó. Nếu trong downtrend thì gọi là inverted hammer |
| **Pin bar** (thuật ngữ price action) | Râu dài ≥ p·range (p = 0.6–0.67), mũi râu vượt cực trị của N nến trước (ví dụ `L < min(L[t−N..t−1])`) | p, N | Thường đòi hỏi nằm tại vùng hỗ trợ/kháng cự. Không có định nghĩa học thuật chuẩn |
| **Marubozu** | `body ≥ 0.9·range` | ngưỡng | Biểu thị tiếp diễn |

### 1.2 Mẫu hai nến

| Mẫu | Định nghĩa | Ghi chú |
|---|---|---|
| **Bullish engulfing** | `bear[t−1]`, `bull[t]`, `O[t] ≤ C[t−1]`, `C[t] ≥ O[t−1]`, `body[t] > body[t−1]` | Crypto 24/7 gần như không có gap giữa các nến, nên `O[t] ≈ C[t−1]`. Điều kiện "mở dưới close trước" vì thế gần như luôn đúng (xem 3.6). Có thể thêm điều kiện `body[t] ≥ k·ATR` |
| **Bearish engulfing** | Đối xứng | Cần uptrend trước đó |
| **Harami (bull)** | `bear[t−1]` có thân lớn (≥ 0.6·range hoặc ≥ ATR), thân t nằm trong thân t−1: `max(O,C)[t] ≤ O[t−1]` và `min(O,C)[t] ≥ C[t−1]` | Harami cross: nến t là doji |
| **Inside bar** | `H[t] ≤ H[t−1]` và `L[t] ≥ L[t−1]` | Thường giao dịch theo hướng phá vỡ: buy-stop trên `H[t−1]`, sell-stop dưới `L[t−1]` |
| **Piercing / Dark cloud cover** | Piercing: `bear[t−1]`, `bull[t]`, `C[t] > (O[t−1]+C[t−1])/2`, `C[t] < O[t−1]` | Bản gốc đòi hỏi gap. Trên crypto cần nới điều kiện này |

### 1.3 Mẫu ba nến

| Mẫu | Định nghĩa |
|---|---|
| **Morning star** | Nến 1 giảm thân lớn (≥ ATR hoặc ≥ 0.6·range). Nến 2 thân nhỏ (≤ 0.3·body1) và `max(O2,C2) ≤ C1` (thân 2 nằm dưới thân 1; với crypto nới thành "thân 2 ở nửa dưới thân 1"). Nến 3 tăng, `C3 > (O1+C1)/2` |
| **Evening star** | Đối xứng với morning star |
| **Three white soldiers** | 3 nến tăng liên tiếp. Mỗi nến `C` > `C` trước. Mỗi nến `O` nằm trong thân nến trước. `upper ≤ 0.2·range` |
| **Three black crows** | Đối xứng với three white soldiers |

### 1.4 Khái niệm price action

| Khái niệm | Định nghĩa định lượng không mơ hồ |
|---|---|
| **Swing high/low (fractal)** | `H[i]` là swing high nếu `H[i] > max(H[i−n..i−1])` và `H[i] > max(H[i+1..i+n])`. **Chỉ được biết tại nến i+n** (đây là nguồn look-ahead phổ biến nhất). n = 2–5. Phương án khác: ZigZag theo ngưỡng % hoặc k·ATR. ZigZag cũng chỉ được xác nhận trễ |
| **Cấu trúc HH/HL/LH/LL** | So sánh hai swing high đã xác nhận gần nhất và hai swing low đã xác nhận gần nhất. Uptrend = HH và HL. Downtrend = LH và LL. Các trường hợp còn lại là range |
| **Break of structure (BOS)** | Trong uptrend: `C[t] > swing high gần nhất đã xác nhận` (dùng close, không dùng wick). CHoCH (change of character): trong uptrend, `C[t] <` swing low gần nhất |
| **Hỗ trợ/kháng cự** | Vùng = cụm các swing đã xác nhận nằm trong ±k·ATR (k = 0.25–0.5), cần ≥ m lần chạm (m = 2–3) trong cửa sổ W nến. Phương án khác: mức tròn, high/low ngày hoặc tuần trước |
| **Cung/cầu (supply/demand zone)** | "Base" gồm 1–3 nến thân nhỏ (≤ 0.5·range), sau đó là một cú bứt "impulse" (≥ 2·ATR trong ≤ 3 nến). Vùng là [low, high] của base. Vùng hết hiệu lực sau lần chạm đầu tiên hoặc sau T nến |
| **Order block (ICT/SMC)** | Bullish OB = nến giảm cuối cùng trước một nhịp tăng tạo BOS. Vùng = [L, O] hoặc [L, H] của nến đó. Thuật ngữ này đến từ cộng đồng (ICT). **Chưa tìm thấy định nghĩa học thuật hay kiểm chứng có phương pháp** |
| **Liquidity sweep / stop hunt** | `L[t] < swing low đã xác nhận − ε` và `C[t] > swing low` (râu quét qua rồi đóng cửa ngược lại). Trên thực tế đây là một pin bar tại swing low. ε = 0–0.1·ATR |

---

## 2. Bằng chứng thực nghiệm

### 2.1 Các nghiên cứu chính

| Nghiên cứu | Thị trường / giai đoạn / khung | Phí | Kết quả | Hạn chế / mức tin cậy |
|---|---|---|---|---|
| **Caginalp & Laurent (1998)**, "The predictive power of price patterns", *Applied Mathematical Finance* 5(3-4):181–205. [IDEAS](https://ideas.repec.org/a/taf/apmtfi/v5y1998i3-4p181-205.html) | Toàn bộ cổ phiếu S&P 500, 1992–1996, nến ngày, mẫu đảo chiều ba nến, bỏ điều kiện về độ lớn **[abstract]** | Abstract không nói về phí. Theo Lu, Chen & Hsu (2015, toàn văn), C&L nhận định chi phí lớn nhất là spread 0.1–0.3% **[gián tiếp]** | Ngoài mẫu có ý nghĩa ở mức "36 độ lệch chuẩn", lợi nhuận gần 1% cho kỳ giữ 2 ngày **[abstract]**. Cách giữ lệnh CL: mua đầu t+4, bán 1/3 vào cuối t+4, t+5, t+6 **[theo mô tả trong Lu et al. 2015]** | Giai đoạn ngắn, một thị trường bò. **Đã sửa:** bản trước ghi "các nghiên cứu sau không lặp lại được". Thực tế Lu, Chen & Hsu (2015) thấy cách giữ lệnh kiểu C&L **vẫn có lãi** trên DJIA 1992–2012 sau phí 0.5% và Step-SPA. Kết quả **dương, được lặp lại độc lập một phần** |
| **Marshall, Young & Rose (2006)**, "Candlestick technical trading strategies: Can they create value for investors?", *Journal of Banking & Finance* 30(8):2303–2323. [IDEAS](https://ideas.repec.org/a/eee/jbfina/v30y2006i8p2303-2323.html) · luận án tiến sĩ cùng tên của Marshall (Massey 2005) là bản công khai gần nhất | Cổ phiếu thành phần DJIA, 1992–2002, nến ngày **[luận án: abstract + mục lục]**. Xu hướng theo EMA 10 ngày; giữ lệnh 10 ngày (mua đầu t+4, bán cuối t+13) **[luận án + mô tả trong Lu et al. 2015]**. Con số "28 mẫu" **[không xác minh được]** | Không xác minh được cách xử lý phí. Kiểm định bằng bootstrap OHLC với các mô hình null random walk, AR(1), GARCH-M, EGARCH **[mục lục luận án]** | **Không** có giá trị; không có bằng chứng người giao dịch theo nến thắng thị trường **[luận án]** | Phương pháp mạnh. Bằng chứng âm **mạnh**. Lưu ý: Lu et al. (2015) cho thấy kết luận âm này gắn với cách giữ lệnh 10 ngày |
| **Marshall, Young & Cahan (2008)**, "Are candlestick technical trading strategies profitable in the Japanese equity market?", *Review of Quantitative Finance and Accounting* 31(2):191–207. [IDEAS](https://ideas.repec.org/a/kap/rqfnac/v31y2008i2p191-207.html) | Nhật Bản, 1975–2004, nến ngày **[abstract]** | Không xác minh được | Không có giá trị trong cả giai đoạn 30 năm, trong ba giai đoạn con 10 năm, và trong cả thị trường tăng lẫn giảm **[abstract]** | Đã xác minh thư mục. Quan trọng vì Nhật là nơi khai sinh nến |
| **Horton (2009)**, "Stars, crows, and doji: The use of candlesticks in stock selection", *Quarterly Review of Economics and Finance* 49(2):283–294. [IDEAS](https://ideas.repec.org/a/eee/quaeco/v49y2009i2p283-294.html) | 349 cổ phiếu Mỹ, nến ngày **[không kiểm tra lại]** | — | Ít hoặc không có giá trị | Bằng chứng âm. Lu et al. (2015) cũng xếp vào nhóm kết quả âm |
| **Lu, Shiu & Liu (2012)**, "Profitable candlestick trading strategies—The evidence from a new perspective", *Review of Financial Economics* 21(2):63–68, DOI 10.1016/j.rfe.2012.02.001. [IDEAS](https://ideas.repec.org/a/wly/revfec/v21y2012i2p63-68.html) | Thành phần Taiwan Top 50 Tracker Fund, 29/10/2002 → 31/12/2008, nến ngày, 3 mẫu hai nến tăng + 3 mẫu giảm. Giữ lệnh đến khi xuất hiện mẫu ngược chiều **[abstract]** | Abstract không nói về phí **[không xác minh được]** | 3 mẫu đảo chiều tăng sinh lời; có kiểm tra ngoài mẫu và bootstrap **[abstract]** | Không tìm thấy toàn văn công khai. Thị trường mới nổi, ít mẫu, abstract không nói đến hiệu chỉnh nhiều giả thuyết |
| **Lu, Chen & Hsu (2015)**, "Trend definition or holding strategy: What determines the profitability of candlestick charting?", *Journal of Banking & Finance* 61:172–183. Working paper công khai: [IEAS 14-A010](https://www.econ.sinica.edu.tw/~econ/pdfPaper/14-A010.pdf) | **Cổ phiếu thành phần DJIA** (không phải Đài Loan như bản trước ghi), 02/01/1992 → 31/12/2012, nến ngày, 8 mẫu đảo chiều ba nến; 3 định nghĩa xu hướng × 4 cách giữ lệnh (CL-3, MYR-10, CL-10, MYR-3); kiểm tra thêm NASDAQ **[toàn văn working paper]** | 0.5% mỗi vòng; kiểm tra độ nhạy với 0.1% **[toàn văn]** | 8 mẫu với cách giữ lệnh C&L có lãi sau phí 0.5% và sau Step-SPA; cách giữ lệnh Marshall-Young-Rose không có lãi. Định nghĩa xu hướng ảnh hưởng **không đáng kể**; cách giữ lệnh là yếu tố quyết định. Lãi lớn hơn trên NASDAQ (biến động hơn) **[toàn văn]** | Có hiệu chỉnh data snooping. **Đã sửa** thị trường và kết luận (bản trước ghi "nhạy với định nghĩa xu hướng") |
| **Lu (2014)**, "The profitability of candlestick charting in the Taiwan stock market", *Pacific-Basin Finance Journal* 26:65–78 (một tác giả). [IDEAS](https://ideas.repec.org/a/eee/pacfin/v26y2014icp65-78.html) | Đài Loan, 01/1992 → 12/2009, nến ngày, mẫu một nến phân loại theo bốn mức giá **[abstract]** | Có **[abstract]** | 4 mẫu có lãi sau phí; bootstrap và ngoài mẫu **[abstract]** | Dương có điều kiện, thị trường mới nổi |
| **Duvinage, Mazza & Petitjean (2013)**, "The intra-day performance of market timing strategies and trading systems based on Japanese candlesticks", *Quantitative Finance* 13(7):1059–1070. [IDEAS](https://ideas.repec.org/a/taf/quantf/v13y2013i7p1059-1070.html) | 30 cổ phiếu DJIA, **nến 5 phút**, 01/04/2010 → 13/04/2011, 83 luật từ TA-Lib (mẫu 1–5 nến) **[abstract + mô tả trong Lu et al. 2015]** | Có | Khoảng 1/3 luật thắng buy-and-hold trước phí; sau phí và hiệu chỉnh data snooping **không còn luật nào có lãi** **[abstract]** | **Mới thêm.** Nghiên cứu intraday chặt chẽ nhất tìm được. Bằng chứng âm **mạnh** cho intraday |
| **Ho, Chan, Pan & Li (2021)**, "Do Candlestick Patterns Work in Cryptocurrency Trading?", IEEE BigData 2021, tr. 4566–4569, DOI 10.1109/BigData52589.2021.9671826. [IEEE](https://ieeexplore.ieee.org/document/9671826) · [EdUHK](https://repository.eduhk.hk/en/publications/do-candlestick-patterns-work-in-cryptocurrency-trading/) | 23 crypto vốn hóa lớn nhất, **nến ngày**, 68 mẫu **[abstract]** | Không rõ | Các mẫu "ít hữu ích", nhiều mẫu có độ chính xác thấp **[abstract]** | Bài hội nghị 4 trang, chưa đọc toàn văn. Bằng chứng âm **trung bình–yếu** |
| **Luận văn Charles University**, "Candlesticks and graph patterns in cryptocurrencies". [Kho lưu trữ](https://dodo.is.cuni.cz/handle/20.500.11956/197060) | Crypto, 41 mẫu, skewness-adjusted t-test và binomial test **[không xác minh được: trang lỗi timeout/429]** | — | Xem bản gốc | Luận văn, chưa qua bình duyệt. Mức tin cậy **yếu** |
| **Kapur, Manohar, Mittal, Jain & Trivedi (2024)**, "Cryptocurrency price fluctuation and time series analysis through candlestick pattern of bitcoin and ethereum using machine learning", *International Journal of Quality & Reliability Management* 41(8):2055–2074. [Emerald](https://www.emerald.com/insight/content/doi/10.1108/IJQRM-12-2022-0363/full/html) | Bitcoin, 2012–2021; khung thời gian không rõ **[abstract]** | Không rõ | Engulfing có khả năng dự báo; harami cổ điển không hiệu quả; "inverted harami" profit factor 6.98 **[abstract]** | **Đã sửa** tên bài, tác giả, năm (bản trước chỉ ghi "bài trên IJQRM"). Tạp chí về quản lý chất lượng, không phải tài chính. Con số quá đẹp, không thấy hiệu chỉnh nhiều giả thuyết. Tin cậy **yếu** |
| **Bulkowski (2008)**, *Encyclopedia of Candlestick Charts*, Wiley | Cổ phiếu Mỹ, nến ngày, hàng triệu mẫu | **Không** tính phí. Đo "tỷ lệ đảo chiều/tiếp diễn" và diễn biến giá sau mẫu | Phần lớn mẫu chỉ hơn ngẫu nhiên một chút (gần 50–60%) | Dữ liệu lớn nhưng thống kê mô tả, không có kiểm định hay ngoài mẫu. Bằng chứng **trung bình–yếu**, hữu ích để lấy định nghĩa |
| **Nison (1991)**, *Japanese Candlestick Charting Techniques* | — | — | Nguồn gốc định nghĩa | **Không phải bằng chứng hiệu quả**, chỉ là mô tả và kinh nghiệm |

Nghiên cứu liên quan về phương pháp:

- Lo, Mamaysky & Wang (2000), "Foundations of Technical Analysis", *Journal of Finance*. Đây là cách nhận dạng mẫu hình bằng kernel regression, có tính định lượng. Kết quả cho thấy mẫu hình mang một chút thông tin phân phối, nhưng không chứng minh được khả năng sinh lời.
- Sullivan, Timmermann & White (1999), *Journal of Finance*: sau khi hiệu chỉnh data snooping (White's Reality Check), các luật kỹ thuật tốt nhất trên DJIA mất hiệu quả ở giai đoạn ngoài mẫu.

### 2.2 Phân loại bằng chứng

- **Mạnh (âm):** trên cổ phiếu Mỹ và Nhật, nến ngày, khi kiểm định bằng bootstrap với cách giữ lệnh 10 ngày, mẫu nến **không** tạo giá trị (Marshall và cộng sự 2006, 2008; Horton 2009).
- **Trung bình (dương có điều kiện):** mẫu đảo chiều ba nến với cách giữ lệnh ngắn kiểu Caginalp–Laurent (thoát dần trong 3 ngày) có lãi trên DJIA 1992–2012 sau phí 0.5% và Step-SPA (Lu, Chen & Hsu 2015); một số mẫu trên Đài Loan (Lu và cộng sự 2012; Lu 2014). Theo Lu, Chen & Hsu, **cách giữ lệnh** quyết định kết quả, còn định nghĩa xu hướng ảnh hưởng không đáng kể. Mâu thuẫn giữa Marshall và Caginalp phần lớn đến từ cách giữ lệnh.
- **Yếu:** các nghiên cứu crypto. Ít bài, đa số chỉ là kỷ yếu hội nghị hoặc luận văn, thường không tính phí. Hai hướng kết luận mâu thuẫn nhau.
- **Không có bằng chứng (chỉ là kinh nghiệm/quảng cáo):** order block, SMC/ICT, liquidity sweep, "win rate 80%" trên blog và YouTube. **Chưa kiểm chứng được** bằng nguồn học thuật nào.
- **Khung intraday (cổ phiếu/futures):** âm. Fock, Klein & Zwergel (2005), *Journal of Derivatives* 13(1):28–40, dữ liệu intraday hợp đồng tương lai DAX và Bund 2002–2003: kết quả kém **ngay cả khi chưa tính phí**, phần lớn không hơn giao dịch ngẫu nhiên **[abstract]**. Duvinage và cộng sự (2013), nến 5 phút trên 30 cổ phiếu DJIA: không luật nào sống sót sau phí và hiệu chỉnh data snooping.
- **Khung intraday trên crypto:** đã tìm nhưng **không thấy** nghiên cứu nào về mẫu nến trên crypto ở khung 1h trở xuống có đủ ba yếu tố: ngoài mẫu, tính phí, hiệu chỉnh nhiều giả thuyết. Các nghiên cứu gần nhất đều không trực tiếp về mẫu nến:
  - Bakker (2017), luận văn thạc sĩ Erasmus ([PDF](https://thesis.eur.nl/pub/41546/Bakker.pdf)): 3 312 luật kỹ thuật (không phải mẫu nến) trên BTC/USD 5 phút, 01/2013–07/2017. Có luật có lãi sau phí và hiệu chỉnh data snooping, nhưng lợi nhuận **rất không ổn định và giảm dần theo thời gian** **[abstract, qua kết quả tìm kiếm]**. Luận văn, chưa bình duyệt.
  - Shanaev, Vasenin & Stepanov (2023), "Turn of the candle effect in bitcoin returns", *Heliyon* ([link](https://researchportal.northumbria.ac.uk/en/publications/turn-of-the-candle-effect-in-bitcoin-returns/)): lợi suất dương tập trung ở các phút 0/15/30/45, xuất hiện từ khoảng giữa–cuối 2020. Đây là hiệu ứng lịch theo ranh giới nến, không phải mẫu nến **[abstract]**. Gợi ý cho dự án: thời điểm vào lệnh ở open nến có thể mang thiên lệch riêng.
  - Rink (2025), *Financial Innovation* 11(1) ([IDEAS](https://ideas.repec.org/a/spr/fininn/v11y2025i1d10.1186_s40854-025-00763-2.html)): mẫu biểu đồ (chart pattern, không phải nến) theo giờ trên giao dịch Mt.Gox 2011–2013; nghiên cứu hành vi nhà đầu tư, không phải backtest có phí **[abstract]**.

---

## 3. Cạm bẫy khi backtest mẫu nến

1. **Look-ahead bias**
   - Swing/fractal cần n nến bên phải mới xác nhận được.
   - ZigZag vẽ lại (repaint).
   - ATR/SMA tính có bao gồm nến tín hiệu.
   - Vào lệnh tại close của chính nến tín hiệu (chấp nhận được nếu thực thi ngay tại close, nhưng an toàn hơn là open của nến t+1).
   - Vùng hỗ trợ/kháng cự xây từ dữ liệu tương lai.
2. **Data snooping.** Ví dụ 15 mẫu × 2 hướng × 5 bộ ngưỡng × 4 cách thoát lệnh × 2 cặp × 3 khung = 3600 cấu hình. Gần như chắc chắn sẽ có cấu hình "có ý nghĩa" ở p < 0.05 do may mắn. Cần dùng Reality Check (White 2000), SPA test (Hansen 2005), hiệu chỉnh FDR Benjamini–Hochberg, Deflated Sharpe Ratio (Bailey & López de Prado 2014). Harvey, Liu & Zhu (2016) đề xuất ngưỡng t > 3.
3. **Định nghĩa mơ hồ.** Thay đổi một ngưỡng nhỏ, ví dụ râu ≥ 2× thân so với ≥ 2.5× thân, có thể làm đổi kết quả. Hãy đăng ký trước định nghĩa và báo cáo độ nhạy trên một lưới nhỏ thay vì chỉ báo cáo điểm tốt nhất.
4. **Thứ tự chạm SL/TP trong cùng nến.** Với OHLC 1h, nếu cả SL và TP nằm trong range của một nến thì không biết mức nào bị chạm trước.
   - Giả định bảo thủ: SL bị chạm trước.
   - Cách tốt hơn: tra dữ liệu 1m để phân xử.
   - Báo cáo tỷ lệ trường hợp mơ hồ.
5. **Chi phí.** Phí taker 0.1% mỗi chiều cộng slippage, tổng khoảng 0.2–0.3% cho mỗi vòng giao dịch. Biên lợi nhuận gộp của mẫu nến trong các nghiên cứu thường dưới 0.5–1%, nên ở khung 1h chi phí có thể nuốt hết lợi nhuận. Cần báo cáo cả kết quả gộp và kết quả ròng.
6. **Khác biệt của crypto.**
   - Giao dịch 24/7, không có gap, nên các mẫu đòi hỏi gap (star, piercing, abandoned baby, engulfing "thật") phải định nghĩa lại.
   - Mỗi định nghĩa lại là một lần thử nên phải tính vào số giả thuyết.
   - Biến động thay đổi theo chế độ thị trường (2022 bear, 2023–2024 bull), nên chuẩn hóa ngưỡng theo ATR.
   - Funding rate (perpetual, mỗi 8 giờ) ảnh hưởng lệnh giữ lâu.
   - Có wick do thanh lý dây chuyền và wick khác nhau giữa các sàn. Chỉ dùng một nguồn dữ liệu (Binance).
   - Dữ liệu spot và perp khác nhau.
7. **Survivorship và chọn tài sản.** Chỉ có BTC và ETH, tức là chỉ hai chuỗi tương quan cao, nên cỡ mẫu độc lập nhỏ hơn số giao dịch.
8. **Số mẫu ít.** Morning star hay three soldiers ở khung 1h có thể chỉ có vài chục tín hiệu trong 4.7 năm. Cần đặt ngưỡng tối thiểu, ví dụ ≥ 100 giao dịch mỗi fold, mới kết luận.
9. **Tín hiệu chồng lấn.** Các tín hiệu liên tiếp làm phương sai bị hiểu sai. Dùng block bootstrap hoặc quy tắc chỉ giữ một vị thế tại một thời điểm.

---

## 4. Đề xuất cho dự án

### 4.1 Ưu tiên kiểm chứng (theo thứ tự)

| # | Giả thuyết | Vào lệnh | SL / TP / thoát | Lý do chọn |
|---|---|---|---|---|
| 1 | **Engulfing + điều kiện xu hướng** (cả hai chiều) | Open nến t+1 | SL = cực trị của mẫu ± 0.1·ATR. Thoát cố định sau H nến (H ∈ {4, 12, 24}) **hoặc** TP = 2R | Bằng chứng trên crypto chỉ có một bài yếu (Kapur và cộng sự 2024, không rõ khung thời gian); định nghĩa rõ |
| 2 | **Hammer / shooting star (pin bar)** + xu hướng trước | Open nến t+1 | SL dưới/trên râu. Thoát sau H nến | Định lượng dễ, phổ biến nhất |
| 3 | **Liquidity sweep tại swing low/high đã xác nhận** (pin bar + vị trí) | Open nến t+1 | SL dưới mũi râu. TP = swing đối diện hoặc 2R | Kiểm tra giả thuyết "vị trí quan trọng hơn hình dạng" |
| 4 | **Inside bar breakout** | Lệnh stop ở H/L của nến mẹ, hết hạn sau 3 nến | SL ở phía đối diện nến mẹ. Thoát sau H nến | Đơn giản, không cần định nghĩa xu hướng |
| 5 | **BOS theo hướng xu hướng (HH/HL)** | Close vượt swing đã xác nhận, vào ở open nến kế | SL ở swing đối diện. Trailing theo swing | Là một biến thể breakout. So với Donchian để xem có thêm giá trị không |
| 6 | **Morning/evening star** (định nghĩa nới cho crypto) | Open nến t+1 | Như #1 | Kiểm tra dương tính trong các nghiên cứu cổ phiếu; dự kiến số tín hiệu ít |
| 7 | **Doji sau xu hướng mạnh** (k nến lợi suất > x·ATR) | Ngược xu hướng ở open t+1 | Thoát sau H nến | Có thể kỳ vọng kết quả âm. Dùng làm đối chứng |
| 8 (sau) | Demand/supply zone, order block | Chạm vùng lần đầu | SL ngoài vùng | Không có bằng chứng nào. Chỉ kiểm tra sau khi khung backtest đã ổn định |

Đầu tiên, đo **lợi suất có điều kiện** `r(t+1 → t+H)` sau tín hiệu so với lợi suất vô điều kiện, chưa dùng SL/TP. Làm như vậy để tách khả năng dự báo của mẫu khỏi ảnh hưởng của cách quản lý lệnh (bài học từ Lu, Chen & Hsu 2015: cách giữ lệnh quyết định kết quả). Nên đăng ký trước ít nhất hai cách giữ lệnh, một kiểu CL (thoát dần trong 3 nến) và một kiểu MYR (giữ cố định lâu hơn), và tính cả hai vào số giả thuyết. Chỉ những mẫu có lợi thế gộp mới được đưa sang bước kiểm tra có SL/TP và phí.

### 4.2 Baseline để so sánh

- **Vào lệnh ngẫu nhiên** cùng số lệnh, cùng hướng, cùng thời gian giữ và cùng luật SL/TP (bootstrap 1000 lần). Đây là baseline chính, theo cách của Marshall và cộng sự 2006.
- **Buy-and-hold** BTC/ETH trong cùng fold.
- **Luật kỹ thuật đơn giản:** SMA crossover và Donchian breakout (20 nến). Mẫu nến phải tốt hơn các luật này mới đáng giữ.
- **Cùng mẫu nhưng bỏ điều kiện ngữ cảnh** để đo giá trị gia tăng của xu hướng hoặc vị trí.

### 4.3 Hiệu chỉnh cho việc thử nhiều giả thuyết

1. **Đăng ký trước** định nghĩa, tham số và lưới tham số nhỏ, ghi vào file trước khi chạy. Đếm tổng số cấu hình N.
2. **Walk-forward:** ví dụ train 12 tháng, test 3 tháng, cuộn tiếp. Chỉ chọn tham số trên train. Dành riêng **2026-01 → 2026-09 làm holdout cuối**, chỉ chạy một lần.
3. Kiểm định:
   - Hansen SPA hoặc White Reality Check trên tập toàn bộ cấu hình so với baseline.
   - Benjamini–Hochberg (FDR 10%) cho các p-value từng mẫu.
   - Deflated Sharpe Ratio với N thử nghiệm.
   - Yêu cầu t > 3.
4. Yêu cầu **nhất quán:** kết quả cùng dấu trên cả BTC và ETH, trên đa số các fold, và còn dương sau phí 0.1% cộng slippage. Mẫu có lãi ở một cặp hoặc một năm duy nhất bị coi là không đạt.
5. Phân xử SL/TP cùng nến bằng dữ liệu 1m. Mặc định bảo thủ là SL chạm trước.

---

## 5. Nguồn

- Caginalp, G. & Laurent, H. (1998). The predictive power of price patterns. *Applied Mathematical Finance* 5(3-4), 181–205. https://ideas.repec.org/a/taf/apmtfi/v5y1998i3-4p181-205.html
- Marshall, B. R., Young, M. R., Rose, L. C. (2006). Candlestick technical trading strategies: Can they create value for investors? *Journal of Banking & Finance* 30(8), 2303–2323. https://ideas.repec.org/a/eee/jbfina/v30y2006i8p2303-2323.html ; tóm tắt CXO: https://www.cxoadvisory.com/technical-trading/candlesticks-fiddlesticks/ ; luận án tiến sĩ cùng tên của Marshall (Massey University, 2005): https://mro.massey.ac.nz/bitstreams/7afc8049-23a1-4fe9-ac3a-792d6403ef1c/download
- Marshall, B. R., Young, M. R., Cahan, R. (2008). Are candlestick technical trading strategies profitable in the Japanese equity market? *Review of Quantitative Finance and Accounting* 31(2), 191–207. https://ideas.repec.org/a/kap/rqfnac/v31y2008i2p191-207.html
- Horton, M. (2009). Stars, crows, and doji. *QREF* 49(2). https://ideas.repec.org/a/eee/quaeco/v49y2009i2p283-294.html
- Lu, T.-H., Shiu, Y.-M., Liu, T.-C. (2012). Profitable candlestick trading strategies—The evidence from a new perspective. *Review of Financial Economics* 21(2), 63–68. https://ideas.repec.org/a/wly/revfec/v21y2012i2p63-68.html
- Lu, T.-H. (2014). The profitability of candlestick charting in the Taiwan stock market. *Pacific-Basin Finance Journal* 26, 65–78. https://ideas.repec.org/a/eee/pacfin/v26y2014icp65-78.html
- Lu, T.-H., Chen, Y.-C., Hsu, Y.-C. (2015). Trend definition or holding strategy: What determines the profitability of candlestick charting? *Journal of Banking & Finance* 61, 172–183. Working paper: https://www.econ.sinica.edu.tw/~econ/pdfPaper/14-A010.pdf
- Duvinage, M., Mazza, P., Petitjean, M. (2013). The intra-day performance of market timing strategies and trading systems based on Japanese candlesticks. *Quantitative Finance* 13(7), 1059–1070. https://ideas.repec.org/a/taf/quantf/v13y2013i7p1059-1070.html
- Ho, K.-H., Chan, T. T. D., Pan, H., Li, C. (2021). Do Candlestick Patterns Work in Cryptocurrency Trading? *IEEE BigData 2021*, 4566–4569. https://ieeexplore.ieee.org/document/9671826
- Candlesticks and graph patterns in cryptocurrencies (luận văn, Charles University). https://dodo.is.cuni.cz/handle/20.500.11956/197060
- Kapur, G., Manohar, S., Mittal, A., Jain, V., Trivedi, S. (2024). Cryptocurrency price fluctuation and time series analysis through candlestick pattern of bitcoin and ethereum using machine learning. *IJQRM* 41(8), 2055–2074. https://www.emerald.com/insight/content/doi/10.1108/IJQRM-12-2022-0363/full/html
- Bakker, J. (2017). Luận văn thạc sĩ, Erasmus School of Economics. https://thesis.eur.nl/pub/41546/Bakker.pdf
- Shanaev, S., Vasenin, M., Stepanov, R. (2023). Turn of the candle effect in bitcoin returns. *Heliyon*. https://researchportal.northumbria.ac.uk/en/publications/turn-of-the-candle-effect-in-bitcoin-returns/
- Rink, K. (2025). The role of technical chart patterns in the early Bitcoin market: intraday evidence from the Mt.Gox transaction dataset. *Financial Innovation* 11(1). https://ideas.repec.org/a/spr/fininn/v11y2025i1d10.1186_s40854-025-00763-2.html
- Nison, S. (1991). *Japanese Candlestick Charting Techniques*. NYIF.
- Bulkowski, T. (2008). *Encyclopedia of Candlestick Charts*. Wiley.
- Lo, A., Mamaysky, H., Wang, J. (2000). Foundations of Technical Analysis. *Journal of Finance* 55(4).
- Sullivan, R., Timmermann, A., White, H. (1999). Data-snooping, technical trading rule performance, and the bootstrap. *Journal of Finance* 54(5).
- White, H. (2000). A Reality Check for Data Snooping. *Econometrica* 68(5).
- Hansen, P. R. (2005). A Test for Superior Predictive Ability. *JBES* 23(4).
- Bailey, D., López de Prado, M. (2014). The Deflated Sharpe Ratio. *Journal of Portfolio Management*.
- Harvey, C., Liu, Y., Zhu, H. (2016). …and the Cross-Section of Expected Returns. *Review of Financial Studies* 29(1).
- Fock, H., Klein, C., Zwergel, B. (2005). Performance of candlestick analysis on intraday futures data. *Journal of Derivatives* 13(1), 28–40. https://opus.bibliothek.uni-augsburg.de/opus4/frontdoor/index/index/year/2017/docId/35176
- Order block / SMC / ICT: không tìm thấy nguồn học thuật. **Chưa kiểm chứng được.**

---

## 6. Nhật ký xác minh

Thực hiện ngày 2026-10-07 bằng tìm kiếm web và tải trang. Trạng thái: **toàn văn** = đã đọc bản đầy đủ (hoặc working paper/luận án tương ứng); **abstract** = chỉ đọc tóm tắt hoặc trang chỉ mục; **không xác minh được** = không mở được nguồn.

| Nguồn | Trạng thái | Đã sửa / ghi chú |
|---|---|---|
| Caginalp & Laurent (1998) | Abstract (IDEAS) | Thư mục đúng. Bỏ câu "có bàn đến chi phí" vì abstract không nói về phí; thông tin spread 0.1–0.3% lấy gián tiếp từ Lu et al. 2015. Bỏ khẳng định "các nghiên cứu sau không lặp lại được" vì Lu, Chen & Hsu (2015) lặp lại được một phần |
| Marshall, Young & Rose (2006) | Toàn văn một phần: luận án Massey 2005 (chỉ trích xuất được abstract và mục lục, phần thân là ảnh quét). Bài JBF không có bản công khai, IDEAS không có abstract | Thêm số trang 2303–2323. Xác nhận DJIA 1992–2002, nến ngày, giữ ≤10 ngày, bootstrap với RW/AR(1)/GARCH-M/EGARCH. Con số "28 mẫu" và cách xử lý phí **không xác minh được**. Cột "Phí" bản trước ghi nhầm nội dung bootstrap |
| Marshall, Young & Cahan (2008) | Abstract (qua kết quả tìm kiếm; IDEAS chỉ có thư mục) | Bỏ [cần xác minh]. Thêm tên đầy đủ, 31(2):191–207, giai đoạn 1975–2004 |
| Horton (2009) | Không kiểm tra lại | Giữ nguyên; Lu et al. 2015 trích dẫn với kết luận âm, khớp với báo cáo |
| Lu, Shiu & Liu (2012) | Abstract (IDEAS); không tìm thấy toàn văn công khai | Thêm tên đầy đủ, DOI, ngày chính xác, cách giữ lệnh. "Có tính phí" **không xác minh được** |
| Lu, Chen & Hsu (2015) | Toàn văn (working paper IEAS 14-A010, bản sửa 07/2015) | Bỏ [cần xác minh]; thêm JBF 61:172–183. **Sửa sai lớn:** dữ liệu là DJIA 1992–2012 (thêm NASDAQ), không phải Đài Loan. Kết luận là cách giữ lệnh quyết định, định nghĩa xu hướng ảnh hưởng không đáng kể (bản trước viết ngược) |
| Lu (2014), PBFJ 26 | Abstract | Sửa thành một tác giả (bản trước ghi "và cộng sự"), thêm trang 65–78, giai đoạn 1992–2009 |
| Fock, Klein & Zwergel (2005) | Abstract (qua kết quả tìm kiếm; kho Augsburg/Kassel) | Bỏ [cần xác minh]; thêm 13(1):28–40, giai đoạn 2002–2003. Sửa tên tác giả đầu thành "Fock, H." theo các kho lưu trữ (bản trước ghi "J. H.", không xác nhận được) |
| Duvinage, Mazza & Petitjean (2013) | Abstract (IDEAS) + mô tả trong Lu et al. 2015 | **Mới thêm** |
| Ho, Chan, Pan & Li (2021), IEEE BigData | Abstract (EdUHK) | Thêm tác giả, trang, DOI; xác nhận nến ngày, 23 coin |
| Luận văn Charles University | Không xác minh được (trang trả lỗi timeout/429) | Giữ mô tả cũ, đánh dấu không xác minh được |
| Kapur et al. (2024), IJQRM | Abstract (Emerald) | Thêm tên bài thật, tác giả, 41(8):2055–2074, dữ liệu BTC 2012–2021 |
| Bakker (2017), Shanaev et al. (2023), Rink (2025) | Abstract (qua kết quả tìm kiếm hoặc trang chỉ mục) | **Mới thêm** cho mục crypto intraday; không phải nghiên cứu mẫu nến |
| Nison 1991, Bulkowski 2008, Lo/Mamaysky/Wang 2000, Sullivan/Timmermann/White 1999, White 2000, Hansen 2005, Bailey & López de Prado 2014, Harvey/Liu/Zhu 2016 | Không kiểm tra lại | Tài liệu kinh điển, chưa đối chiếu nguồn trong phiên này. Con số "50–60%" của Bulkowski chưa được xác minh |
| CXO Advisory (tóm tắt Marshall 2006) | Không mở lại | Giữ làm liên kết phụ |

Kết quả tìm kiếm cho mẫu nến crypto ≤1h có đủ ngoài mẫu + phí + hiệu chỉnh nhiều giả thuyết: **không tìm thấy** nghiên cứu nào.
