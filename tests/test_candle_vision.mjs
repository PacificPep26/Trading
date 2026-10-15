import assert from "node:assert/strict";
const { analyzeCandleVision, detectAccumulationBreakout, detect5mEarlyTrigger } = await import("../lib/candle-vision.ts");

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

// Test 5: Mô hình Phân phối Thủng hộp (Distribution Breakdown Short)
{
  const candles = [];
  // 12 nến đi ngang trong hộp 2.10 - 2.16 (biên độ ~2.8%)
  for (let i = 0; i < 14; i++) {
    candles.push({ t: i * 60000, o: 2.12, h: 2.16, l: 2.10, c: 2.13, v: 1000, closed: true });
  }
  // Cây nến xả thủng đáy: đóng 2.05 (thủng đáy hộp 2.10), nổ Volume 3200 (gấp 3.2 lần), nến đỏ thân dài
  candles.push({ t: 14 * 60000, o: 2.11, h: 2.12, l: 2.04, c: 2.05, v: 3200, closed: true });

  const ab = detectAccumulationBreakout(candles);
  assert.notEqual(ab, null, "Phải phát hiện được mô hình phân phối thủng hộp Breakdown Short");
  assert.equal(ab?.side, -1, "Side phải là Short (-1)");
  assert.equal(ab?.entry, 2.05);
  assert.ok(ab?.volumeRatio >= 1.5, "Volume ratio phải lớn hơn 1.5x");
  assert.ok(ab?.tp < ab?.entry, "TP của Short phải thấp hơn entry");
}

// Test 6: Kích hoạt vào sớm 5M chuẩn (Nền 15m + Nến 5m nổ Vol 2.5x + Thân đặc)
{
  const bars15m = [];
  for (let i = 0; i < 15; i++) {
    bars15m.push({ t: i * 15 * 60000, o: 100, h: 102, l: 99, c: 101, v: 5000, closed: true });
  }

  const bars5m = [];
  for (let i = 0; i < 15; i++) {
    bars5m.push({ t: i * 5 * 60000, o: 100.5, h: 101.5, l: 99.5, c: 101, v: 1000, closed: true });
  }
  // Cây nến 5m breakout: đục phá đỉnh 102, đóng 102.8, Vol 2800 (gấp 2.8 lần), thân nến 75%
  bars5m.push({ t: 15 * 5 * 60000, o: 101, h: 103, l: 100.8, c: 102.8, v: 2800, closed: true });

  const early = detect5mEarlyTrigger(bars15m, bars5m);
  assert.notEqual(early, null, "Phải bắt được tín hiệu kích hoạt sớm 5M đạt chuẩn");
  assert.equal(early?.side, 1);
  assert.equal(early?.entry, 102.8);
  assert.ok(early?.volumeRatio >= 1.8, "Volume phải gấp ít nhất 1.8x");
}

// Test 7: CHỐNG BOM HÀNG: Nến 5m vượt đỉnh nhưng Vol yếu (dưới 1.8x) hoặc râu trên xả dài -> Phải bị từ chối (null)!
{
  const bars15m = [];
  for (let i = 0; i < 15; i++) {
    bars15m.push({ t: i * 15 * 60000, o: 100, h: 102, l: 99, c: 101, v: 5000, closed: true });
  }

  const bars5m = [];
  for (let i = 0; i < 15; i++) {
    bars5m.push({ t: i * 5 * 60000, o: 100.5, h: 101.5, l: 99.5, c: 101, v: 1000, closed: true });
  }
  // Cây nến 5m vượt đỉnh nhưng bị đạp râu trên dài (Shooting Star lừa gà): H 103.5, C 102.1 (râu trên 1.4 giá trên biên 2.7 giá ~ 52%)
  bars5m.push({ t: 15 * 5 * 60000, o: 101.5, h: 103.5, l: 100.8, c: 102.1, v: 2800, closed: true });

  const earlyTrap = detect5mEarlyTrigger(bars15m, bars5m);
  assert.equal(earlyTrap, null, "Chống bom hàng: nến 5m râu trên dài bị đạp phải bị loại bỏ!");
}

console.log("All candle vision unit tests passed successfully! ✅");
