import assert from "node:assert/strict";
const { analyzeCandleVision, detectAccumulationBreakout } = await import("../lib/candle-vision.ts");

console.log("Running candle vision unit tests...");

// Test 1: Nến xanh xung lực lớn (Bullish Expansion) -> isValidShortCandle phải false (CẤM SHORT)
{
  const candles = [];
  // 10 nến bình thường biên độ 5 giá
  for (let i = 0; i < 10; i++) {
    candles.push({ t: i * 60000, o: 100, h: 105, l: 98, c: 101, v: 1000, closed: true });
  }
  // Cây nến xanh khổng lồ bùng nổ (như cây nến ETH 21:00)
  candles.push({ t: 10 * 60000, o: 101, h: 125, l: 101, c: 124, v: 5000, closed: true });
  // Cây nến kế tiếp đi ngang nhẹ
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
  // Cây nến đỏ sập mạnh
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
  // Nến thọc sâu xuống 85 rồi rút chân đóng cửa 99 (râu dưới 14 giá trên biên độ 15 giá ~ 93%)
  candles.push({ t: 10 * 60000, o: 98, h: 100, l: 85, c: 99, v: 3000, closed: true });

  const vision = analyzeCandleVision(candles);
  assert.equal(vision.lastCandle.isPinbarBullish, true, "Phải nhận diện được Pinbar rút râu chuẩn");
  assert.equal(vision.isValidLongCandle, true, "Nến rút chân đạt chuẩn cho phép Long");
}

// Test 4: Mô hình Tích luỹ Hấp thụ Phá vỡ (Accumulation Breakout - chuẩn mẫu TIA)
{
  const candles = [];
  // 12 nến đi ngang trong hộp 0.526 - 0.535 (biên độ 1.7%)
  for (let i = 0; i < 14; i++) {
    candles.push({ t: i * 60000, o: 0.530, h: 0.535, l: 0.526, c: 0.531, v: 1000, closed: true });
  }
  // Cây nến phá vỡ: đóng 0.545 (vượt đỉnh hộp 0.535), nổ Volume 3500 (gấp 3.5 lần)
  candles.push({ t: 14 * 60000, o: 0.531, h: 0.546, l: 0.530, c: 0.545, v: 3500, closed: true });

  const ab = detectAccumulationBreakout(candles);
  assert.notEqual(ab, null, "Phải phát hiện được mô hình tích luỹ nén hộp bùng nổ TIA");
  assert.equal(ab?.side, 1);
  assert.equal(ab?.entry, 0.545);
  assert.ok(ab?.volumeRatio >= 1.5, "Volume ratio phải lớn hơn 1.5x");
  assert.ok(ab?.tp > ab?.entry, "TP phải cao hơn entry");
}

console.log("All candle vision unit tests passed successfully! ✅");
