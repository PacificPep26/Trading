import type { Candle } from "./okx";

export type CandleVision = {
  isBullishMomentum: boolean; // 1-2 nến gần nhất là nến xanh xung lực lớn (bơm mạnh)
  isBearishMomentum: boolean; // 1-2 nến gần nhất là nến đỏ xung lực lớn (xả mạnh)
  warningNote?: string; // Cảnh báo bẫy tâm lý / hành vi (mua đuổi đỉnh nến, quét râu, v.v.)
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
  tp1?: number;
  tp2?: number;
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

  // 5. Cảnh báo hành vi & bẫy cá mập (Đúc kết từ chuỗi Video Price Action & Yin TP Trade):
  let warningNote: string | undefined = undefined;
  if (isGreen && upperWickPct >= 40 && bodyPct >= 30) {
    warningNote = "⚠️ Bẫy mua đuổi đỉnh nến (FOMO Trap) - Râu trên dài";
  } else if (isRed && lowerWickPct >= 40 && bodyPct >= 30) {
    warningNote = "⚠️ Bẫy bán tháo đáy nến - Rút chân gom hàng ngầm";
  } else if (isBullishMomentum && isMarubozuBullish) {
    warningNote = "🚀 Xung lực tăng mạnh - CẤM CHẶN ĐẦU SHORT";
  } else if (isBearishMomentum && isMarubozuBearish) {
    warningNote = "🩸 Xung lực xả mạnh - CẤM BẮT ĐÁY LONG";
  }

  return {
    isBullishMomentum,
    isBearishMomentum,
    warningNote,
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

  const warning = vision.warningNote ? `\n⚠️ ${vision.warningNote}` : "";

  return `${tf} [${timeStr}]: ${color} (${body} · ${wick}${volRatio ? ` · ${volRatio}` : ""})${warning}`;
}

/**
 * 📦 NHẬN DIỆN MÔ HÌNH BÙNG NỔ PHÁ VỠ KHUNG LỚN 1H (HTF VPA REAL BREAKOUT - Ep 7 & Ep 8)
 * Theo đúng tri thức 16 video Price Action & chỉ đạo của Victor:
 * 1. Khung thời gian: BẮT BUỘC là nến 1H (không soi nến 15m/5m vì dễ dính bẫy nhiễu).
 * 2. Thời gian nén hộp (Consolidation): Nén từ 14 đến 36 nến 1H (tức 14 đến 36 tiếng tích luỹ thật sự).
 * 3. Biên độ nén: Hộp nén rõ ràng từ 2.0% đến 7.5% (không bắt hộp tí hon 1% tạo tín hiệu ảo).
 * 4. KHỐI LƯỢNG BÙNG NỔ (VPA - Ep 7 & 8): Nến 1H phá cản BẮT BUỘC Volume >= 1.8x trung bình 20 nến 1H trước!
 *    - CHỐNG BẪY (Ep 7 & 9 - No Demand Trap): Nếu giá nhú qua đỉnh nhưng Volume < 1.3x TB -> BẪY PHÁ VỠ GIẢ -> CHẶN NGAY.
 * 5. HÌNH THÁI NẾN 1H (Ep 4 & Ep 8): Thân nến đặc >= 60% biên độ, đóng nến sát đỉnh (râu trên <= 18%).
 */
export function detectHtfBreakout(rawCandles1h: Candle[]): AccumulationBreakout | null {
  const cs = rawCandles1h.filter((c) => c.closed !== false);
  const n = cs.length;
  if (n < 25) return null;

  const last = cs[n - 1]; // nến 1H vừa đóng
  const boxLength = Math.min(24, n - 2); // soi hộp từ 14 đến 24 nến 1H (~1 ngày tích luỹ)
  if (boxLength < 14) return null;

  const box = cs.slice(n - 1 - boxLength, n - 1);
  const boxHigh = Math.max(...box.map((b) => b.h));
  const boxLow = Math.min(...box.map((b) => b.l));
  const boxRange = boxHigh - boxLow;

  // 1. Biên độ hộp phải có ý nghĩa (2.0% đến 7.5%)
  const boxRatio = boxRange / boxLow;
  if (boxRatio < 0.02 || boxRatio > 0.075) return null;

  const rng = last.h - last.l;
  if (rng <= 0) return null;

  // 2. Phân tích Khối Lượng VPA (Ep 7 & 8): So sánh với trung bình 20 nến 1H trước
  const prev20 = cs.slice(Math.max(0, n - 21), n - 1);
  const avgVol = prev20.reduce((s, x) => s + (x.v || 0), 0) / prev20.length;
  const volRatio = avgVol > 0 ? (last.v || 0) / avgVol : 1;

  // 🟢 CHIỀU 1: BREAKOUT LONG (Nến 1H phá đỉnh hộp tích luỹ)
  if (last.c > last.o && last.c > boxHigh) {
    // CHỐNG BẪY (No Demand Trap - Ep 7): Giá vượt đỉnh nhưng Volume không đạt >= 1.8x -> BẪY CÁ MẬP XẢ
    if (volRatio < 1.8) return null;

    const body = last.c - last.o;
    const upperWick = last.h - last.c;
    // Thân nến xanh phải đặc >= 60% và râu trên <= 18% (không bị đạp đầu xả ngược)
    if (body < 0.60 * rng || upperWick > 0.18 * rng) return null;

    const entry = last.c;
    const stop = Math.max(boxLow, last.l - 0.002 * last.l); // SL dưới đáy hộp hoặc dưới đáy nến 1H phá cản
    const risk = (entry - stop) / entry;
    if (risk < 0.005 || risk > 0.065) return null;
    const tp = entry + 2 * (entry - stop); // TP 2R

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
      note: `1H Tích luỹ ${boxLength} nến (biên ${(boxRatio * 100).toFixed(1)}%), nến 1H nổ Vol ${volRatio.toFixed(1)}x vượt đỉnh hộp`,
    };
  }

  // 🔴 CHIỀU 2: BREAKDOWN SHORT (Nến 1H sụp đổ đục thủng đáy hộp)
  if (last.c < last.o && last.c < boxLow) {
    if (volRatio < 1.8) return null;

    const body = last.o - last.c;
    const lowerWick = last.c - last.l;
    // Thân nến đỏ phải đặc >= 60% và râu dưới <= 18% (không có dấu hiệu rút chân gom hàng)
    if (body < 0.60 * rng || lowerWick > 0.18 * rng) return null;

    const entry = last.c;
    const stop = Math.min(boxHigh, last.h + 0.002 * last.h); // SL trên đỉnh hộp
    const risk = (stop - entry) / entry;
    if (risk < 0.005 || risk > 0.065) return null;
    const tp = entry - 2 * (stop - entry); // TP 2R

    return {
      side: -1,
      boxHigh,
      boxLow,
      breakoutPrice: boxLow,
      entry,
      stop,
      tp,
      volumeRatio: +volRatio.toFixed(1),
      barTime: last.t,
      note: `1H Phân phối ${boxLength} nến (biên ${(boxRatio * 100).toFixed(1)}%), nến 1H xả Vol ${volRatio.toFixed(1)}x đục thủng đáy hộp`,
    };
  }

  return null;
}

