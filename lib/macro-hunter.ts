import type { Candle } from "./okx";

export type MacroLevelType =
  | "SWING_HIGH_7D"
  | "SWING_LOW_7D"
  | "BEARISH_FVG_4H"
  | "BULLISH_FVG_4H";

export type MacroZone = {
  type: MacroLevelType;
  top: number;
  bottom: number;
  center: number;
  timeframe: "4H" | "1D";
  touchCount: number;
  status: "FRESH" | "TESTED" | "EXHAUSTED";
  isBrokenAndFlipped: boolean; // Đã xác nhận phá cản để chuyển sang S/R Flip
};

export type HunterSignal = {
  kind: "REJECTION_SHORT" | "BOUNCE_LONG" | "RETEST_LONG" | "RETEST_SHORT";
  side: 1 | -1;
  coin: string;
  entry: number;
  stop: number;
  tp: number;
  tp1: number;
  rrRatio: number;
  zone: MacroZone;
  volumeRatio: number;
  barTime: number;
  note: string;
  isMacroReversal: true; // Cờ ưu tiên bypass bộ lọc RS
};

function calculateAtr14(cs: Candle[]): number {
  if (cs.length < 2) return cs[0] ? (cs[0].h - cs[0].l) || 0.01 : 0.01;
  const n = cs.length;
  let trSum = 0;
  const lookback = Math.min(14, n - 1);
  for (let i = n - lookback; i < n; i++) {
    const c = cs[i];
    const prev = cs[i - 1];
    const tr = Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c));
    trSum += tr;
  }
  return trSum / lookback;
}

/**
 * Thuật toán đếm nhịp test (Visit Debouncing)
 * Một nhịp "Test" hợp lệ phải có trạng thái: Bên ngoài -> Chạm vào vùng -> Rút lui ra ngoài -> Quay lại lần nữa.
 * Tránh bẫy Consolidation Trap (đi ngang trong vùng nhiều nến bị tính sai số lần test).
 */
function calculateDebouncedTouchCount(
  candles4h: Candle[],
  zoneTop: number,
  zoneBottom: number,
  createdBarIndex: number
): { touchCount: number; isBroken: boolean } {
  let touchCount = 0;
  let isInside = false;
  let isBroken = false;

  for (let i = createdBarIndex + 1; i < candles4h.length; i++) {
    const c = candles4h[i];
    const touchesZone = c.h >= zoneBottom && c.l <= zoneTop;

    if (touchesZone && !isInside) {
      touchCount++;
      isInside = true;
    } else if (!touchesZone) {
      isInside = false;
    }

    // Chỉ đánh dấu vùng bị phá vỡ dứt khoát nếu nến 4H đóng vượt hẳn qua đỉnh cản (đối với kháng cự)
    // hoặc đóng thủng hẳn dưới đáy hỗ trợ (đối với hỗ trợ)
    if (c.c > zoneTop * 1.015) {
      isBroken = true;
    }
  }

  return { touchCount, isBroken };
}

/**
 * 🏛️ TRÍCH XUẤT CÁC VÙNG GIÁ TRỊ MACRO KHUNG 4H / DAILY (Area of Value - AoV)
 * Quét toàn bộ Swings 7-14 ngày và các khối FVG chưa lấp.
 */
