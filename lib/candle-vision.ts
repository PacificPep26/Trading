import type { Candle } from "./okx";

export type CandleVision = {
  isBullishMomentum: boolean; // 1-2 nến gần nhất là nến xanh xung lực lớn (bơm mạnh)
  isBearishMomentum: boolean; // 1-2 nến gần nhất là nến đỏ xung lực lớn (xả mạnh)
  lastCandle: {
    isGreen: boolean;
    isRed: boolean;
    bodyPct: number; // Thân nến chiếm bao nhiêu % biên độ
    upperWickPct: number; // Râu trên chiếm bao nhiêu % biên độ
    lowerWickPct: number; // Râu dưới chiếm bao nhiêu % biên độ
    isPinbarBullish: boolean; // Rút râu dưới >= 55%
    isPinbarBearish: boolean; // Rút râu trên >= 55%
    isMarubozuBullish: boolean; // Thân xanh đặc >= 70% không râu trên
    isMarubozuBearish: boolean; // Thân đỏ đặc >= 70% không râu dưới
  };
  isValidShortCandle: boolean; // Nến đạt chuẩn để Short (không bị nến xanh đục cản, có từ chối rõ ràng)
  isValidLongCandle: boolean; // Nến đạt chuẩn để Long (không bị nến đỏ cắm đầu, có rút chân rõ ràng)
};

/**
 * 👁️ BỘ MẮT ĐỌC NẾN (CANDLE VISION)
 * Phân tích hành vi, hình thái và bối cảnh cụm nến trước khi phát tín hiệu.
 * Ngăn chặn tuyệt đối việc Short chặn đầu xe lửa hoặc Long bắt dao rơi!
 */
export function analyzeCandleVision(rawCandles: Candle[]): CandleVision {
  const cs = rawCandles.filter((c) => c.closed !== false);
  const n = cs.length;

  if (n < 5) {
    return {
      isBullishMomentum: false,
      isBearishMomentum: false,
      lastCandle: {
        isGreen: true,
        isRed: false,
        bodyPct: 50,
        upperWickPct: 25,
        lowerWickPct: 25,
        isPinbarBullish: false,
        isPinbarBearish: false,
        isMarubozuBullish: false,
        isMarubozuBearish: false,
      },
      isValidShortCandle: true,
      isValidLongCandle: true,
    };
  }

  // 1. Phân tích cây nến vừa đóng (lastCandle)
  const c = cs[n - 1];
  const rng = Math.max(0.000001, c.h - c.l);
  const body = Math.abs(c.c - c.o);
  const isGreen = c.c >= c.o;
  const isRed = c.c < c.o;
  const upperWick = c.h - Math.max(c.o, c.c);
  const lowerWick = Math.min(c.o, c.c) - c.l;

  const bodyPct = (body / rng) * 100;
  const upperWickPct = (upperWick / rng) * 100;
  const lowerWickPct = (lowerWick / rng) * 100;

  const isPinbarBullish = lowerWickPct >= 55 && upperWickPct <= 25;
  const isPinbarBearish = upperWickPct >= 55 && lowerWickPct <= 25;
  const isMarubozuBullish = isGreen && bodyPct >= 65 && upperWickPct <= 15;
  const isMarubozuBearish = isRed && bodyPct >= 65 && lowerWickPct <= 15;

  // 2. Phân tích xung lực 3 cây nến gần nhất (Momentum Context)
  // Tính biên độ trung bình (ATR xấp xỉ) của 10 nến trước đó
  const prev10 = cs.slice(Math.max(0, n - 11), n - 1);
  const avgRange = prev10.reduce((s, x) => s + (x.h - x.l), 0) / Math.max(1, prev10.length);

  // Nến xanh xung lực lớn (Bullish Expansion): nến xanh có thân > 1.25 * avgRange
  // Hoặc 2 nến xanh liên tiếp đẩy mạnh
  const recent3 = cs.slice(Math.max(0, n - 3), n);
  const hasBigGreenBar = recent3.some((x) => x.c > x.o && x.c - x.o >= 1.25 * avgRange);
  const consecutiveGreen = recent3.length >= 2 && recent3.slice(-2).every((x) => x.c > x.o);
  const isBullishMomentum = hasBigGreenBar || (consecutiveGreen && isGreen);

  // Nến đỏ xung lực lớn (Bearish Waterfall): nến đỏ có thân > 1.25 * avgRange
  const hasBigRedBar = recent3.some((x) => x.c < x.o && x.o - x.c >= 1.25 * avgRange);
  const consecutiveRed = recent3.length >= 2 && recent3.slice(-2).every((x) => x.c < x.o);
  const isBearishMomentum = hasBigRedBar || (consecutiveRed && isRed);

  // 3. Đánh giá tính hợp lệ cho lệnh SHORT:
  // - CẤM SHORT nếu vừa có nến xanh xung lực lớn (đang bơm)
  // - CẤM SHORT nếu nến vừa đóng là nến xanh đặc ruột (Marubozu) đóng sát đỉnh
  // - Muốn Short: Nến phải đóng đỏ HOẶC có râu trên từ chối rõ ràng (upperWickPct >= 50%)
  const isValidShortCandle = !isBullishMomentum && !isMarubozuBullish && (isRed || upperWickPct >= 50);

  // 4. Đánh giá tính hợp lệ cho lệnh LONG:
  // - CẤM LONG nếu vừa có nến đỏ xả thác lũ chưa có nến hấp thụ
  // - CẤM LONG nếu nến vừa đóng là nến đỏ đặc ruột (Marubozu) cắm xuống đáy
  // - Muốn Long: Nến phải đóng xanh HOẶC có râu dưới rút chân rõ ràng (lowerWickPct >= 50%)
  const isValidLongCandle = !isBearishMomentum && !isMarubozuBearish && (isGreen || lowerWickPct >= 50);

  return {
    isBullishMomentum,
    isBearishMomentum,
    lastCandle: {
      isGreen,
      isRed,
      bodyPct,
      upperWickPct,
      lowerWickPct,
      isPinbarBullish,
      isPinbarBearish,
      isMarubozuBullish,
      isMarubozuBearish,
    },
    isValidShortCandle,
    isValidLongCandle,
  };
}