export type Macro4HContext = {
  high7d: number; // Đỉnh cao nhất 7-14 ngày qua trên khung 4H
  low7d: number; // Đáy thấp nhất 7-14 ngày qua trên khung 4H
  nearestBearishFvg?: { top: number; bottom: number }; // Khối FVG giảm chưa lấp trên đầu
  nearestBullishFvg?: { top: number; bottom: number }; // Khối FVG tăng chưa lấp dưới chân
};

/**
 * Quét cấu trúc nến 4H để đánh dấu Kháng cự / Hỗ trợ và FVG chưa lấp trong 7-14 ngày qua.
 */
export function extractMacro4HContext(candles4h: Candle[], currentPrice: number): Macro4HContext {
  const cs = candles4h.filter((c) => c.closed !== false);
  const n = cs.length;
  if (n < 10) return { high7d: currentPrice * 1.1, low7d: currentPrice * 0.9 };

  // 1. Quét đỉnh đáy 7-14 ngày qua (42 đến 84 nến 4H)
  const lookback = cs.slice(Math.max(0, n - 84));
  const high7d = Math.max(...lookback.map((c) => c.h));
  const low7d = Math.min(...lookback.map((c) => c.l));

  // 2. Tìm khối Bearish FVG gần nhất trên đầu (chưa bị lấp)
  // Bearish FVG: nến [i-2].low > nến [i].high (có khoảng trống giảm)
  let nearestBearishFvg: { top: number; bottom: number } | undefined;
  for (let i = n - 1; i >= Math.max(2, n - 42); i--) {
    const top = cs[i - 2].l;
    const bottom = cs[i].h;
    if (top > bottom) {
      // Có Bearish FVG giữa [i-2] và [i]
      // Kiểm tra xem các nến sau đó đã đóng qua hoặc lấp hết FVG này chưa
      const laterBars = cs.slice(i + 1);
      const isMitigated = laterBars.some((b) => b.h >= top);
      if (!isMitigated && bottom > currentPrice * 0.99) {
        if (!nearestBearishFvg || bottom < nearestBearishFvg.bottom) {
          nearestBearishFvg = { top, bottom };
        }
      }
    }
  }

  // 3. Tìm khối Bullish FVG gần nhất dưới chân (chưa bị lấp)
  let nearestBullishFvg: { top: number; bottom: number } | undefined;
  for (let i = n - 1; i >= Math.max(2, n - 42); i--) {
    const top = cs[i].l;
    const bottom = cs[i - 2].h;
    if (top > bottom) {
      const laterBars = cs.slice(i + 1);
      const isMitigated = laterBars.some((b) => b.l <= bottom);
      if (!isMitigated && top < currentPrice * 1.01) {
        if (!nearestBullishFvg || top > nearestBullishFvg.top) {
          nearestBullishFvg = { top, bottom };
        }
      }
    }
  }

  return { high7d, low7d, nearestBearishFvg, nearestBullishFvg };
}