export function extractMacroZones(candles4h: Candle[], currentPrice: number): MacroZone[] {
  const cs = candles4h.filter((c) => c.closed !== false);
  const n = cs.length;
  if (n < 15) return [];

  const zones: MacroZone[] = [];
  const lookbackBars = Math.min(84, n); // Tối đa 14 ngày (84 nến 4H)
  const window4h = cs.slice(n - lookbackBars);

  // 1. Tìm Đỉnh Cực Đại 7D - 14D (Swing High)
  let maxHigh = -Infinity;
  let maxHighIdx = -1;
  for (let i = 0; i < window4h.length; i++) {
    if (window4h[i].h > maxHigh) {
      maxHigh = window4h[i].h;
      maxHighIdx = i;
    }
  }

  if (maxHighIdx >= 0) {
    const topBar = window4h[maxHighIdx];
    const zoneTop = topBar.h;
    // Vùng cản lấy từ đỉnh cao nhất đến chân vùng cung (khoảng 1.8% dưới đỉnh)
    const zoneBottom = Math.min(Math.max(topBar.o, topBar.c), zoneTop * 0.982);
    const { touchCount, isBroken } = calculateDebouncedTouchCount(window4h, zoneTop, zoneBottom, maxHighIdx);

    zones.push({
      type: "SWING_HIGH_7D",
      top: zoneTop,
      bottom: zoneBottom,
      center: (zoneTop + zoneBottom) / 2,
      timeframe: "4H",
      touchCount,
      status: isBroken ? "EXHAUSTED" : touchCount <= 3 ? "FRESH" : "TESTED",
      isBrokenAndFlipped: false,
    });
  }

  // 2. Tìm Đáy Cực Đại 7D - 14D (Swing Low)
  let minLow = Infinity;
  let minLowIdx = -1;
  for (let i = 0; i < window4h.length; i++) {
    if (window4h[i].l < minLow) {
      minLow = window4h[i].l;
      minLowIdx = i;
    }
  }

  if (minLowIdx >= 0) {
    const botBar = window4h[minLowIdx];
    const zoneBottom = botBar.l;
    const zoneTop = Math.min(botBar.o, botBar.c, zoneBottom * 1.012);
    const { touchCount, isBroken } = calculateDebouncedTouchCount(window4h, zoneTop, zoneBottom, minLowIdx);

    zones.push({
      type: "SWING_LOW_7D",
      top: zoneTop,
      bottom: zoneBottom,
      center: (zoneTop + zoneBottom) / 2,
      timeframe: "4H",
      touchCount,
      status: isBroken ? "EXHAUSTED" : touchCount <= 3 ? "FRESH" : "TESTED",
      isBrokenAndFlipped: false,
    });
  }

  // 3. Tìm Bearish FVG 4H (Khoảng trống giảm chưa lấp trên đầu)
  // Bearish FVG: cs[i-2].low > cs[i].high
  for (let i = n - 1; i >= Math.max(2, n - 42); i--) {
    const top = cs[i - 2].l;
    const bottom = cs[i].h;
    if (top > bottom && (top - bottom) / bottom >= 0.004) {
      // Kiểm tra xem đã bị lấp (mitigated) chưa:
      // Trong SMC/ICT, nếu giá sau đó đã thò lên quá 50% FVG (hoặc đóng nến vượt qua bottom)
      // thì FVG đó đã được hấp thụ/mitigated, không còn giá trị chặn đảo chiều nữa!
      const later = cs.slice(i + 1);
      const fvgMid = (top + bottom) / 2;
      const isMitigated = later.some((b) => b.h >= fvgMid || b.c >= bottom);
      if (!isMitigated && bottom >= currentPrice * 0.985) {
        const { touchCount, isBroken } = calculateDebouncedTouchCount(cs, top, bottom, i);
        zones.push({
          type: "BEARISH_FVG_4H",
          top,
          bottom,
          center: fvgMid,
          timeframe: "4H",
          touchCount,
          status: isBroken ? "EXHAUSTED" : touchCount <= 2 ? "FRESH" : "TESTED",
          isBrokenAndFlipped: false,
        });
        break; // Lấy khối Bearish FVG gần nhất
      }
    }
  }

  // 4. Tìm Bullish FVG 4H (Khoảng trống tăng chưa lấp dưới chân)
  for (let i = n - 1; i >= Math.max(2, n - 42); i--) {
    const top = cs[i].l;
    const bottom = cs[i - 2].h;
    if (top > bottom && (top - bottom) / bottom >= 0.004) {
      // Kiểm tra xem đã bị lấp (mitigated) chưa:
      // Nếu giá sau đó đã thò xuống chạm quá 50% FVG (hoặc đóng nến dưới đỉnh FVG)
      // thì vùng cầu này đã được test/hấp thụ xong, không còn là vùng tươi mới
      const later = cs.slice(i + 1);
      const fvgMid = (top + bottom) / 2;
      const isMitigated = later.some((b) => b.l <= fvgMid || b.c <= top);
      if (!isMitigated && top <= currentPrice * 1.015) {
        const { touchCount, isBroken } = calculateDebouncedTouchCount(cs, top, bottom, i);
        zones.push({
          type: "BULLISH_FVG_4H",
          top,
          bottom,
          center: fvgMid,
          timeframe: "4H",
          touchCount,
          status: isBroken ? "EXHAUSTED" : touchCount <= 2 ? "FRESH" : "TESTED",
          isBrokenAndFlipped: false,
        });
        break; // Lấy khối Bullish FVG gần nhất
      }
    }
  }

  return zones;
}

