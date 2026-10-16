import assert from "node:assert/strict";
const { analyzeCandleVision, detectAccumulationBreakout, detectHtfBreakout, isPriceInNoMansLand } = await import("../lib/candle-vision.ts");

console.log("Running candle vision unit tests...");

// Test 1: Nến xanh xung lực lớn (Bullish Expansion) -> isValidShortCandle phải false (CẤM SHORT)
{
  const candles = [];
  for (let i = 0; i < 10; i++) {
    candles.push({ t: i * 60000, o: 100, h: 105, l: 98, c: 101, v: 1000, closed: true });
  }
  candles.push({ t: 10 * 60000, o: 101, h: 125, l: 101, c: 124, v: 5000, closed: true });
  candles.push({ t: 11 * 60000, o: 124, h: 126, l: 123, c: 124, v: 1500, closed: true });

  const vision = analyzeCandleVision(candles);
  assert.equal(vision.isBullishMomentum, true, "Phải nhận diện được nến xanh xung lực lớn");
  assert.equal(vision.isValidShortCandle, false, "CẤM SHORT khi vừa có nến xanh bùng nổ!");
}

// Test 2: Nến đỏ xả thác lũ (Bearish Waterfall) -> isValidLongCandle phải false (CẤM LONG bắt dao rơi)
{
  const candles = [];
  for (let i = 0; i < 10; i++) {
    candles.push({ t: i * 60000, o: 100, h: 103, l: 98, c: 100, v: 1000, closed: true });
  }
  candles.push({ t: 10 * 60000, o: 100, h: 100, l: 80, c: 81, v: 5000, closed: true });

  const vision = analyzeCandleVision(candles);
  assert.equal(vision.isBearishMomentum, true, "Phải nhận diện được nến đỏ xả mạnh");
  assert.equal(vision.isValidLongCandle, false, "CẤM LONG khi vừa có nến đỏ xả thác lũ chưa hấp thụ!");
}

// Test 3: Nến Pin Bar rút râu chuẩn (Đảo chiều tạo đáy) -> isValidLongCandle = true
{
  const candles = [];
  for (let i = 0; i < 10; i++) {
    candles.push({ t: i * 60000, o: 100, h: 102, l: 98, c: 99, v: 1000, closed: true });
  }
  candles.push({ t: 10 * 60000, o: 98, h: 100, l: 85, c: 99, v: 3000, closed: true });

  const vision = analyzeCandleVision(candles);
  assert.equal(vision.lastCandle.isPinbarBullish, true, "Phải nhận diện được Pinbar rút râu chuẩn");
  assert.equal(vision.isValidLongCandle, true, "Nến rút chân đạt chuẩn cho phép Long");
}

// Test 4: Mô hình Bùng nổ Phá vỡ Khung Lớn 1H (HTF VPA Real Breakout - Ep 7 & Ep 8)
{
  const candles = [];
  // 24 nến 1H đi ngang tích luỹ trong hộp 0.520 - 0.535 (biên độ ~2.8%)
  for (let i = 0; i < 25; i++) {
    candles.push({ t: i * 3600000, o: 0.528, h: 0.535, l: 0.520, c: 0.529, v: 1000, closed: true });
  }
  // Cây nến 1H phá vỡ: đóng 0.545 (vượt đỉnh hộp 0.535), nổ Volume 3500 (gấp 3.5 lần), thân đặc 80%, râu trên cực ngắn
  candles.push({ t: 25 * 3600000, o: 0.528, h: 0.547, l: 0.527, c: 0.545, v: 3500, closed: true });

  const ab = detectHtfBreakout(candles);
  assert.notEqual(ab, null, "Phải phát hiện được mô hình 1H VPA Breakout");
  assert.equal(ab?.side, 1);
  assert.equal(ab?.entry, 0.545);
  assert.ok(ab?.volumeRatio >= 1.8, "Volume ratio phải lớn hơn 1.8x");
  assert.ok(ab?.tp > ab?.entry, "TP phải cao hơn entry");
}

// Test 5: Mô hình 1H Breakdown Phân phối Thủng hộp xả Vol
{
  const candles = [];
  // 24 nến 1H đi ngang trong hộp 2.10 - 2.18 (biên độ ~3.8%)
  for (let i = 0; i < 25; i++) {
    candles.push({ t: i * 3600000, o: 2.14, h: 2.18, l: 2.10, c: 2.13, v: 1000, closed: true });
  }
  // Cây nến 1H xả thủng đáy: đóng 2.03 (thủng đáy hộp 2.10), nổ Volume 3200 (gấp 3.2 lần), nến đỏ thân dài
  candles.push({ t: 25 * 3600000, o: 2.12, h: 2.13, l: 2.02, c: 2.03, v: 3200, closed: true });

  const ab = detectHtfBreakout(candles);
  assert.notEqual(ab, null, "Phải phát hiện được mô hình 1H Breakdown xả thủng hộp");
  assert.equal(ab?.side, -1, "Side phải là Short (-1)");
  assert.equal(ab?.entry, 2.03);
  assert.ok(ab?.volumeRatio >= 1.8, "Volume ratio phải lớn hơn 1.8x");
  assert.ok(ab?.tp < ab?.entry, "TP của Short phải thấp hơn entry");
}

// Test 6: CHỐNG BẪY (No Demand Trap - Ep 7): Vượt đỉnh nhưng Volume teo tóp (< 1.8x) -> Phải bị TỪ CHỐI (null)!
{
  const candles = [];
  for (let i = 0; i < 25; i++) {
    candles.push({ t: i * 3600000, o: 100, h: 102, l: 98, c: 100, v: 5000, closed: true });
  }
  // Cây nến 1H nhú qua đỉnh 102 lên 102.5, nhưng Volume chỉ có 5500 (chỉ 1.1x TB, như cây SUI 8h sáng)
  candles.push({ t: 25 * 3600000, o: 100, h: 102.8, l: 99.8, c: 102.5, v: 5500, closed: true });

  const trap = detectHtfBreakout(candles);
  assert.equal(trap, null, "Bẫy thiếu cầu (No Demand Trap): Nến vượt đỉnh nhưng thiếu Volume phải bị CHẶN HOÀN TOÀN!");
}

// Test 7: BỘ LỌC VÙNG LƠ LỬNG (No Man's Land Filter)
{
  const candles = [];
  // Giá dao động trong biên 100 - 120 (biên 20 giá)
  for (let i = 0; i < 30; i++) {
    candles.push({ t: i * 3600000, o: 110, h: 120, l: 100, c: 110, v: 1000, closed: true });
  }
  // Giá hiện tại ở 110 (cách đỉnh 120 là 9%, cách đáy 100 là 10% -> lơ lửng ở giữa)
  const isNoMan = isPriceInNoMansLand(candles);
  assert.equal(isNoMan, true, "Giá đang ở lưng chừng vùng chop phải được nhận diện là No Man's Land");
}

console.log("All candle vision unit tests passed successfully! ✅");