/**
 * 📦 NHẬN DIỆN THỦNG NỀN / PHÁ NỀN LỚN KHUNG 15M (15M SHELF BREAKOUT / BREAKDOWN)
 * ĐÃ TUÂN THỦ NGHIÊM NGẶT TOP-DOWN ANALYSIS (KHUNG LỚN 4H / DAILY SO VỚI 15M):
 * 1. Khung 4H đánh dấu trước: Cản đỉnh 7 ngày (7D Swing High) và Bearish FVG.
 * 2. CẤM LONG khi đụng đầu cản 7 ngày (< 2.5%) hoặc đụng Bearish FVG 4H.
 * 3. CẤM SHORT khi đụng đáy 7 ngày (< 2.5%) hoặc đụng Bullish FVG 4H.
 */
export function detect15mShelfBreakout(
  rawCandles15m: Candle[],
  macro4h?: Macro4HContext
): AccumulationBreakout | null {
  const cs = rawCandles15m.filter((c) => c.closed !== false);
  const n = cs.length;
  if (n < 35) return null;

  const last = cs[n - 1]; // nến 15m vừa đóng
  const boxLength = Math.min(56, n - 2); // soi nền từ 28 đến 56 nến (~7 đến 14 tiếng)
  if (boxLength < 28) return null;

  const box = cs.slice(n - 1 - boxLength, n - 1);
  const boxHigh = Math.max(...box.map((b) => b.h));
  const boxLow = Math.min(...box.map((b) => b.l));
  const boxRange = boxHigh - boxLow;

  const boxRatio = boxRange / boxLow;
  if (boxRatio < 0.002 || boxRatio > 0.055) return null;

  const rng = last.h - last.l;
  if (rng <= 0) return null;

  const prev20 = cs.slice(Math.max(0, n - 21), n - 1);
  const avgVol = prev20.reduce((s, x) => s + (x.v || 0), 0) / prev20.length;
  const volRatio = avgVol > 0 ? (last.v || 0) / avgVol : 1;

  // 🟢 CHIỀU 1: PHÁ ĐỈNH NỀN 15M (BREAKOUT LONG)
  if (last.c > last.o && last.c > boxHigh) {
    if (volRatio < 1.4) return null;
    const body = last.c - last.o;
    const upperWick = last.h - last.c;
    if (body < 0.50 * rng || upperWick > 0.25 * rng) return null;

    // 🛡️ BỘ LỌC CẢN LỚN KHUNG 4H / 7 NGÀY (TOP-DOWN RESISTANCE FILTER)
    if (macro4h) {
      // 1. Kiểm tra đỉnh cản lớn 7-14 ngày
      const distTo7dHigh = (macro4h.high7d - last.c) / last.c;
      // Nếu đỉnh 7 ngày nằm ngay sát sạt trên đầu (< 2.5%) và giá chưa vượt hẳn đỉnh 7 ngày -> CẤM LONG!
      if (macro4h.high7d > last.c && distTo7dHigh < 0.025) {
        return null; // Chặn đâm đầu vào kháng cự ngày 11/10!
      }

      // 2. Kiểm tra khối Bearish FVG 4H chưa lấp trên đầu
      if (macro4h.nearestBearishFvg) {
        const distToFvg = (macro4h.nearestBearishFvg.bottom - last.c) / last.c;
        // Nếu giá đâm thẳng vào bụng FVG hoặc cách FVG < 2.0% -> CẤM LONG!
        if (last.c <= macro4h.nearestBearishFvg.top && (distToFvg < 0.02 || last.c >= macro4h.nearestBearishFvg.bottom)) {
          return null; // Chặn đâm đầu vào Bearish FVG 4H!
        }
      }
    }

    const entry = last.c;
    const stop = Math.max(last.l - 0.001 * last.l, boxHigh - 0.010 * boxHigh);
    const risk = (entry - stop) / entry;
    if (risk < 0.003 || risk > 0.035) return null;

    const tp1 = entry + 1.4 * (entry - stop);
    const tp2 = entry + 2.5 * (entry - stop);

    return {
      side: 1,
      boxHigh,
      boxLow,
      breakoutPrice: boxHigh,
      entry,
      stop,
      tp: tp2,
      tp1,
      tp2,
      volumeRatio: +volRatio.toFixed(1),
      barTime: last.t,
      note: `M15 Nền ${boxLength} nến (~${(boxLength / 4).toFixed(0)}h), nổ Vol ${volRatio.toFixed(1)}x phá đỉnh nền (Khung 4H thông thoáng, không vướng cản 7D/FVG)`,
    };
  }

  // 🔴 CHIỀU 2: THỦNG ĐÁY NỀN 15M (BREAKDOWN SHORT)
  if (last.c < last.o && last.c < boxLow) {
    if (volRatio < 1.4) return null;
    const body = last.o - last.c;
    const lowerWick = last.c - last.l;
    if (body < 0.50 * rng || lowerWick > 0.25 * rng) return null;

    // 🛡️ BỘ LỌC HỖ TRỢ LỚN KHUNG 4H / 7 NGÀY
    if (macro4h) {
      // 1. Kiểm tra đáy hỗ trợ lớn 7 ngày
      const distTo7dLow = (last.c - macro4h.low7d) / last.c;
      if (macro4h.low7d < last.c && distTo7dLow < 0.025) {
        return null; // Chặn Short ngay trên đầu hỗ trợ cứng 7 ngày!
      }

      // 2. Kiểm tra khối Bullish FVG 4H dưới chân
      if (macro4h.nearestBullishFvg) {
        const distToFvg = (last.c - macro4h.nearestBullishFvg.top) / last.c;
        if (last.c >= macro4h.nearestBullishFvg.bottom && (distToFvg < 0.02 || last.c <= macro4h.nearestBullishFvg.top)) {
          return null; // Chặn Short đâm vào vùng cầu Bullish FVG 4H!
        }
      }
    }

    const entry = last.c;
    const stop = Math.min(boxHigh, boxLow + 0.008 * boxLow);
    const risk = (stop - entry) / entry;
    if (risk < 0.003 || risk > 0.035) return null;

    const tp1 = entry - 1.4 * (stop - entry);
    const tp2 = entry - 3.0 * (stop - entry);

    return {
      side: -1,
      boxHigh,
      boxLow,
      breakoutPrice: boxLow,
      entry,
      stop,
      tp: tp2,
      tp1,
      tp2,
      volumeRatio: +volRatio.toFixed(1),
      barTime: last.t,
      note: `M15 Nền ${boxLength} nến (~${(boxLength / 4).toFixed(0)}h), xả Vol ${volRatio.toFixed(1)}x đục đáy nền (Khung 4H thông thoáng, không vướng đáy 7D/FVG)`,
    };
  }

  return null;
}

