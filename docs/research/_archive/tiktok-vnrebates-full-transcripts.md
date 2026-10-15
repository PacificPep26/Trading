# TỔNG HỢP TOÀN BỘ LỜI THOẠI & QUY TẮC ĐO LƯỜNG VIDEO TIKTOK @vn_rebates

> **Mục đích:** Tài liệu nghiên cứu này ghi lại **nguyên văn 100% toàn bộ lời thoại (Audio Speech-to-Text)** của các video kỹ thuật cốt lõi (SMC, ICT, FVG, Order Block, Liquidity, Fibo OTE) từ kênh Vnrebates. Dựa trên lời thoại này, trader và lập trình viên có thể xây dựng các **quy tắc đo lường được (quantifiable trading rules)** để đưa vào code chiến lược / EA.

- **Kênh TikTok:** [Vnrebates (@vn_rebates)](https://www.tiktok.com/@vn_rebates)
- **Dữ liệu đính kèm:** [vn_rebates_technical_transcripts.xlsx](file:///D:/victor/Trading/docs/research/vn_rebates_technical_transcripts.xlsx), [vn_rebates_technical_transcripts.csv](file:///D:/victor/Trading/docs/research/vn_rebates_technical_transcripts.csv), [vn_rebates_technical_transcripts.json](file:///D:/victor/Trading/docs/research/vn_rebates_technical_transcripts.json)
- **Thư mục audio gốc:** `D:\victor\Trading\docs\research\vn_rebates_audio`

---

## MỤC LỤC CÁC VIDEO KỸ THUẬT

1. [Khám Phá Setup Giao Dịch Của Trader Nhận Payout 2 Triệu USD](#video-1-7696474697961196808)
2. [Thế Nào Là Một Khối Order Block (OB) Chất Lượng](#video-2-7696091260565769490)
3. [Fibonacci OTE Trong Forex: Cách Chọn Điểm Vào Lệnh An Toàn](#video-3-7695729577947155720)
4. [Hướng Dẫn Toàn Diện Về Fair Value Gap (FVG)](#video-4-7474060511584324885)
5. [Xác Định Thanh Khoản Thị Trường (Liquidity ICT)](#video-5-7446381153868598534)

---

## NỘI DUNG CHI TIẾT & LỜI THOẠI TỪNG BÀI HỌC

<a id='video-1-7696474697961196808'></a>
### Video 1: Khám Phá Setup Giao Dịch Của Trader Nhận Payout 2 Triệu USD

- **Link TikTok:** [https://www.tiktok.com/@vn_rebates/video/7696474697961196808](https://www.tiktok.com/@vn_rebates/video/7696474697961196808)
- **ID:** `7696474697961196808`
- **File âm thanh đã lưu:** `D:\victor\Trading\docs\research\vn_rebates_audio\01_7696474697961196808.mp3`

#### 1. Toàn bộ lời thoại video nói (Full Spoken Transcript)
> Đây là xét óp giúp Trader Can Pay Out gần 2 triệu đô từ ProfFirm. Chị tôi vai! Lấy giây bút ra ghi nè. Đầu tiên, chờ phiền Á kết thúc, đánh giấu đỉnh và đáy phiền Á. Kích theo, chờ 1 trong 2 vị trí này bị quét. Ở đây, đáy phiền Á đã bị quét. Vào khung M1, chờ phiền Âu mở cửa. Sau khi phiền Âu bắt đầu, giá đóng cửa tạo CISD. Vào lạnh mùa, Stop Loss dứa đáy vừa quét, thê pe ở đỉnh phiền Á. Nhưng nhớ quản lý lạnh, chốt 1 nữa ở đỉnh củ. Ông đã thử xét óp phiền Á này chưa? Comment cho tôi biết nhé!

#### 2. Các quy tắc kỹ thuật đo lường được (Quantifiable Rules)
- **Chiến lược áp dụng:** SMC (Smart Money Concepts) & ICT Trading Setup
- **Điều kiện đo lường:** Xác định thanh khoản phiên trước (Previous Session High/Low), quét thanh khoản (Liquidity Sweep) và xuất hiện nhịp Market Structure Shift (MSS).
- **Điểm vào lệnh & Stop Loss:** Vào lệnh tại Fair Value Gap (FVG) hoặc Order Block hình thành sau khi phá vỡ cấu trúc. SL đặt phía sau nến quét râu.

---

<a id='video-2-7696091260565769490'></a>
### Video 2: Thế Nào Là Một Khối Order Block (OB) Chất Lượng

- **Link TikTok:** [https://www.tiktok.com/@vn_rebates/video/7696091260565769490](https://www.tiktok.com/@vn_rebates/video/7696091260565769490)
- **ID:** `7696091260565769490`
- **File âm thanh đã lưu:** `D:\victor\Trading\docs\research\vn_rebates_audio\02_7696091260565769490.mp3`

#### 1. Toàn bộ lời thoại video nói (Full Spoken Transcript)
> Giả chạp OrderBlock rồi, mua được chưa ông? Thử đi! Sao kỳ với ta? Để tôi chỉ ông cách chọn ra OrderBlock chất lượng, sẽ cần những yếu tố gì. 1. OrderBlock đó phải tạo ra phá vỡ câu trúc BRS. 2. Theo sau OrderBlock, phải có 1 app Vega. 3. OrderBlock nằm ở vùng premium cho lệnh bán hoặc discount cho lệnh mua. Ở đây, OrderBlock giảm nằm ở premium. 4. Có quét thanh khoảng trước khi giá hồi về OrderBlock. Chỉ vào lệnh khi OrderBlock có ít nhất 3 trên 4 yếu tố. Vào lệnh bán tại OrderBlock, stoplock trên đỉnh OrderBlock RR12. Anh chọp TP luôn! Ông có chọn OrderBlock theo 4 yếu tố này chưa? Comment cho tôi biết nhé!

#### 2. Các quy tắc kỹ thuật đo lường được (Quantifiable Rules)
- **Khái niệm:** Order Block (OB) chất lượng cao
- **4 Yếu tố đo lường một khối OB chuẩn:**
- 1. Phải tạo ra sự mất cân bằng cung cầu (Imbalance / FVG) ngay sau nến OB.
- 2. Phải phá vỡ cấu trúc thị trường (BOS / MSS) của khung thời gian đó.
- 3. Nằm ở vùng giá chiết khấu (Discount) cho lệnh Mua hoặc vùng giá cao cấp (Premium) cho lệnh Bán.
- 4. Đã có hành động quét thanh khoản (Sweep Liquidity) của các đỉnh/đáy lân cận trước khi giá bứt phá.

---

<a id='video-3-7695729577947155720'></a>
### Video 3: Fibonacci OTE Trong Forex: Cách Chọn Điểm Vào Lệnh An Toàn

- **Link TikTok:** [https://www.tiktok.com/@vn_rebates/video/7695729577947155720](https://www.tiktok.com/@vn_rebates/video/7695729577947155720)
- **ID:** `7695729577947155720`
- **File âm thanh đã lưu:** `D:\victor\Trading\docs\research\vn_rebates_audio\03_7695729577947155720.mp3`

#### 1. Toàn bộ lời thoại video nói (Full Spoken Transcript)
> Gia phá đỉnh rồi quay về tét đỉnh con nén en-gu-fing mua thôi! Quang, nếu mua ở đây mà đặt stop-loss ngay dưới vùng đỉnh cũ thì rất không an toàn. Còn nếu đặt stop-loss dưới đấy thì rơ rơ lại rất thấp. Xem nè! Trời ơi, dính stop-loss rồi! Vậy phải làm sao hả ông? Bấu chốt là chúng ta phải tìm được điểm entry có stop-loss an toàn và rơ rơ tốt. Dùng Fibo OTE, kéo từ đáy lên đỉnh theo sưu hướng tăng. Lúc này, ông thấy vùng OTE từ 0.705 đến 0.79 trùng với FVG. Entry ở đây, stop-loss dưới đấy vẫn an toàn mà rơ rơ tốt hơn nhiều. Ông đã biết dùng OTE kết hợp FVG chưa? Comment cho tôi biết nhé!

#### 2. Các quy tắc kỹ thuật đo lường được (Quantifiable Rules)
- **Công cụ:** Fibonacci OTE (Optimal Trade Entry) kết hợp FVG
- **Quy tắc đo lường:**
- - Kéo Fibonacci từ Swing Low đến Swing High (hoặc ngược lại).
- - Vùng OTE tối ưu: Nằm giữa các mức hồi quy **0.618 - 0.705 - 0.786**.
- - **Điều kiện hợp lưu:** Vùng OTE phải trùng khớp với một khối FVG hoặc Order Block chưa được lấp (unmitigated).
- - **Stop Loss:** Đặt an toàn phía sau mốc Fibonacci 1.0 (hoặc Swing Low/High).

---

<a id='video-4-7474060511584324885'></a>
### Video 4: Hướng Dẫn Toàn Diện Về Fair Value Gap (FVG)

- **Link TikTok:** [https://www.tiktok.com/@vn_rebates/video/7474060511584324885](https://www.tiktok.com/@vn_rebates/video/7474060511584324885)
- **ID:** `7474060511584324885`
- **File âm thanh đã lưu:** `D:\victor\Trading\docs\research\vn_rebates_audio\04_7474060511584324885.mp3`

#### 1. Toàn bộ lời thoại video nói (Full Spoken Transcript)
> Hôm nay sẽ là 1 video khá là dài Mình sẽ hướng dẫn cho anh em những cái thứ chi tiết và thật chiến nhất về FVG, 1 công cụ cực kìa bánh mẽ trong phương pháp ICT Đầu tiên FVG sẽ được chia hình 4 loại hả? Dạy đầu tiên mà chúng ta sẽ học, đó chính là FVG Breakaway Nó sẽ được hình thành từ 3 cái nến tăng liên tiếp với anh em Và nó sẽ là dạy mở rộng Thì khi anh em thấy xuất hiện 3 cái nến tăng liên tiếp Hình thành 1 cái FVG Nó báo hiệu 1 cái động lực tăng mạnh của thị trường Và khả năng cái nha, khả năng cao Những cái FVG Breakaway này á Đến 80% giá nó sẽ tăng tiếp tục Và nó không quay về test cái FVG Thói chúng ta sẽ xem bí dụ mà Ở đây chúng ta có Cây nến khung H1 Anh em thấy không? Đây là 3 cây nến tăng liên tiếp Và nó tạo ra 1 cái buồn FVG ở đây Đúng không? Thì anh em quay xác anh em thấy được đỏ ràng là Giá đó không có test về cái FVG này Ở đây cũng có rất nhiều trường hợp như vậy hả? Này nè mình Khi nó tạo ra 1 cái FVG Breakaway á Ở đây nè Anh em thấy không? Thì giá nó liên tiếp tục tăng lên, tăng lên, tăng lên Cho đến ngày hôm sau nó mới quay về test Mà khi mà nó đi xa như vậy nó quay về test Thì nó không còn mạnh nữa Những FVG được tạo ra thì chúng ta sẽ muốn nó phải test liền Thì khi anh em thấy FVG Breakaway như thế này nè Thì anh em sẽ phải vào trong khung M5 Để anh em tìm kiếm những lệnh tiếp diễn Ok, mình sẽ vào trong khung M5 Mình vào trong khung M5 nè Rồi, mình sẽ tui vào chỗ này Thì trong khung M5 nó lại tiếp tục tạo ra 1 cái FVG Đúng không? Ở đây Thì bây giờ anh em có thể follow hell cái FVG mở năm này rồi Tại vì khi mà nó tạo ra FVG Breakaway ở khung H1 Thì trong khung M5 nó cũng sẽ tạo 1 cái động lực tăng Và lúc này anh em chỉ cần mua ở cái FVG trong khung M5 là được Rồi chúng ta cùng xem giá chạy ha Giá quay về test cái FVG trong khung M5 nè Mà tăng lên Đó chính là cách mà chúng ta sẽ giao dịch với FVG Breakaway Tiếp tục mình sẽ đến với 1 cái FVG bình thường Đó là 1 cái FVG có 2 cái nến tăng và 1 cái nến giảm như thế này Nó không phải là dẹn mở rộng anh em ha Thì với cái FVG dẹn này Giá nó có khả năng test lại cái FVG Sau đó mới tăng ha Thì chúng ta sẽ cùng vào trong cái bí dụ của EU dưới đây Thì bí bí EU này sẽ khá ngược lại là sẽ gồm là 2 cái nến giảm và 1 cái nến tăng Thì nó là FVG dẹn thường nhưng mà nằm trong xuống giảm anh em ha Thì chúng ta cũng có 1 cái FVG chỗ này Mình sẽ đặt lên nó là FVG H1 đi Cho anh em dễ quay xác rồi Rồi bây giờ mình sẽ vào trong khung M5 Tại vì đây là FVG dẹn thường, không phải là dẹn Breakaway Thì giá có khả năng sẽ test lại ha Vào trong khung M5 Rồi mình chờ test lại cái FVG này Rồi thì khi nó test lại cái FVG này rồi Nhưng mà M5 vẫn đang là 1 cái xuống dẹn này, 1 xuống tăng ha Thì mình sẽ chờ nó phá vào cái đáy này Rồi thì khi nó phá vào cái đáy này Nó hình thành cho mình 1 cái FVG Mở 5 ở đây, đúng chưa? Mình sẽ NG ở cái FVG mở 5 này Đặt stop-lock ở trên đây Và đặt cái mức tê bê là 2R 2R này mà Cùng sẽ nhá nó chạy ha Giá test lại cái FVG này Và sạch xuống, đó chính là cách chúng ta ứng dụng FVG bình thường ha Rồi tiếp tục 1 vàng FVG nữa Đó là EFVG Cũng tương tự như thế này, chúng ta có 1 cái FVG tăng đúng không? Đây Và nếu như cái FVG tăng này Nó bị phá bởi 1 cái nến Thay là nhiều cái nến nhứng chìm ha Nó chung là nhứng chìm cái FVG Như thế này Đó Nhứng chìm ha Thì cái FVG này Nó sẽ không còn là FVG nữa Nhưng mà nó sẽ là EFVG Nó sẽ trành EFVG Thì với EFVG, nghĩa là 1 cái FVG bị nhứng chìm Chúng ta sẽ chờ nó test lại và xeo xuống Hoặc là nếu như nó tạo 3 cái nến giảm Mà 1 cái nến tăng nhứng chìm thì chúng ta sẽ bài lên ha Tương tự chúng ta có 1 cái bí vụ ở đây Thử này ha Đây là 3 cái nến giảm đúng chưa? 3 cái nến giảm 1, 2, 3 Nó tạo chúng ta 1 cái FVG Đúng không? Và cái FVG này đã bị nhứng chìm Bởi cái nến tăng này Thì chỗ này nó sẽ trở thành EFVG Rồi cái nhiệm vụ chúng ta chỉ là vì 3 lại khi giá test cái EFVG Đã X lời dưới đây và tề bên trên Rồi cùng xem giá chạy đẹp Giá test lại cái EFVG và Tiếp tục tăng lên Đó là cách xài EFVG ha Rồi 1 dạng FVG nữa Đó là B rồi B B được đựng dễ như thế nào Nếu dư Mình sẽ kéo 3 cái nến giảm Chưa có 3 cái nữa này đi Thì chúng ta sẽ có 1 cái FVG tăng đúng không? Nhưng nếu như cái FVG tăng này Bị nhứng chìm bởi 1 cái FVG giảm đối diện Đây, trái hẹn như thế này là 1 cái 3 cái nến giảm đúng không? 3 cái nến giảm này tạo 1 cái FVG đối diện ở đây Đúng chưa? Đó Thì đây gọi là B rồi B Hay gọi là Subton ha Đây là cái dạng mạnh nha ném Dạng mạnh của FVG đảo chiều Tại vì khi mà Nên nó biết là khi mà giá tạo 1 FVG Chứng đó động lực tăng nó rất là mạnh đúng không? Nhưng mà nó lại bị nhứng chìm Bởi 1 cái động lực giảm Chứng tạo là tại cái vị trí này nha Là cái bên bán nó nhảy vào rất mạnh Thì anh em sẽ canh nó test lại cái FVG này Để anh em bán xuống ha Đó chính là Subton Thì gọi là B rồi B Rồi chúng ta sẽ cùng nhau Nhìn vào cái ví dụ con HU với đây Đây Sau khi giá nó sang ra hành khoảng cái đỉnh bên đây Nè em thấy không? Này nó sang hành khoảng cái đỉnh nè Mình sẽ tua lại ha Nó sang hành khoảng cái đỉnh xong Nó tạo chúng ta 1 cái FVG Đúng chưa? FVG Rồi Và FVG này bị diễn em Bị nhứng chìm bởi cái FVG đối diện Chính là cái FVG này Đúng không? Này FVG tăng bị nhứng chìm bởi FVG giảm Sau đó nó test lại bằng cái nánh này Đây cái nánh này Khi nó tạo được cái FVG giảm nhứng chìm rồi Thì chúng ta tham cú Subton rồi Thì anh em sẽ đặt 1 cái lệnh cell Ngay tại cái FVG giảm được tạo ra X lời đặt trên đây Và TB TB về đáy gần nhất Chính là vị trí này Rồi cùng xem giá chạy ha Giá test lại Và sắp mạnh xuống ha Đó chính là Subton Bây giờ mình nói là khi sẽ là Subton Giá đi rất là mạnh đúng không? Nó sắp rất là mạnh ha Rồi tiếp tục Chúng ta đến với cái FVG Cuối cùng Cái FVG này không dùng để vào lệnh Mà FVG này dùng để làm gì anh em? Dùng để làm đến TB Làm đến TB ha Hay còn gọi là ReFVG ReFVG Nghĩa là sao? Nghĩa là Đây là cái điểm mà anh em sẽ chốt lời Cái điểm này sẽ chốt lời Nếu như anh em có lệnh mua Thì nếu như anh em có 1 cái lệnh mua ở đây Mình giả sử ở đây là 1 case FVG Đúng không? Anh em mua ở đây Anh em phải tới bệp đầu Tên bệp đầu thì đương nhiên là chúng ta sẽ Nhìn những cái cản rồi Thì ở đây có 1 cái FVG đói diện nữa nào Đúng không? Một cái FVG nó diễn nữa Thì nếu như anh em mua ở đây Anh em có thể TB ở đây Và nếu như nó lụng ở đây Thì nó sẽ lên đầu Nó sẽ tìm kiếm ở đâu tiếp Nó sẽ tìm kiếm cái FVG trên đây Thì cái FVG này cũng gọi là ReFVG luôn Và cái FVG này cũng gọi là ReFVG Cả hai cái này đều là ReFVG ha Tao cùng xem giá nó chạy tiếp Nó thì khi giá nó Nó lại tiếp tục Test về cái FVG này Đúng không? Đó tiện em có thể mua ha Có thể mua lên từ đây Rồi giá nó tiếp tục tăng lên thôi Rồi thì TB của này sẽ lâu TB này sẽ là cái ReFVG này Ở chỗ này nó cũng sẽ có 1 cái FVG nào Anh em cũng có thể mua ở cái FVG này Hét lờ dưới đây Và TB cũng về cái ReFVG luôn Hai lần chúng ta được TB về cái ReFVG này Và nếu em kia giá nó chạm đến cái ReFVG này ha Nó sẽ có phản ứng mạnh Mình không biết là nó có xuyên được cái FVG này không Hay là từ cái ReFVG này nó sẽ đảo chiều Nhưng đây là cái điểm TB đẹp nhất Đó thì đây là cái ứng dụng của ReFVG ha Rồi thì trong video hôm nay mình đã chia sẻ cho anh em Hết tất cả những các loại ReFVG có trên thị trường Hầu tiên là ReqAway ReFVG ReFVG bình thường ReFVG BW Và ReFVG Đó là những loại ReFVG mà anh em cần biết Để có thể áp dụng nó vào trong cái quá trình trái đình của mình ha Ok cám ơn em đã theo dõi video này Và nếu anh em thấy hay Các bạn có thể lưu video và bấm vào cái link bio Để tiếp cận những phương pháp trái đình hiệu quả nhất ha Ok cám ơn em đã theo dõi video

#### 2. Các quy tắc kỹ thuật đo lường được (Quantifiable Rules)
- **Chủ đề:** Giáo trình toàn diện về Fair Value Gap (FVG) - 11 phút chuyên sâu
- **Quy tắc đo lường mô hình nến FVG:**
- - Mô hình 3 nến liên tiếp (Nến 1, Nến 2, Nến 3).
- - Bullish FVG: Râu trên nến 1 không chạm vào râu dưới nến 3 -> Khoảng trống giữa nến 1 và nến 3 chính là khoảng FVG.
- - Bearish FVG: Râu dưới nến 1 không chạm vào râu trên nến 3.
- - **Consequent Encroachment (CE):** Mức chính giữa (50% vùng FVG) là ngưỡng phản ứng giá then chốt.
- - **Điều kiện vào lệnh:** Chờ giá hồi quy (Retest) về lấp 50% FVG hoặc chạm vào biên của FVG theo xu hướng khung lớn.

---

<a id='video-5-7446381153868598534'></a>
### Video 5: Xác Định Thanh Khoản Thị Trường (Liquidity ICT)

- **Link TikTok:** [https://www.tiktok.com/@vn_rebates/video/7446381153868598534](https://www.tiktok.com/@vn_rebates/video/7446381153868598534)
- **ID:** `7446381153868598534`
- **File âm thanh đã lưu:** `D:\victor\Trading\docs\research\vn_rebates_audio\05_7446381153868598534.mp3`

#### 1. Toàn bộ lời thoại video nói (Full Spoken Transcript)
> ICT đã từng nói, tị trường chỉ làm có 2 việc thôi Thứ nhất là quay thanh khỏe và thứ 2 là lắp này các FVG Điều này có nghĩa là nếu như anh em vào một cái lệnh nào đó mà anh em chưa tìm nấy thanh khỏe thì rất có thể anh em sẽ trở thành thanh khỏe ICT là một trader với quan điểm dâu dịch là tị trường luôn luôn tìm thanh khỏe trước khi có những bước đi tiếp theo Thì sau khi tham khảo vào cái tư duy của ICT thì mình đã rút ra được một số các bài học và hôm nay mình sẽ chia sẻ anh em để có thể tăng thêm một cái tự lời hắn của mình Ok, nè Ma, thì anh em nhìn 2 cái bí vụ với đây thì anh em thấy khi giá nó phải hướng tới một cái buồn giá nào đó thì sẽ có 2 trường hợp xảy ra đúng không? Một là giá chạm đứng cái buồn này và tăng lên Nếu anh em ba này sẽ thắng Còn hai, nó chạm buồn này nhưng mà nó không tăng mà nó xuyên luôn thì anh em sẽ thua Anh em nghĩ là chỉ có 2 trường hợp thôi hả? Còn 1 trường hợp nữa đó là giá nó vét đáy xong nó mới thanh Đó Vậy thì nếu như anh em chọn 1 cái chờ về đây anh em ba lên thì anh em có tới 2 trường hợp mà anh em có thể thua được và là cái này và cái này Vậy thì thông bình hơn nó sẽ chờ cái gì? Ta sẽ chờ giá nó vét xong rồi chúng ta mới bầu lệnh thì lúc đó anh em có thể loại được bớt thêm 1 trường hợp thua nữa thì cái thể thắng nó sẽ tăng lên đúng không? Rồi bây giờ nó sẽ cùng nhau nhìn vào cái trạng này Đây là 1 cái cấu chút tăng đúng rồi anh em, chút tăng này thì có nhiều nên sẽ canh 3 cái giá qua bên bùn đáy này Thì khi giá trạm bùn đáy này nó sức hiểm cơ nến bin ba đứt rau thì là phần anh em sẽ vào buồn ở đây x lờ dưới cái đáy này và bề bề thì chúng ta cùng xem giá nó đi như thế nào hả? Mới vụng ta 1 vài trành bị x lờ sau đó nó mới tăng lên thì mình sẽ vào lệnh khi này bị béc rồi và tiếp tục tăng lên nè sau khi béc xong anh em phải tăng lên nó đóng đến qua cái nến này thì lúc này đây chỉ là 1 cái phá bởi giả thôi nè thì chúng ta mới bắt đầu vào lệnh mua vị trí này đạt sublots như đây và tb lên trần cùng xem giá nó chạy hả? Sau khi được bấy đựng sublots rồi thì giá nó đi rất là nhanh và đạt được tb đó là cách để thông minh nhớ nè chờ giá quá thân ngoại thông chúng ta mới vào chúng ta sẽ có tự lệnh hắn cao hơn ok nè mà lô video lại để xem kì cứng thiết

#### 2. Các quy tắc kỹ thuật đo lường được (Quantifiable Rules)
- **Khái niệm:** Thanh khoản thị trường (Liquidity) trong ICT
- **Quy tắc đo lường:**
- - **BSL (Buy-Side Liquidity):** Nằm phía trên các vùng đỉnh cũ (Equal Highs, Swing High) - nơi tập trung Stop Loss của phe Sell và lệnh Buy Stop.
- - **SSL (Sell-Side Liquidity):** Nằm phía dưới các vùng đáy cũ (Equal Lows, Swing Low) - nơi tập trung Stop Loss của phe Buy và lệnh Sell Stop.
- - **Quy tắc Smart Money:** Cá mập luôn đẩy giá quét qua BSL/SSL để kích hoạt thanh khoản trước khi đảo chiều sang xu hướng thực.

---