/**
 * 🎯 BỘ NÃO SĂN LỆNH MACRO HUNTER MATRIX
 * Phân tích nến 15m đã đóng kết hợp với các Vùng MacroZone 4H và Nến 1H.
 */
export function detectMacroHunterSignal(
  coin: string,
  raw15m: Candle[],
  raw4h: Candle[],
  raw1h: Candle[],
  btcAllowance: { allowShort: boolean; allowLong: boolean; isBtcStrongPump: boolean }
): HunterSignal | null {
  // 1. Chống nhiễu nến giữa chu kỳ: CHỈ LẤY NẾN 15M ĐÃ ĐÓNG HOÀN TOÀN
  const closed15m = raw15m.filter((c) => c.closed !== false);
  if (closed15m.length < 25) return null;

  const last15 = closed15m[closed15m.length - 1]; // Nến 15m vừa đóng
  const prev15 = closed15m[closed15m.length - 2];
  const curPrice = last15.c;

  // Lấy danh sách Vùng Cản / FVG Macro 4H
  const zones = extractMacroZones(raw4h, curPrice);
  if (!zones.length) return null;

  const atr15 = calculateAtr14(closed15m);
  const rng15 = last15.h - last15.l;
  if (rng15 <= 0) return null;

  // Volume confirm: So sánh volume nến kích hoạt với TB 20 nến 15m trước
  const prev20 = closed15m.slice(Math.max(0, closed15m.length - 21), closed15m.length - 1);
  const avgVol = prev20.reduce((s, x) => s + (x.v || 0), 0) / prev20.length;
  const volRatio = avgVol > 0 ? (last15.v || 0) / avgVol : 1;

  // Dynamic Stop Loss Buffer chuẩn sàn MEXC: Max(0.25% giá, 0.4 * ATR15)
  const dynamicBuffer = Math.max(curPrice * 0.0025, 0.4 * atr15);

  // =========================================================================
  // 🎯 SETUP 1: REJECTION SHORT TẠI CẢN LỚN (ĐỈNH 7D HOẶC BEARISH FVG 4H)
  // =========================================================================
  if (btcAllowance.allowShort && !btcAllowance.isBtcStrongPump) {
    const resistanceZones = zones.filter(
      (z) =>
        (z.type === "SWING_HIGH_7D" || z.type === "BEARISH_FVG_4H") &&
        (z.status === "FRESH" || z.status === "TESTED") &&
        z.touchCount <= 3
    );

    for (const rz of resistanceZones) {
      // Giá cao nhất của nến 15m thò vào vùng cản (hoặc cách cản <= 0.4 * ATR15)
      const touchedZone = last15.h >= rz.bottom - 0.4 * atr15 && last15.l <= rz.top + 0.4 * atr15;
      if (!touchedZone) continue;

      // 🛡️ LỌC NẾN RÁC: Biên độ nến 15m kích hoạt (Range) phải đạt tối thiểu >= 0.55%
      const candleRangePct = (rng15 / last15.l) * 100;
      if (candleRangePct < 0.55) continue;

      // 🛡️ BẮT BUỘC QUY CHUẨN PRICE ACTION & VOLUME TẠI VÙNG (VPA Ep 7-9):
      // 1. Muốn Short đảo chiều thì NẾN 15M BẮT BUỘC PHẢI ĐÓNG ĐỎ (last15.c < last15.o)!
      // Tuyệt đối CẤM SHORT khi nến vẫn kết thúc màu XANH (phe mua vẫn đang rướn)
      const isRedCandle = last15.c < last15.o;
      if (!isRedCandle) continue;

      // 2. Volume Crossing Check: Xác nhận Volume cắt qua vùng (Volume Expansion)
      // Khối lượng tại nến từ chối hoặc nến đâm cản trước đó phải bùng nổ vượt trội (>= 1.3x SMA20)
      const prevVolRatio = avgVol > 0 ? (prev15.v || 0) / avgVol : 1;
      const isVolumeCrossingZone = volRatio >= 1.3 || (prevVolRatio >= 1.5 && volRatio >= 1.0);
      if (!isVolumeCrossingZone) continue;

      // 3. Chống bẫy Churning / Climax Buying: Nếu Volume quá khủng (> 2.5x) mà thân nến đỏ quá bé (< 25% range)
      // tức là lực mua hấp thụ (Absorption) vẫn đang nuốt hàng -> chưa Short ngay!
      const redBodyPct = ((last15.o - last15.c) / rng15) * 100;
      if (volRatio >= 2.5 && redBodyPct < 25) continue;

      // Nhận diện nến từ chối (Rejection Candlestick):
      // 1. Shooting Star / Bearish Pinbar: Râu trên dài >= 45% biên độ nến
      const upperWick = last15.h - Math.max(last15.o, last15.c);
      const isPinbarRejection = upperWick >= 0.45 * rng15;

      // 2. Bearish Engulfing: Nến đỏ thân đặc phủ nhận hoàn toàn nến xanh trước đó
      const isEngulfing =
        prev15.c > prev15.o &&
        last15.c <= prev15.o &&
        (last15.o - last15.c) >= 0.50 * rng15;

      // Volume xác nhận lực bán
      const isVolConfirmed = isVolumeCrossingZone;

      // 🛡️ BẮT BUỘC QUY CHUẨN CẮT NỀN / PHỦ NHẬN LỰC TĂNG (LOCAL CONFIRMATION):
      // "Chưa cắt nền gì mà sao lại Short?":
      // Đúng theo Price Action: Nến 15m từ chối tại cản phải đóng nến đỏ (last15.c < last15.o)
      // VÀ phải đóng cửa dưới giá đóng cửa nến trước (last15.c < prev15.c) để xác nhận đảo chiều,
      // HOẶC nuốt trọn nến trước (isEngulfing).
      const confirmsDownturn = isEngulfing || (last15.c < prev15.c && isPinbarRejection);
      if (!confirmsDownturn) continue;

      if ((isPinbarRejection || isEngulfing) && isVolConfirmed) {
        // Giá đóng cửa phải rút về dưới đỉnh cản rz.top
        if (last15.c <= rz.top) {
          const entry = last15.c;
          // SL trên râu nến quét + Dynamic Buffer
          const stop = last15.h + dynamicBuffer;
          const risk = (stop - entry) / entry;

          // Bộ lọc risk hợp lệ: từ 0.35% đến 2.5% (đòn bẩy x10 an toàn)
          if (risk >= 0.0035 && risk <= 0.025) {
            // TP1: Hồi về mép dưới của nền 15m gần nhất (1.5R)
            const tp1 = entry - 1.5 * (stop - entry);
            // TP2: Đáy cũ sâu hơn (2.5R đến 3.5R)
            const tp2 = entry - 2.8 * (stop - entry);
            const rrRatio = +(2.8).toFixed(1);

            return {
              kind: "REJECTION_SHORT",
              side: -1,
              coin,
              entry,
              stop,
              tp: tp2,
              tp1,
              rrRatio,
              zone: rz,
              volumeRatio: +volRatio.toFixed(1),
              barTime: last15.t,
              note: `🎯 Săn Đảo Chiều Short tại ${rz.type === "SWING_HIGH_7D" ? "Cản đỉnh 7D" : "Bearish FVG 4H"} (${rz.bottom.toFixed(4)} - ${rz.top.toFixed(4)}). Nến 15m từ chối râu ${((upperWick / rng15) * 100).toFixed(0)}%, Vol ${volRatio.toFixed(1)}x`,
              isMacroReversal: true,
            };
          }
        }
      }
    }
  }

  // =========================================================================
  // 🚀 SETUP 2: RETEST LONG SAU KHI PHÁ VỠ CẢN LỚN (S/R FLIP RETEST)
  // =========================================================================
  if (btcAllowance.allowLong) {
    const closed1h = raw1h.filter((c) => c.closed !== false);
    const last1h = closed1h.at(-1);

    const resistanceZones = zones.filter(
      (z) => z.type === "SWING_HIGH_7D" || z.type === "BEARISH_FVG_4H"
    );

    for (const rz of resistanceZones) {
      // Điều kiện xác nhận Phá Cản Linh Hoạt (Xóa bỏ độ trễ 4H):
      // 1. Hoặc 1 nến 1H đóng dứt khoát trên đỉnh cản (last1h.c > rz.top)
      // 2. Hoặc 2 nến 15m liên tiếp đóng thân nến trên đỉnh cản
      const is1hBroken = last1h ? last1h.c > rz.top : false;
      const is2x15mBroken =
        closed15m.length >= 3 &&
        closed15m[closed15m.length - 2].c > rz.top &&
        closed15m[closed15m.length - 3].c > rz.top;

      const isBreakoutConfirmed = is1hBroken || is2x15mBroken;
      if (!isBreakoutConfirmed) continue;

      // Nến 15m hiện tại quay lại hồi test (Retest):
      // Râu thò vào vùng đỉnh cản cũ (rz.top) nhưng giá đóng cửa BẮT BUỘC giữ trên rz.center (chống Bull Trap)
      const isRetestingZone = last15.l <= rz.top + 0.3 * atr15 && last15.l >= rz.bottom - 0.2 * atr15;
      const isHoldingAboveCenter = last15.c >= rz.center;

      // Nến retest phải rút chân tăng (Hammer / Bullish Pinbar / Đóng nến xanh)
      const lowerWick = Math.min(last15.o, last15.c) - last15.l;
      const isBullishRejection = (lowerWick >= 0.40 * rng15) || (last15.c > last15.o);

      if (isRetestingZone && isHoldingAboveCenter && isBullishRejection) {
        const entry = last15.c;
        // SL dưới đáy râu retest - Dynamic Buffer
        const stop = Math.min(last15.l, rz.center) - dynamicBuffer;
        const risk = (entry - stop) / entry;

        if (risk >= 0.0035 && risk <= 0.025) {
          const tp1 = entry + 1.5 * (entry - stop);
          const tp2 = entry + 3.0 * (entry - stop);
          const rrRatio = +(3.0).toFixed(1);

          return {
            kind: "RETEST_LONG",
            side: 1,
            coin,
            entry,
            stop,
            tp: tp2,
            tp1,
            rrRatio,
            zone: rz,
            volumeRatio: +volRatio.toFixed(1),
            barTime: last15.t,
            note: `🚀 Săn Retest Long: Cản 4H (${rz.top.toFixed(4)}) đã bị phá vỡ biến thành Hỗ trợ mới (S/R Flip). Nến 15m hồi test rút chân giữ vững trục giữa, Vol ${volRatio.toFixed(1)}x`,
            isMacroReversal: true,
          };
        }
      }
    }
  }

  // =========================================================================
  // 🟢 SETUP 3: BOUNCE LONG TẠI HỖ TRỢ ĐÁY 7D HOẶC BULLISH FVG 4H
  // =========================================================================
  if (btcAllowance.allowLong) {
    const supportZones = zones.filter(
      (z) =>
        (z.type === "SWING_LOW_7D" || z.type === "BULLISH_FVG_4H") &&
        (z.status === "FRESH" || z.status === "TESTED") &&
        z.touchCount <= 3
    );

    for (const sz of supportZones) {
      const touchedZone = last15.l <= sz.top + 0.4 * atr15 && last15.h >= sz.bottom - 0.4 * atr15;
      if (!touchedZone) continue;

      const lowerWick = Math.min(last15.o, last15.c) - last15.l;
      const isPinbarBounce = lowerWick >= 0.50 * rng15;
      const isBullishEngulfing =
        last15.c > last15.o &&
        prev15.c < prev15.o &&
        last15.c >= prev15.o &&
        (last15.c - last15.o) >= 0.55 * rng15;

      if ((isPinbarBounce || isBullishEngulfing) && volRatio >= 1.25 && last15.c >= sz.bottom) {
        const entry = last15.c;
        const stop = last15.l - dynamicBuffer;
        const risk = (entry - stop) / entry;

        if (risk >= 0.0035 && risk <= 0.025) {
          const tp1 = entry + 1.5 * (entry - stop);
          const tp2 = entry + 2.8 * (entry - stop);

          return {
            kind: "BOUNCE_LONG",
            side: 1,
            coin,
            entry,
            stop,
            tp: tp2,
            tp1,
            rrRatio: 2.8,
            zone: sz,
            volumeRatio: +volRatio.toFixed(1),
            barTime: last15.t,
            note: `🟢 Săn Bắt Đáy Hỗ Trợ tại ${sz.type === "SWING_LOW_7D" ? "Đáy 7D" : "Bullish FVG 4H"} (${sz.bottom.toFixed(4)} - ${sz.top.toFixed(4)}). Nến 15m rút chân ${((lowerWick / rng15) * 100).toFixed(0)}%, Vol ${volRatio.toFixed(1)}x`,
            isMacroReversal: true,
          };
        }
      }
    }
  }

  return null;
}