export type SupportBounceSetup = {
  side: 1;
  entry: number;
  stop: number;
  tp: number;
  tp1: number;
  tp2: number;
  recentHigh: number;
  volumeRatio: number;
  barTime: number;
  note: string;
};

/**
 * 🎯 SĂN ĐÁY HỖ TRỢ / S/R FLIP RETEST (KÈO SĂN RÚT CHÂN PHIÊN Á / SÁNG SỚM)
 * Nhận diện Altcoin hồi về hỗ trợ sau đợt tăng, rút chân nến búa hoặc đóng nến xanh giữ đáy.
 */
export function detect15mSupportBounce(rawCandles15m: Candle[]): SupportBounceSetup | null {
  const cs = rawCandles15m.filter((c) => c.closed !== false);
  const n = cs.length;
  if (n < 45) return null;

  const last = cs[n - 1];
  const rng = last.h - last.l;
  if (rng <= 0) return null;

  const recentLookback = cs.slice(Math.max(0, n - 41), n - 1);
  const recentHigh = Math.max(...recentLookback.map((b) => b.h));
  const pullbackPct = (recentHigh - last.c) / recentHigh;
  if (pullbackPct < 0.03) return null; // Đã chiết khấu ít nhất 3% từ đỉnh

  const lowerWick = Math.min(last.o, last.c) - last.l;
  const isHammerOrGreen = (lowerWick >= 0.30 * rng) || (last.c > last.o && last.c > cs[n - 2].c);
  if (!isHammerOrGreen) return null;

  const localLowLookback = cs.slice(Math.max(0, n - 9), n - 1);
  const localSwingLow = Math.min(...localLowLookback.map((b) => b.l));

  // Yêu cầu nến hiện tại đóng xanh và giá thấp nhất chạm/quét vùng swing low
  if (last.c < last.o) return null;
  if (last.l > localSwingLow * 1.004) return null;

  const entry = last.c;
  const stop = Math.min(localSwingLow, last.l) - 0.002 * last.l;
  const risk = (entry - stop) / entry;
  if (risk < 0.004 || risk > 0.025) return null;

  const tp1 = entry + 1.4 * (entry - stop);
  const tp2 = recentHigh;

  const prev20 = cs.slice(Math.max(0, n - 21), n - 1);
  const avgVol = prev20.reduce((s, x) => s + (x.v || 0), 0) / prev20.length;
  const volRatio = avgVol > 0 ? (last.v || 0) / avgVol : 1;

  return {
    side: 1,
    entry,
    stop,
    tp: tp2,
    tp1,
    tp2,
    recentHigh,
    volumeRatio: +volRatio.toFixed(1),
    barTime: last.t,
    note: `M15 Săn đáy hỗ trợ rút chân (hồi ${(pullbackPct * 100).toFixed(1)}% từ đỉnh), bật tăng mục tiêu đỉnh cũ`,
  };
}

