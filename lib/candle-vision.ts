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
    isMarubozuBullish: boolean; // Thân xanh đặc >= 65% không râu trên
    isMarubozuBearish: boolean; // Thân đỏ đặc >= 65% không râu dưới
  };
  isValidShortCandle: boolean; // Nến đạt chuẩn để Short (không bị nến xanh đục cản, có từ chối rõ ràng)
  isValidLongCandle: boolean; // Nến đạt chuẩn để Long (không bị nến đỏ cắm đầu, có rút chân rõ ràng)
};

export type AccumulationBreakout = {
  side: 1 | -1;
  boxHigh: number;
  boxLow: number;
  breakoutPrice: number;
  entry: number;
  stop: number;
  tp: number;
  volumeRatio: number;
  barTime: number;
  note: string;
};

/**
 * 👁️ BỘ MẮT ĐỌC NẾN (CANDLE VISION)
 * Phân tích hành vi, hình thái và bối cảnh cụm nến trước khi phát tín hiệu.
 * Đúc kết từ 16 Video Price Action Mastery (Trade IQ / Graystone / Wyckoff).
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

/**
 * Tạo chuỗi tóm tắt giải phẫu nến gọn gàng cho tin báo Telegram
 * Ví dụ: M15 [18:15]: Xanh (Thân 71% · Râu dưới 20% · 2.1x Vol)
 */
export function formatCandleSummary(tf: string, cs: Candle[], vision: CandleVision): string {
  const closed = cs.filter((c) => c.closed !== false);
  const last = closed.at(-1);
  if (!last) return "";
  const d = new Date(last.t);
  const vnHours = String((d.getUTCHours() + 7) % 24).padStart(2, "0");
  const vnMins = String(d.getUTCMinutes()).padStart(2, "0");
  const timeStr = `${vnHours}:${vnMins}`;

  const prev10 = closed.slice(-11, -1);
  const avgVol = prev10.length > 0 ? prev10.reduce((s, x) => s + (x.v || 0), 0) / prev10.length : 0;
  const volRatio = avgVol > 0 && (last.v || 0) > 0 ? ((last.v || 0) / avgVol).toFixed(1) + "x Vol" : "";

  const color = vision.lastCandle.isGreen ? "Xanh" : "Đỏ";
  const body = `Thân ${vision.lastCandle.bodyPct.toFixed(0)}%`;
  const wick = vision.lastCandle.isGreen
    ? `Râu dưới ${vision.lastCandle.lowerWickPct.toFixed(0)}%`
    : `Râu trên ${vision.lastCandle.upperWickPct.toFixed(0)}%`;

  return `${tf} [${timeStr}]: ${color} (${body} · ${wick}${volRatio ? ` · ${volRatio}` : ""})`;
}

/**
 * 📦 NHẬN DIỆN MÔ HÌNH TÍCH LUỸ HẤP THỤ PHÁ VỠ (ACCUMULATION BREAKOUT)
 * Đúng mẫu hình con TIA: Đi ngang nén biên độ hẹp >= 8 nến, volume cạn kiệt,
 * sau đó xuất hiện nến xanh Breakout đóng vượt đỉnh hộp kèm Volume bùng nổ >= 1.35x TB!
 */
export function detectAccumulationBreakout(rawCandles: Candle[]): AccumulationBreakout | null {
  const cs = rawCandles.filter((c) => c.closed !== false);
  const n = cs.length;
  if (n < 12) return null;

  const last = cs[n - 1]; // nến vừa đóng
  // Kiểm tra nến cuối phải là nến xanh đục cản (Bullish Breakout)
  if (last.c <= last.o) return null;

  // Lấy hộp tích luỹ gồm 10 đến 16 nến trước đó
  const boxLength = 10;
  const box = cs.slice(n - 1 - boxLength, n - 1);
  if (box.length < boxLength) return null;

  const boxHigh = Math.max(...box.map((b) => b.h));
  const boxLow = Math.min(...box.map((b) => b.l));
  const boxRange = boxHigh - boxLow;

  // 1. Biên độ nén phải hẹp (Contraction / Squeeze): <= 4.5% biên độ giá
  if (boxRange / boxLow > 0.045) return null;

  // 2. Nến cuối cùng phải đóng dứt khoát TRÊN đỉnh hộp tích luỹ
  if (last.c <= boxHigh) return null;

  // Thân nến breakout phải chiếm >= 55% toàn bộ cây nến (nến xung lực, không phải râu giả)
  const rng = last.h - last.l;
  if (rng <= 0 || (last.c - last.o) < 0.55 * rng) return null;

  // 3. Phân tích Volume (VPA - Ep 7): Volume cây nến phá vỡ phải vọt cao >= 1.35x Volume trung bình của cả hộp
  const avgBoxVol = box.reduce((s, x) => s + (x.v || 0), 0) / box.length;
  const volRatio = avgBoxVol > 0 ? (last.v || 0) / avgBoxVol : 1;
  if (volRatio < 1.35) return null;

  // 4. Thiết lập Kèo vào lệnh:
  const entry = last.c;
  const stop = boxLow - 0.002 * boxLow; // SL đặt dưới đáy hộp tích luỹ
  const risk = (entry - stop) / entry;
  if (risk < 0.005 || risk > 0.05) return null; // Risk an toàn từ 0.5% đến 5%

  const tp = entry + 2 * (entry - stop); // TP mục tiêu tối thiểu 2R

  return {
    side: 1,
    boxHigh,
    boxLow,
    breakoutPrice: boxHigh,
    entry,
    stop,
    tp,
    volumeRatio: +volRatio.toFixed(1),
    barTime: last.t,
    note: `Tích luỹ nén hộp ${boxLength} nến (biên ${(boxRange / boxLow * 100).toFixed(1)}%), nến xanh Breakout nổ Vol ${volRatio.toFixed(1)}x`,
  };
}
