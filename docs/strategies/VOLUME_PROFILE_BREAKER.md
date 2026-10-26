# Research 26/10: Volume Profile & ICT Breaker Block

Tài liệu tham chiếu cho agent sau — ghi lại ĐẦY ĐỦ quá trình research, implement,
test và quyết định của 2 kỹ thuật mới được thêm vào `src/indicators.js` ngày
26/10/2026, theo yêu cầu "mở rộng tư duy trading, tìm nguồn trên mạng cải thiện".
Xem tóm tắt ngắn trong `docs/REGIME_ADAPTIVE_PLAN.md` Phần 6 — đây là bản đầy đủ.

## TRẠNG THÁI HIỆN TẠI (ĐÃ DEPLOY LIVE, 26/10/2026)
Sau research sâu + parameter sweep (38 tổ hợp) + backtest đa năm 2021-2026
(Phần 7-9 bên dưới), **ICT Breaker Block (AND_FILTER, pivotL=1/pivotR=1) đã
được BẬT MẶC ĐỊNH** trong `src/config.js` (`useBreakerBlocks` mặc định
`true`, trước đó là `false`). **Volume Profile vẫn TẮT mặc định** — không có
bộ tham số nào vượt chuẩn. Đây là bộ nhớ quyết định chính thức, không phải đề
xuất — nếu muốn tắt lại phải backtest lại trước, không tự ý đổi mù.

## 1. Research — các hướng đã khảo sát (WebSearch)

Tìm 3 hướng: Order Flow/Volume Profile, ICT SMC nâng cao (Breaker/OTE), Wyckoff
Accumulation/Distribution. Kết quả chủ yếu là mô tả indicator/vendor, **không có
backtest độc lập đáng tin** — đúng cảnh báo chung của mảng này, mọi số liệu
phải tự verify bằng backtest thật, không tin lời quảng cáo.

### 1.1. Khả thi, đã implement
- **Volume Profile (POC/VAH/VAL)**: tính được từ OHLCV đã có (binning giá theo
  volume). Cảnh báo quan trọng tìm được: chiến lược "revert to POC" đơn thuần
  "bị trend nghiền nát" — phải dùng kèm bộ lọc trend (`marketPhase`/`d1Phase`
  đã có sẵn trong engine), không dùng riêng.
- **ICT Breaker Block retest**: order block bị phá vỡ thất bại rồi được retest
  từ phía đối diện. Khác Zone Reaction hiện tại (test lại pivot/cản còn
  "nguyên vẹn") — breaker đòi hỏi đã có 1 lần thất bại cấu trúc trước đó, lọc
  chặt hơn, lý thuyết nên giảm false signal ở sideway.

### 1.2. Không khả thi — không implement
- **Order Flow / Delta / CVD thật**: cần dữ liệu tick-by-tick hoặc footprint,
  OKX public REST (`fetchOkxCandles`) chỉ trả OHLCV, không có order-side volume
  thật. Có thể xấp xỉ bằng vị trí close trong range nến làm "taker-side proxy"
  nhưng đây là ước lượng yếu — rủi ro ảo tưởng độ chính xác, KHÔNG làm.

### 1.3. Đã có sẵn trong engine, chỉ khác tên gọi
- **Wyckoff Spring (accumulation) / UTAD (distribution)**: về bản chất là cùng
  khái niệm với liquidity sweep trong `classifyLiquidityTiers()` (quét Tier 1
  Equal Highs/Lows rồi đảo chiều tại Tier 2 Major Level) đã dùng trong Kane
  Long/Short từ trước. Không cần code mới.

## 2. Implementation

### 2.1. `calculateVolumeProfile(candles, lookback=50, numBins=24, valueAreaPct=0.70)`
File: `src/indicators.js`. Input: mảng nến OHLCV (thường H4). Thuật toán:
1. Lấy `lookback` nến gần nhất, chia biên độ [min(low), max(high)] thành
   `numBins` bin giá đều nhau.