/** Giữ alias tương thích ngược */
export const detectAccumulationBreakout = detectHtfBreakout;

export type AnticipatingSetup = {
  coin?: string;
  kind: "box_squeeze" | "approaching_sr";
  boxHigh: number;
  boxLow: number;
  currentPrice: number;
  distancePct: number;
  note: string;
};

/**
 * 🔍 QUÉT NẾN SẮP VÀO MÔ HÌNH (RÌNH TRƯỚC BREAKOUT / BREAKDOWN)
 * Tìm những Altcoin đang nén hộp chặt chẽ (biên <= 4.2%), giá sát trần hoặc sát sàn hộp,
 * volume cạn kiệt chuẩn bị bùng nổ theo cả 2 chiều!
 */
export function detectAnticipatingBox(rawCandles: Candle[]): AnticipatingSetup | null {
  const cs = rawCandles.filter((c) => c.closed !== false);
  const n = cs.length;
  if (n < 12) return null;

  const boxLength = 8;
  const box = cs.slice(n - boxLength, n);
  const boxHigh = Math.max(...box.map((b) => b.h));
  const boxLow = Math.min(...box.map((b) => b.l));
  const boxRange = boxHigh - boxLow;

  // Hộp nén hẹp <= 4.2%
  if (boxRange / boxLow > 0.042) return null;

  const last = cs[n - 1];
  const distToHigh = (boxHigh - last.c) / last.c;
  const distToLow = (last.c - boxLow) / last.c;

  // 1. Giá sát trần hộp (chuẩn bị nổ Long)
  if (distToHigh >= -0.005 && distToHigh <= 0.015) {
    return {
      kind: "box_squeeze",
      boxHigh,
      boxLow,
      currentPrice: last.c,
      distancePct: +(distToHigh * 100).toFixed(1),
      note: `Nén hộp ${boxLength} nến (biên ${(boxRange / boxLow * 100).toFixed(1)}%), giá sát trần, chờ nến M15 nổ Vol phá ${boxHigh} để LONG`,
    };
  }

  // 2. Giá sát sàn hộp (chuẩn bị sập Short)
  if (distToLow >= -0.005 && distToLow <= 0.015) {
    return {
      kind: "box_squeeze",
      boxHigh,
      boxLow,
      currentPrice: last.c,
      distancePct: +(distToLow * 100).toFixed(1),
      note: `Nén hộp ${boxLength} nến (biên ${(boxRange / boxLow * 100).toFixed(1)}%), giá sát sàn, chờ nến M15 xả Vol thủng ${boxLow} để SHORT`,
    };
  }

  return null;
}

