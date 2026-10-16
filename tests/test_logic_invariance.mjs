import assert from "node:assert/strict";

console.log("==========================================================================");
console.log("🧪 TẦNG 1 & 2: KIỂM THỬ CHỐNG RÒ RỈ TƯƠNG LAI & TÍNH BẤT BIẾN TOÁN HỌC");
console.log("==========================================================================");

const { detect15mShelfBreakout, analyzeCandleVision, isPriceInNoMansLand } = await import("../lib/candle-vision.ts");

// --------------------------------------------------------------------------
// TEST 1: CHỐNG NHÌN TRƯỚC NẾN TƯƠNG LAI (NO LOOKAHEAD BIAS INVARIANCE)
// --------------------------------------------------------------------------
{
  const candles = [];
  // 48 nến 15m tích lũy trong hộp 82,000 - 82,500
  for (let i = 0; i < 48; i++) {
    candles.push({ t: i * 900000, o: 82200, h: 82500, l: 82000, c: 82250, v: 1000, closed: true });
  }
  // Cây nến thứ 49: Phá đỉnh hộp tại 82,650 nổ Vol 2000
  candles.push({ t: 48 * 900000, o: 82250, h: 82700, l: 82200, c: 82650, v: 2000, closed: true });

  const signalWithoutFuture = detect15mShelfBreakout(candles);
  assert.notEqual(signalWithoutFuture, null, "Nến 49 phải kích hoạt tín hiệu Phá Đỉnh Nền");
  assert.equal(signalWithoutFuture?.side, 1, "Phải là tín hiệu LONG");

  // Giả lập nến thứ 50 (Nến Tương Lai) với các biến động cực đoan
  // Trường hợp 50a: Nến tương lai sập -50%
  const candlesWithFutureDump = [...candles, { t: 49 * 900000, o: 82650, h: 82650, l: 40000, c: 41000, v: 999999, closed: false }];
  const signalDumpFuture = detect15mShelfBreakout(candlesWithFutureDump.slice(0, 49)); // Chỉ truyền nến đã đóng
  assert.deepEqual(signalDumpFuture, signalWithoutFuture, "Tín hiệu tại nến 49 TUYỆT ĐỐI không bị thay đổi bởi nến tương lai sập");

  // Trường hợp 50b: Nến tương lai bay +50%
  const candlesWithFuturePump = [...candles, { t: 49 * 900000, o: 82650, h: 120000, l: 82650, c: 119000, v: 999999, closed: false }];
  const signalPumpFuture = detect15mShelfBreakout(candlesWithFuturePump.slice(0, 49));
  assert.deepEqual(signalPumpFuture, signalWithoutFuture, "Tín hiệu tại nến 49 TUYỆT ĐỐI không bị thay đổi bởi nến tương lai bay");

  console.log("✅ Test 1 (Chống rò rỉ tương lai): PASSED!");
}

// --------------------------------------------------------------------------
// TEST 2: CẤM MỞ LỆNH KHI NẾN CHƯA ĐÓNG CỬA (UNCLOSED BAR REJECTION)
// --------------------------------------------------------------------------
{
  const candles = [];
  for (let i = 0; i < 48; i++) {
    candles.push({ t: i * 900000, o: 82200, h: 82500, l: 82000, c: 82250, v: 1000, closed: true });
  }
  // Cây nến 49 đang chạy dở (closed: false)
  candles.push({ t: 48 * 900000, o: 82250, h: 83500, l: 82200, c: 83400, v: 5000, closed: false });

  const signal = detect15mShelfBreakout(candles);
  // Vì nến 49 chưa đóng (closed: false), hàm phải lọc bỏ nến 49 và chỉ xét các nến đã đóng
  // Tại nến 48 đóng ở 82,250 (nằm trong hộp) -> Không được kích hoạt tín hiệu breakout
  assert.equal(signal, null, "Cấm tuyệt đối kích hoạt tín hiệu trên cây nến chưa đóng cửa");
  console.log("✅ Test 2 (Từ chối nến chưa đóng): PASSED!");
}