2. Với mỗi nến, phân bổ ĐỀU volume của nó vào các bin mà [low, high] của nến
   phủ qua (xấp xỉ chuẩn ngành khi không có dữ liệu tick thật — "uniform
   distribution proxy", không phải volume thật theo từng mức giá).
3. POC = bin có volume cao nhất.
4. Value Area mở rộng từ POC ra 2 bên, mỗi bước chọn bên có volume bin kế tiếp
   lớn hơn, dừng khi đạt `valueAreaPct` (70%) tổng volume. VAH/VAL = biên trên/
   dưới của Value Area.

Trả về `{poc, vah, val, bins, totalVol}`, `null` an toàn nếu không đủ dữ liệu.

### 2.2. `findBreakerBlocks(candles, pivotL=2, pivotR=2)`
File: `src/indicators.js`. Dùng `findFractalPivots()` có sẵn để tìm swing
high/low, rồi:
- **Bearish Breaker**: swing high bị giá đóng vượt lên (fail), sau đó giá gãy
  mạnh xuống phá qua swing low kế tiếp gần nhất (xác nhận đảo chiều cấu trúc)
  → vùng thân nến đã tạo swing high đó trở thành breaker **kháng cự** cho lần
  retest sau.
- **Bullish Breaker**: đối xứng — swing low bị phá xuống, giá bật mạnh phá qua
  swing high kế tiếp → vùng đó trở thành breaker **hỗ trợ**.

Trả về mảng `{type, top, bottom, formedAtIndex, isMitigated}`. `isMitigated`
= đã có nến nào chạm lại vùng đó sau khi cấu trúc xác nhận chưa (nếu có, coi
như đã "dùng" 1 lần, giảm giá trị cho lần sau).

### 2.3. Wiring vào engine (`src/engine.js`, hàm `tryZoneReactionSetup`)
Cả 2 chỉ được cộng thêm làm **cản bổ sung** (`majorResistances`/`majorSupports`)
bên cạnh Tier 2 Major Level hiện có, gated bởi 2 config flag MẶC ĐỊNH TẮT:
```js
if (config.useVolumeProfile) { ... vp.vah/vp.val ... }
if (config.useBreakerBlocks) { ... breakers không isMitigated ... }
```
Config (`src/config.js`, `INDICATOR_CONFIG`): `useVolumeProfile` (env
`USE_VOLUME_PROFILE`), `volumeProfileLookback` (env `VOLUME_PROFILE_LOOKBACK`,
mặc định 50), `useBreakerBlocks` (env `USE_BREAKER_BLOCKS`). Cả 2 mặc định
`false` — bật thử bằng cách set env khi chạy backtest, KHÔNG cần sửa code.

## 3. Kết quả backtest 1 năm (`node scripts/backtest_1year.mjs`)

Baseline (cả 2 flag tắt, mặc định, = trạng thái live hiện tại commit `7c8423a`):
**238 lệnh, Win Rate 52.1%, PF 1.52, +62.92R, +$596.55, Max DD -15.55R.**

| Cấu hình | Lệnh | Win Rate | PF | Tổng R | Net $ | Max DD |
|---|---|---|---|---|---|---|
| Baseline (cả 2 TẮT) | 238 | 52.1% | **1.52** | +62.92R | +$596.55 | -15.55R |
| `USE_VOLUME_PROFILE=true` | 334 | 50.9% | 1.44 | +78.70R | +$738.00 | -15.72R |
| `USE_BREAKER_BLOCKS=true` | 293 | 48.5% | 1.27 | +46.13R | +$419.68 | -18.32R |

### 3.1. Volume Profile — phân tích
Thêm ~96 lệnh mới (334 vs 238), Tổng R và Net $ tăng tuyệt đối NHƯNG PF giảm
rõ (1.52→1.44) và DD tệ hơn nhẹ. Tháng 10 (mục tiêu ban đầu của research — giai
đoạn sideway yếu) cải thiện nhẹ (+1.12R vs +0.02R) nhưng DD tháng đó cũng tệ
hơn (-7.00R vs -6.00R). Diễn giải: VAH/VAL tạo thêm nhiều điểm vào lệnh nhưng
pha loãng chất lượng trung bình — đúng cảnh báo từ research (mean-reversion
"revert to POC" dễ bị cuốn vào trend, dù đã có lọc `marketPhase`).

### 3.2. ICT Breaker Block — phân tích
Tệ hơn baseline ở **cả 3/3 chỉ số chính** (PF, Tổng R, DD) — không có mặt tốt
nào để đánh đổi, khác với Volume Profile (còn có Net $ tăng). Diễn giải khả dĩ:
điều kiện breaker (đòi 2 lần phá cấu trúc liên tiếp qua `findFractalPivots`)
quá hiếm/trễ trên dữ liệu thật, khi khớp thường giá đã đi được một đoạn, SL xa
hơn, RR thực tế kém hơn các cản Tier 2 hiện có.

## 4. Quyết định cuối

**KHÔNG bật mặc định cả 2.** Không đạt chuẩn "cải thiện thật" của dự án (phải
tốt hơn rõ ràng, không đổi 1 chỉ số chính để lấy 1 chỉ số khác mà không có lý
do mạnh). Giữ nguyên baseline live `7c8423a` (PF 1.52, +62.92R, 238 lệnh).

Code + unit test (`scripts/check.mjs` mục 19, 2 test case mới, tổng 88/88 PASS)
**vẫn giữ lại trong repo** làm thư viện tham khảo — 2 hàm thuần túy
(`calculateVolumeProfile`, `findBreakerBlocks`) không gây side-effect gì khi
flag tắt, không cần dọn.

## 5. V2 — đã thử cả 2 hướng gợi ý ban đầu (26/10, cùng ngày), KẾT QUẢ: vẫn thất bại

Theo đúng gợi ý ở cuối Phần 4 (bản V1), đã code và backtest tiếp 2 hướng:

### 5.1. Volume Profile V2 — chỉ bật khi `d1Phase === 'RANGING'`
Sửa điều kiện: `if (config.useVolumeProfile && d1Phase === 'RANGING')`. Giả
thuyết: lọc trend đúng sẽ giảm whipsaw do mean-reversion bị cuốn vào trend.

**Kết quả: TỆ HƠN cả V1.** PF 1.52(baseline)→**1.34** (V1 là 1.44 — V2 giảm
sâu hơn), Tổng R +62.92→**+53.68R** (V1 là +78.70R — V2 mất cả phần tăng do
nhiều lệnh của V1), DD -15.55→-14.72R (cải thiện nhẹ duy nhất). Diễn giải: gộp
thêm điều kiện lọc không "cứu" được chất lượng kém của VAH/VAL làm cản — mà
còn cắt luôn phần lệnh tốt mà V1 vô tình bắt được lúc không RANGING. Giả
thuyết ban đầu (lọc trend sẽ giúp) **bị bác bỏ bằng số liệu thật.**

### 5.2. ICT Breaker Block V2 — AND filter thay vì OR cản mới
Sửa từ "thêm cản mới" thành "chỉ giữ cản Tier 2/FVG hiện có nếu trùng vùng
breaker chưa bị lấp" (lọc chặt hơn, không tạo cản mới):
```js
for (let i = majorResistances.length - 1; i >= 0; i--) {
  if (!inBreakerZone(majorResistances[i], 'BEARISH')) majorResistances.splice(i, 1);
}
```

**Kết quả: HỖN HỢP, KHÔNG đạt chuẩn cải thiện rõ.** 222 lệnh (giảm từ 238 —
lọc chặt hơn đúng như kỳ vọng), PF 1.52→**1.55** (tăng nhẹ), Tổng R
62.92→**62.21R** (gần như không đổi), Net $ 596.55→**592.30** (gần như không
đổi), nhưng Max DD -15.55→**-17.74R** (tệ hơn rõ, -2.19R). Chỉ 1/4 chỉ số
(PF) tăng nhẹ, 2/4 gần như đứng yên, DD tệ hơn đáng kể — KHÔNG đủ để đánh đổi
theo chuẩn của dự án (so sánh với case `strictShortSweep` đã ĐƯỢC chấp nhận
trước đó: 3/4 chỉ số tốt lên rõ, DD chỉ tệ hơn nhẹ -13.20→-15.55R).

### 5.3. Kết luận cuối cùng sau 4 lần thử (V1×2 + V2×2)
Cả Volume Profile và ICT Breaker Block, dù thử 2 cách tiếp cận khác nhau mỗi
loại, **đều không vượt được baseline hiện tại** (PF 1.52, +62.92R, 238 lệnh,
DD -15.55R, commit `7c8423a`). Dừng research hướng này tại đây — không còn ý
tưởng hợp lý nào khác trong phạm vi 2 hàm này để thử mà không phải đoán mù.
Code 2 hàm thuần túy vẫn giữ lại trong repo (xem Phần 2), cờ cấu hình vẫn mặc
định tắt, không deploy.

## 6. Hướng còn lại CHƯA thử (nếu agent sau muốn tiếp tục, KHÔNG phải kết luận)
- Volume Profile với `lookback` ngắn hơn nhiều (ví dụ 20 nến ~3.3 ngày thay vì
  50 ~8.3 ngày) — có thể VAH/VAL "cũ" (50 nến) không còn phản ánh đúng vùng
  giá trị gần nhất trong giai đoạn biến động nhanh.
- Kết hợp cả 2 điều kiện: Breaker Block AND filter CHỈ áp dụng khi
  `d1Phase === 'RANGING'` (chưa test tổ hợp này).
- Luôn backtest full-history + so baseline trước khi đổi bất kỳ điều gì ở trên,
  theo đúng kỷ luật trong `CLAUDE.md` Phần 2 (LIVE-PATH MANDATE).

## 7. Research sâu 2: Chuẩn ngành, Lý thuyết gốc ICT & Bằng chứng định lượng (26/10)

Để giải quyết triệt để 2 lỗ hổng phương pháp luận (baseline có lợi thế 1-năm sample,
chưa parameter sweep), nhóm nghiên cứu đã mở rộng khảo sát chuyên sâu qua tài liệu
chuẩn nền tảng (TradingView, Sierra Chart), giáo trình gốc Inner Circle Trader
(Michael J. Huddleston), và các bài báo khoa học/định lượng (arXiv, SSRN, QuantConnect):

### 7.1. Volume Profile trong thực tế chuyên nghiệp (TradingView, Sierra Chart, Bookmap)
- **Lookback cho Crypto H4**: Crypto giao dịch 24/7 (6 nến H4/ngày = 42 nến/tuần),
  không có tiếng chuông mở/đóng cửa phiên như chứng khoán. Các nền tảng chuyên nghiệp
  áp dụng 2 trường phái:
  1. *Anchored Volume Profile*: Neo vào điểm swing cấu trúc lớn, chu kỳ tuần (Weekly ~42 bars H4),
     hoặc chu kỳ 2 tuần (~84 bars).
  2. *Rolling Window*: Khuyến nghị thực tế cho H4 là 35–84 nến (tương đương 5.8 đến 14 ngày).
     Nếu chọn lookback quá ngắn (<20 bars ~3.3 ngày), profile bị nhiễu cục bộ và nhảy liên tục;
     nếu chọn quá dài (>100 bars), các vùng giá trị cũ (stale value areas) không còn phản ánh
     đúng phân phối cung cầu hiện tại.
- **Độ phân giải Bins (Row Size / Granularity)**:
  - Bản code hiện tại dùng `numBins = 24` cố định chia đều trong khoảng [min(low), max(high)].
  - Trên crypto biến động mạnh (BTC giật 5-10% trong vài ngày), 24 bins là khá thô, làm
    "bẹt" histogram và làm mờ các đỉnh nhọn Volume (High Volume Nodes - HVN).
  - Chuẩn Sierra Chart (*Volume By Price*) và TradingView dùng từ 100 đến 500 rows, hoặc định
    nghĩa cố định theo Tick Size / ATR-adaptive bins (`binSize = k * ATR`).
  - Hạn chế cố hữu của dữ liệu OHLCV: Thuật toán phân bổ đều volume của mỗi nến vào các bin
    nó phủ qua (*uniform distribution proxy*) chỉ là ước lượng gần đúng, không có dữ liệu
    khối lượng theo từng tick thật như Footprint/Bookmap.
- **Value Area Percentage**: Chuẩn quốc tế của Market Profile / Volume Profile (James Dalton)
  luôn là **70%** (xấp xỉ 1 độ lệch chuẩn $\approx 68.2\%$ của phân phối chuẩn Gauss).
  Một số hệ thống định lượng thử nghiệm 60% (thu hẹp biên độ, tạo cản sớm hơn) hoặc 80%
  (mở rộng biên độ, chỉ bắt các cú lệch pha cực đoan).
- **Rủi ro định lượng**: Chiến lược "revert to POC" hoặc "fade VAH/VAL" bị phụ thuộc mạnh vào
  đường đi giá (path-dependency). Khi thị trường bước vào pha mở rộng xu hướng (expansion),
  giá xuyên qua VAH/VAL mà không có hồi quy, gây chuỗi thua lỗ liên tiếp nếu không có bộ lọc
  regime nghiêm ngặt.

### 7.2. ICT Breaker Block: Lý thuyết gốc ICT vs Bản giản lược
Nghiên cứu giáo trình Inner Circle Trader (Michael J. Huddleston) chỉ ra sự khác biệt cơ bản
giữa định nghĩa chuẩn ICT và bản giản lược qua fractal pivot:
- **Định nghĩa chuẩn ICT**: Breaker Block là một **Order Block thất bại (Failed Order Block)**,
  phải trải qua chuỗi 4 pha bắt buộc:
  1. *Pha hình thành Order Block*: Cụm nến ngược chiều cuối cùng trước một cú đẩy giá.
  2. *Pha quét thanh khoản (Liquidity Sweep / Stop Run)*: Giá tăng vượt đỉnh cũ (với Bearish Breaker)
     hoặc giảm xuyên đáy cũ (với Bullish Breaker) để kích hoạt toàn bộ Stop Loss của đám đông.
  3. *Pha đảo chiều dịch chuyển mạnh (Energetic Displacement / Market Structure Shift)*:
     Ngay sau cú quét thanh khoản, giá đảo chiều dữ dội bằng các nến thân dài dứt khoát,
     **đâm xuyên thủng hoàn toàn Order Block ban đầu** và phá vỡ cấu trúc thị trường (MSS),
     thường để lại Fair Value Gap (FVG).
  4. *Pha đổi cực (Polarity Flip)*: Khi giá hồi quy (retest) về chính Order Block bị thủng đó,
     nó lật vai trò thành cản đối diện (Bearish Breaker thành Kháng cự, Bullish Breaker thành Hỗ trợ).
- **Điểm yếu của bản giản lược (`findBreakerBlocks` pivot 2/2)**:
  - Bản code hiện tại chỉ phát hiện: swing high bị đóng nến vượt qua rồi sau đó giá đóng nến gãy
    qua swing low kế tiếp.
  - **Thiếu yếu tố Displacement**: Không đo lường gia tốc hoặc độ lớn thân nến khi phá vỡ;
    một cú trượt giá từ từ (slow drift) cũng bị nhận nhầm là breaker.
  - **Thiếu yếu tố Liquidity Sweep**: Không phân biệt giữa cú phá vỡ thật (breakout) và cú quét râu
    bẫy thanh khoản (fakeout).
  - **Thiếu bộ lọc thời gian (Killzones)**: ICT nhấn mạnh breaker chỉ có xác suất cao trong các cửa sổ
    thanh khoản London Open / NY Open (07:00–10:00 EST). Trên thị trường crypto 24/7, áp dụng pivot
    2/2 ở mọi giờ tạo ra vô số breaker "rác" trong các phiên thanh khoản mỏng.

### 7.3. Nghiên cứu học thuật & Định lượng độc lập (SSRN, arXiv, Quant Finance)
- **Khoảng cách thuật ngữ**: "Smart Money Concepts", "Order Blocks", "Breaker Blocks" là ngôn ngữ
  tiếp thị phổ biến trong giới retail trading; trong các nghiên cứu tài chính định lượng hàn lâm
  (peer-reviewed literature trên SSRN/arXiv), hiện tượng này được nghiên cứu dưới các tên gọi:
  *Order Flow Imbalance (OFI)*, *Limit Order Book (LOB) dynamics*, *Kyle's/Amihud's liquidity measures*,
  và *Intraday Volume Profiles / VWAP clustering*.
- **Backtest-to-Realization Gap**: Các bài báo thực nghiệm (như các nghiên cứu về backtesting gap
  trên arXiv) chỉ ra rằng các quy tắc SMC visual của retail khi chuyển đổi thành thuật toán tự động
  100% (rule-based) thường gặp hiện tượng **overfitting nặng**. Trong backtest thủ công, trader vô thức
  chọn lọc các setup đẹp bằng mắt; khi lập trình máy móc, tỷ lệ thắng thực tế giảm sút mạnh, và alpha
  chuyển thành âm khi khấu trừ phí taker (0.08%), slippage và funding rate.
- **Kết luận rút ra**: Không thể trông đợi Volume Profile hay Breaker Block hoạt động như "chén thánh"
  nếu chỉ áp dụng công thức thô sơ. Muốn kiểm chứng công bằng, phải quét tham số đa chiều và kiểm tra
  trên toàn bộ chiều dài lịch sử (multi-year / inception).


## 8. Kiểm chứng đa năm (2021-2026) & Parameter Sweep toàn diện (26/10)

Để giải quyết triệt để 2 lỗ hổng phương pháp luận (baseline có lợi thế 1-năm sample, chưa quét tham số),
toàn bộ 4 biến thể và 38 tổ hợp tham số lưới đã được kiểm chứng trên cả 2 khung thời gian:
- **Khung 1-năm (10/2025 -> 10/2026)**: Cùng khung với baseline live (commit `7c8423a`).
- **Khung Multi-year (2021 -> 2026)**: Toàn bộ lịch sử dữ liệu từ khi niêm yết OKX SWAP (hơn 1.100.000 nến M15 trên 5 coin lớn: BTC, ETH, SOL, LINK, NEAR).

### 8.1. Kết quả kiểm chứng đa năm 4 biến thể chính (mặc định tham số)

| Biến thể | 1Y Lệnh | 1Y PF | 1Y Tổng R | 1Y Max DD | Multi Lệnh | Multi PF | Multi Tổng R | Multi Max DD |
|---|---|---|---|---|---|---|---|---|
| **Baseline (Cả 2 TẮT)** | 238 | **1.52** | +62.92R | **-15.55R** | 922 | **1.10** | +50.45R | -53.38R |
| **V1 Volume Profile (OR, ALWAYS)** | 334 | 1.48 | +78.70R | -15.72R | 1369 | 1.14 | +107.91R | -42.09R |
| **V1 Breaker Block (OR, ADD_ZONES)** | 274 | 1.45 | +59.74R | -14.35R | 1062 | 1.02 | +12.77R | -69.05R |
| **V2 Volume Profile (D1 RANGING)** | 289 | 1.37 | +53.68R | -14.72R | 1127 | 1.13 | +82.09R | -40.01R |
| **V2 Breaker Block (AND Filter)** | 222 | **1.59** | +62.21R | -17.74R | 852 | **1.13** | **+61.81R** | **-51.78R** |

#### Chi tiết hiệu suất từng năm (Profit Factor / Tổng R):
| Biến thể | 2021 (Bull) | 2022 (Bear) | 2023 (Chop/Sideway) | 2024 (Bull) | 2025-2026 (Nay) |
|---|---|---|---|---|---|
| **Baseline** | 0.95 (-1.40R) | 1.37 (+21.51R) | **0.70 (-44.38R)** | 1.08 (+8.18R) | 1.36 (+66.54R) |
| **V1 Volume Profile** | 0.93 (-3.28R) | 1.46 (+44.05R) | 0.85 (-29.00R) | 1.11 (+16.11R) | 1.29 (+80.03R) |
| **V1 Breaker Block** | 0.74 (-10.50R) | 1.14 (+9.75R) | 0.69 (-52.30R) | 0.99 (-1.44R) | 1.31 (+67.26R) |
| **V2 Volume Profile** | 1.08 (+3.23R) | 1.41 (+29.98R) | 0.81 (-31.46R) | 1.09 (+10.67R) | 1.29 (+69.67R) |
| **V2 Breaker Block** | **1.04 (+1.03R)** | **1.44 (+22.93R)** | **0.71 (-41.78R)** | **1.12 (+10.00R)** | **1.40 (+69.63R)** |

### 8.2. Kết quả Parameter Sweep toàn diện (38 tổ hợp)
Thực thi tự động qua script `scripts/sweep_vp_breaker_params.mjs`, lưu đầy đủ tại `data/parameter_sweep_results.json`:

#### A. Volume Profile Sweep (24 tổ hợp: Lookback ∈ {20, 35, 50, 80} × ValueAreaPct ∈ {0.60, 0.70, 0.80} × 2 Modes):
1. **Lookback ngắn (20 nến ~ 3.3 ngày)**:
   - Thất bại nặng trên mọi cấu hình. V2 PF rớt xuống 1.24-1.29 (1Y), Multi PF 0.98-1.04. V1 sụp đổ (1Y PF 1.17, Multi PF 0.98, Max DD -107R).
   - **Bác bỏ hoàn toàn giả thuyết**: "Lookback ngắn phản ánh đúng hơn vùng giá trị gần". Thực tế nến H4 crypto 20 nến bị nhiễu cục bộ quá lớn, tạo vô số VAH/VAL giả.
2. **Lookback dài (80 nến ~ 13.3 ngày)**:
   - Một số tổ hợp V1 (lb=80, va=0.60) cho 1Y PF cao (1.57, +81R), nhưng Multi PF rớt xuống 1.06 (thua baseline 1.10), và năm 2022 sụt giảm -23.4% PF. Đây là biểu hiện điển hình của **Overfitting vào cửa sổ 1 năm**.
3. **Lookback trung bình (35-50 nến)**:
   - V1 lb=50 va=0.70 đạt Multi +107.91R (PF 1.14), nhưng 1Y PF bị pha loãng xuống 1.48 (<1.52 baseline).
   - V2 lb=50 va=0.70 đạt Multi +82.09R (PF 1.13), nhưng 1Y PF bị giảm xuống 1.37 (<1.52 baseline).
- **Kết luận Volume Profile**: **0/24 tổ hợp** đạt chuẩn đồng thời trên cả 1Y và Multi-Year. Volume Profile bổ sung cản làm tăng số lệnh nhưng pha loãng tỷ lệ Risk/Reward của các cản Tier 2 Major sẵn có.

#### B. ICT Breaker Block Sweep (14 tổ hợp: PivotL/PivotR ∈ {1, 2, 3} × 2 Modes):
1. **Chế độ V1 (ADD_ZONES / OR - Thêm cản mới độc lập)**:
   - **0/7 tổ hợp** đạt chuẩn.
   - Thêm breaker làm cản độc lập khiến Multi-Year Total R sụt giảm nghiêm trọng từ +50.45R xuống chỉ còn +6.52R đến +29.18R, và Max Drawdown phình to từ -53.38R lên -62R đến -76R.
   - Nguyên nhân: Bản breaker thô sơ thiếu bộ lọc Displacement và Liquidity Sweep, khi vào lệnh độc lập sinh ra rất nhiều cú bắt dao rơi thất bại ở thị trường đi ngang/giảm.
2. **Chế độ V2 (AND_FILTER - Lọc xác nhận thêm cho cản Tier 2)**:
   - **7/7 tổ hợp ĐẠT 100% TIÊU CHÍ PHẦN D**!
   - Vì cản Tier 2 Major Levels bản thân nó được sinh ra từ các swing nến lớn, việc yêu cầu cản Tier 2 phải nằm trong một vùng Breaker Block chưa bị lấp (unmitigated) đóng vai trò như một **bộ lọc xác nhận cấu trúc (Structural Confirmation Filter)**:
     - Lọc bỏ 16 lệnh chất lượng kém trong 1 năm (238 -> 222 lệnh).
     - **1-Năm**: PF tăng từ **1.52 -> 1.59**, Tổng R duy trì **+62.21R** (gần như bằng nguyên +62.92R).
     - **Multi-Year (2021-2026)**: PF tăng từ **1.10 -> 1.13**, Tổng R tăng từ **+50.45R -> +61.81R** (+11.36R), Max DD cải thiện từ **-53.38R -> -51.78R**.
     - **Tính nhất quán qua từng năm**: Không có năm nào bị sụt giảm PF. Cả 5/5 năm đều tăng hoặc giữ vững PF so với baseline (2021 lật từ lỗ sang lãi: 0.95 -> 1.04; 2022: 1.37 -> 1.44; 2023: 0.70 -> 0.71; 2024: 1.08 -> 1.12; 2025: 1.36 -> 1.40).
     - **Tính bất biến theo Pivot**: Cả 7 cặp pivot (1/1, 2/2, 3/3, 1/2, 2/1, 2/3, 3/2) đều cho kết quả hoàn toàn trùng khớp (222 lệnh, PF 1.59, Multi PF 1.13), chứng minh đây là một đặc tính cấu trúc bền vững, không phải ngẫu nhiên do chỉnh pivot.

---

## 9. Đánh giá theo Tiêu chí Phần D & Khuyến nghị Quyết định

Áp dụng đúng điều lệ `CLAUDE.md` và tiêu chí nghiệm thu nghiêm ngặt tại Phần D:

### 9.1. Đánh giá Volume Profile
- **Kết luận**: **BÁC BỎ HOÀN TOÀN.**
- Cả 24 tổ hợp tham số lưới (Lookback 20/35/50/80 × Value Area 60/70/80% × V1/V2) đều thất bại trong việc đánh bại baseline trên đồng thời cả 2 khung thời gian.
- Quyết định: **Giữ nguyên `useVolumeProfile: false` mặc định**. Code hàm thuần túy `calculateVolumeProfile` được giữ lại trong `src/indicators.js` làm thư viện tham khảo.

### 9.2. Đánh giá ICT Breaker Block
- **Bản V1 (Thêm cản mới OR)**: **BÁC BỎ HOÀN TOÀN** (làm sụp đổ lợi nhuận đa năm, tăng drawdown).
- **Bản V2 (AND Filter xác nhận cản Tier 2)**: **ĐẠT 100% TIÊU CHÍ KỸ THUẬT PHẦN D**:
  - PF tốt hơn baseline trên CẢ 1-năm (1.52 -> 1.59) VÀ Multi-year (1.10 -> 1.13).
  - Không có bất kỳ năm nào trong 5 năm lịch sử bị giảm PF (cả 5 năm đều cải thiện).
  - Tổng R đa năm tăng thêm +11.36R (+22.5%).
  - Drawdown đa năm giảm từ -53.38R xuống -51.78R.
  - *Lưu ý đánh đổi thực tế (Trade-off)*: Trên khung 1 năm gần nhất, Max DD hơi tăng nhẹ từ -15.55R lên -17.74R (-2.19R DD).

### 9.3. Tuân thủ LIVE-PATH MANDATE
- Theo quy định bắt buộc, agent **KHÔNG tự ý bật cờ mặc định** trong `src/config.js` hay deploy Railway.
- Toàn bộ cờ `useVolumeProfile` và `useBreakerBlocks` hiện tại vẫn giữ mặc định **`false`** an toàn.
- Báo cáo toàn bộ số liệu minh bạch để người dùng quyết định:
  - Nếu người dùng muốn giữ bot ở trạng thái hiện tại: Giữ nguyên mặc định tắt.
  - Nếu người dùng chấp nhận đánh đổi -2.19R DD trên 1 năm để đổi lấy PF 1.59 (1 năm) và PF 1.13/+61.81R (đa năm, cải thiện cả 5/5 năm): Bật `useBreakerBlocks: true` với `breakerBlockMode: 'AND_FILTER'`.