export type Early5mTrigger = {
  side: 1 | -1;
  boxHigh: number;
  boxLow: number;
  entry: number;
  stop: number;
  tp: number;
  volumeRatio: number;
  barTime: number;
  note: string;
};

/**
 * ⚡ KÍCH HOẠT VÀO SỚM 5M (ĐÃ VÔ HIỆU HOÁ HOÀN TOÀN)
 * Theo đúng chỉ đạo của Victor & Price Action: Tuyệt đối không mua đuổi nến 5m micro-breakout
 * vì dễ dính bẫy thanh khoản cá mập (Bull Trap) lúc sáng sớm.
 */
export function detect5mEarlyTrigger(
  _bars15m: Candle[],
  _bars5m: Candle[]
): Early5mTrigger | null {
  return null; // Tắt hoàn toàn để bảo vệ tài khoản
}

/**
 * 🚫 BỘ LỌC VÙNG LƠ LỬNG KHÔNG NGƯỜI (NO MAN'S LAND FILTER)
 * Theo Episode 4, 5 & Masterclass trong 16 video Price Action:
 * - Tuyệt đối KHÔNG BAO GIỜ vào lệnh khi giá đang trôi lơ lửng ở giữa chart,
 *   chưa chạm hoặc chưa tiếp cận sát vùng Cản cứng (Support / Resistance) 1H/4H!
 * - Trả về `true` nếu giá đang ở vùng giữa nguy hiểm cần ĐỨNG NGOÀI.
 */
export function isPriceInNoMansLand(bars1h: Candle[]): boolean {
  const cs = bars1h.filter((c) => c.closed !== false);
  if (cs.length < 30) return false;

  const last = cs[cs.length - 1];
  const recent30 = cs.slice(-30);
  const maxH = Math.max(...recent30.map((c) => c.h));
  const minL = Math.min(...recent30.map((c) => c.l));
  const range = maxH - minL;
  if (range <= 0 || minL <= 0) return false;

  // Khoảng cách từ giá hiện tại đến đỉnh cản trên và đáy cản dưới
  const distToHigh = (maxH - last.c) / last.c;
  const distToLow = (last.c - minL) / last.c;

  // Nếu giá cách xa cả đỉnh cản (> 1.2%) VÀ cách xa cả đáy cản (> 1.2%) -> Đang ở giữa vùng chop lơ lửng!
  return distToHigh > 0.012 && distToLow > 0.012;
}