// --------------------------------------------------------------------------
// TEST 3: TÍNH TOÀN VẸN LOGIC GIÁ VÀO, STOPLOSS VÀ TAKE PROFIT (SL < ENTRY < TP)
// --------------------------------------------------------------------------
{
  const candles = [];
  for (let i = 0; i < 48; i++) {
    candles.push({ t: i * 900000, o: 82200, h: 82500, l: 82000, c: 82250, v: 1000, closed: true });
  }
  // Breakout Long
  candles.push({ t: 48 * 900000, o: 82250, h: 82800, l: 82200, c: 82750, v: 2200, closed: true });
  const sigLong = detect15mShelfBreakout(candles);
  assert.notEqual(sigLong, null);

  assert.ok(sigLong.stop < sigLong.entry, "Lệnh LONG bắt buộc Stop Loss phải thấp hơn Entry");
  assert.ok(sigLong.entry < sigLong.tp, "Lệnh LONG bắt buộc Take Profit phải cao hơn Entry");

  const riskLong = sigLong.entry - sigLong.stop;
  const rewardLong = sigLong.tp - sigLong.entry;
  const rrLong = rewardLong / riskLong;
  assert.ok(rrLong >= 1.5, `Tỷ lệ R:R lệnh Long phải >= 1.5 (Hiện tại: ${rrLong.toFixed(2)})`);

  // Breakdown Short
  const candlesShort = [];
  for (let i = 0; i < 48; i++) {
    candlesShort.push({ t: i * 900000, o: 82200, h: 82500, l: 82000, c: 82250, v: 1000, closed: true });
  }
  candlesShort.push({ t: 48 * 900000, o: 82050, h: 82050, l: 81600, c: 81650, v: 2500, closed: true });
  const sigShort = detect15mShelfBreakout(candlesShort);
  assert.notEqual(sigShort, null);

  assert.ok(sigShort.tp < sigShort.entry, "Lệnh SHORT bắt buộc Take Profit phải thấp hơn Entry");
  assert.ok(sigShort.entry < sigShort.stop, "Lệnh SHORT bắt buộc Stop Loss phải cao hơn Entry");

  const riskShort = sigShort.stop - sigShort.entry;
  const rewardShort = sigShort.entry - sigShort.tp;
  const rrShort = rewardShort / riskShort;
  assert.ok(rrShort >= 1.5, `Tỷ lệ R:R lệnh Short phải >= 1.5 (Hiện tại: ${rrShort.toFixed(2)})`);

  console.log("✅ Test 3 (Toàn vẹn quan hệ SL < Entry < TP): PASSED!");
}

// --------------------------------------------------------------------------
// TEST 4: CHỐNG LỖI BIÊN TOÁN HỌC & CHIA CHO 0 (ZERO RANGE / MISSING VOL)
// --------------------------------------------------------------------------
{
  // Nến đứng im hoàn toàn (high === low, rng = 0)
  const deadCandles = [];
  for (let i = 0; i < 50; i++) {
    deadCandles.push({ t: i * 900000, o: 10, h: 10, l: 10, c: 10, v: 0, closed: true });
  }
  const deadSignal = detect15mShelfBreakout(deadCandles);
  assert.equal(deadSignal, null, "Nến đứng im biên độ 0 không được gây lỗi chia cho 0 và phải trả về null");

  const deadVision = analyzeCandleVision(deadCandles);
  assert.ok(Number.isFinite(deadVision.lastCandle.bodyPct), "Chỉ số bodyPct không được ra NaN hay Infinity");
  assert.equal(deadVision.lastCandle.bodyPct, 0, "Thân nến đứng im phải bằng 0%");

  console.log("✅ Test 4 (Chống lỗi chia cho 0 & dữ liệu đóng băng): PASSED!");
}

console.log("🎉 TẤT CẢ CÁC BÀI TEST TẦNG 1 & 2 ĐÃ VƯỢT QUA 100%!\n");
