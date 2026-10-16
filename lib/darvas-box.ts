import type { Candle } from "./okx";

export type DarvasBox = {
  top: number;          // Cạnh trên (Kháng cự / Đỉnh hộp)
  bottom: number;       // Cạnh dưới (Hỗ trợ / Đáy hộp)
  center: number;       // Trục giữa hộp
  heightPct: number;    // Chiều cao hộp theo %
  candleCount: number;  // Số nến đi ngang trong hộp
  startTime: number;    // Thời điểm bắt đầu hình thành hộp
  endTime: number;      // Thời điểm nến gần nhất trong hộp
  firstBounceLow?: number; // Đáy nhịp rút chân lần 1
  firstBounceTime?: number;
  testCount: number;    // Số lần giá nhúng về kiểm tra đáy hộp
};

export type DarvasSignal = {
  kind: "DARVAS_2ND_BOUNCE" | "DARVAS_BREAKOUT" | "DARVAS_BREAKDOWN_SHORT";
  side: 1 | -1;
  coin: string;
  entry: number;
  stop: number;
  tp: number;
  tp1: number;
  rrRatio: number;
  box: DarvasBox;
  volumeRatio: number;
  barTime: number;
  note: string;
};

/**
 * 📦 NHẬN DIỆN CHIẾC HỘP DARVAS BOX (NICOLAS DARVAS)
 * Quét từ 12 đến 28 nến 15m (tương đương 3 đến 7 tiếng nén hộp).
 * Hộp hợp lệ phải có biên độ dao động tối thiểu 0.8% và tối đa 7.0%.
 * Nhịp test đáy phải có Stopping Volume (khối lượng chặn đà giảm).
 */
export function extractDarvasBox(candles15m: Candle[], excludeLastBars: number = 1): DarvasBox | null {
  const cs = candles15m.filter((c) => c.closed !== false);
  const n = cs.length;
  if (n < 20) return null;

  // Lấy phạm vi nến đi ngang trước đó
  const endIdx = n - excludeLastBars;
  const boxLength = Math.min(24, endIdx - 1);
  const boxBars = cs.slice(Math.max(0, endIdx - boxLength), endIdx);
  if (boxBars.length < 12) return null;

  const top = Math.max(...boxBars.map((b) => b.h));
  const bottom = Math.min(...boxBars.map((b) => b.l));
  const height = top - bottom;
  if (bottom <= 0) return null;

  const heightPct = (height / bottom) * 100;
  // Biên độ hộp phải hợp lý: từ 0.6% đến 7.0% (ở crypto 15m, BTC đi ngang biên 0.6% - 1.5% rất phổ biến)
  if (heightPct < 0.6 || heightPct > 7.0) return null;

  const center = (top + bottom) / 2;

  // Đếm các nhịp test đáy hộp (mỗi nhịp là một nến nhúng râu về gần mép đáy <= 20% biên dưới)
  const bottomTolerance = bottom + height * 0.20;
  const boxAvgVol = boxBars.reduce((s, x) => s + (x.v || 0), 0) / boxBars.length;
  let testCount = 0;
  let firstBounceLow: number | undefined;
  let firstBounceTime: number | undefined;

  for (let i = 0; i < boxBars.length; i++) {
    const b = boxBars[i];
    if (b.l <= bottomTolerance) {
      // Xác nhận nến có rút chân hoặc đảo chiều xanh kèm Stopping Volume (đỡ giá hấp thụ gom hàng)
      const lowerWick = Math.min(b.o, b.c) - b.l;
      const rng = b.h - b.l;
      const hasStoppingVol = (b.v || 0) >= 0.85 * boxAvgVol;
      if (rng > 0 && (lowerWick >= 0.30 * rng || b.c > b.o) && hasStoppingVol) {
        testCount++;
        if (!firstBounceLow) {
          firstBounceLow = b.l;
          firstBounceTime = b.t;
        }
      }
    }
  }

  return {
    top,
    bottom,
    center,
    heightPct,
    candleCount: boxBars.length,
    startTime: boxBars[0].t,
    endTime: boxBars[boxBars.length - 1].t,
    firstBounceLow,
    firstBounceTime,
    testCount,
  };
}

/**
 * 🎯 CHIẾN THUẬT SĂN LỆNH HỘP DARVAS BOX (CHUẨN VPA):
 * 1. KÈO 1: Săn Nhịp Test Đáy Lần 2 (DARVAS_2ND_BOUNCE - Long)
 *    - Đã có lần 1 rút chân ở đáy hộp kèm Stopping Volume.
 *    - Lần 2 giá quay lại quét/chạm đáy hộp, rút chân nến búa hoặc đóng nến xanh phục hồi.
 *    - BẮT BUỘC thỏa mãn Volume hấp thụ bùng nổ (volRatio >= 1.8x SMA20) xác nhận dòng tiền lớn hấp thụ gom hàng.
 * 2. KÈO 2: Bứt Phá Hộp Darvas (DARVAS_BREAKOUT - Long)
 *    - Nến trước nổ Volume (>= 1.35x SMA20) đóng dứt khoát trên đỉnh hộp (chống Bull Trap).
 *    - Nến hiện tại hồi test giữ vững đỉnh hộp (S/R Flip).
 * 3. KÈO 3: Thủng Đáy Hộp Darvas (DARVAS_BREAKDOWN_SHORT - Short)
 *    - Nến trước nổ Volume xả (>= 1.35x SMA20) đóng dứt khoát dưới đáy hộp.
 *    - Nến hiện tại hồi test bị bán dội ngược từ chối cản, đóng nến đỏ hoặc rút râu trên dài.
 */
export function detectDarvasSignal(
  coin: string,
  candles15m: Candle[],
  btcAllowance?: { allowLong: boolean; allowShort?: boolean; isBtcStrongPump?: boolean }
): DarvasSignal | null {
  const allowLong = btcAllowance ? btcAllowance.allowLong : true;
  const allowShort = btcAllowance ? (btcAllowance.allowShort ?? true) : true;

  const cs = candles15m.filter((c) => c.closed !== false);
  const n = cs.length;
  if (n < 20) return null;

  const last15 = cs[n - 1]; // Nến vừa đóng hoàn toàn (Retest / 2nd Bounce)
  const prev15 = cs[n - 2]; // Nến liền trước (Breakout / Breakdown)
  const rng = last15.h - last15.l;
  if (rng <= 0) return null;

  const box = extractDarvasBox(cs, 1);
  const breakBox = extractDarvasBox(cs, 2) || box;
  if (!box && !breakBox) return null;

  // Tính Volume ratio nến kích hoạt (last15) so với TB 20 nến trước
  const prev20 = cs.slice(Math.max(0, n - 21), n - 1);
  const avgVol = prev20.reduce((s, x) => s + (x.v || 0), 0) / (prev20.length || 1);
  const volRatio = avgVol > 0 ? (last15.v || 0) / avgVol : 1;

  // Tính Volume ratio của cây nến liền trước (prev15) để kiểm tra nổ Volume khi Breakout / Breakdown
  const prevPrev20 = cs.slice(Math.max(0, n - 22), n - 2);
  const prevAvgVol = prevPrev20.reduce((s, x) => s + (x.v || 0), 0) / (prevPrev20.length || 1);
  const prevVolRatio = prevAvgVol > 0 ? (prev15.v || 0) / prevAvgVol : 1;

  // =========================================================================
  // 🟢 KÈO 1: NHỊP TEST ĐÁY LẦN 2 TẠI ĐÁY HỘP DARVAS (2ND WICK BOUNCE - LONG)
  // =========================================================================
  if (box) {
    const isTouchingBottomZone = last15.l <= box.bottom + (box.top - box.bottom) * 0.25;
    const isClosingAboveBottom = last15.c >= box.bottom;

    // 1. Phải thỏa mãn Volume hấp thụ bùng nổ (tối thiểu >= 1.8x SMA20) xác nhận Big Boys gom hàng
    const isVolumeAbsorbed = volRatio >= 1.8;

    if (allowLong && box.testCount >= 1 && isTouchingBottomZone && isClosingAboveBottom && isVolumeAbsorbed) {
      const lowerWick = Math.min(last15.o, last15.c) - last15.l;
      // Rút chân Pinbar (râu dưới >= 35% biên độ) HOẶC nến xanh đặc phục hồi (Close > Open và râu dưới >= 20%)
      const isHammerWick = lowerWick >= 0.35 * rng;
      const isGreenRecovery = last15.c > last15.o && (last15.c - last15.o) >= 0.40 * rng;

      if (isHammerWick || isGreenRecovery) {
        const entry = last15.c;
        // SL đặt dưới râu nhúng quét đáy của nến hiện tại + đệm an toàn 0.15%
        const stop = Math.min(last15.l, box.bottom) - entry * 0.0015;
        const risk = (entry - stop) / entry;

        // Risk chuẩn crypto: từ 0.25% đến 2.2%
        if (risk >= 0.0025 && risk <= 0.022) {
          // TP1: Cạnh trên hộp Darvas (vùng đỉnh hộp)
          const tp1 = box.top;
          // TP2: Đột phá hộp mở rộng (1.6x chiều cao hộp)
          const tp2 = box.top + (box.top - box.bottom) * 0.6;
          const reward = tp1 - entry;
          const rrRatio = +(reward / (entry - stop)).toFixed(1);

          // R:R đến đỉnh hộp tối thiểu đạt 1:1.5 (hoặc đến TP2 đạt >= 2.2)
          if (rrRatio >= 1.5 || (tp2 - entry) / (entry - stop) >= 2.2) {
            return {
              kind: "DARVAS_2ND_BOUNCE",
              side: 1,
              coin,
              entry,
              stop,
              tp: tp2,
              tp1,
              rrRatio: Math.max(rrRatio, 1.5),
              box,
              volumeRatio: +volRatio.toFixed(1),
              barTime: last15.t,
              note: `📦 Hộp Darvas [${box.bottom.toFixed(4)} - ${box.top.toFixed(4)}]: Quét đáy nhịp 2 rút chân giữ vững đáy hộp, Vol hấp thụ ${volRatio.toFixed(1)}x SMA20. TP1 = ${tp1.toFixed(4)}`,
            };
          }
        }
      }
    }
  }

  // =========================================================================
  // 🚀 KÈO 2: BỨT PHÁ HỘP DARVAS (DARVAS BOX BREAKOUT & S/R RETEST - LONG)
  // Bản chất Nicolas Darvas: Giá bứt phá đỉnh hộp tích luỹ với Volume lớn để bước vào Hộp Mới cao hơn
  // =========================================================================
  if (breakBox) {
    const boxHeight = breakBox.top - breakBox.bottom;

    // Điều kiện 1: Nến trước đó ĐÃ ĐÓNG DỨT KHOÁT TRÊN ĐỈNH HỘP
    const prevClosedAbove = prev15.c > breakBox.top && (prev15.c - breakBox.top) / breakBox.top >= 0.001;
    // Điều kiện VPA: Cây nến Breakout đỉnh hộp BẮT BUỘC có Volume bùng nổ (tối thiểu >= 1.35x SMA20) để chống Fakeout/Bull Trap!
    const isBreakoutVolumeExploded = prevVolRatio >= 1.35;

    // Điều kiện 2: Nến hiện tại hồi về kiểm tra lại đỉnh hộp (Retest S/R Flip):
    // Râu dưới nhúng về chạm đỉnh hộp nhưng giá đóng cửa BẮT BUỘC giữ trên đỉnh hộp
    const isRetestingBoxTop = last15.l <= breakBox.top * 1.004 && last15.c >= breakBox.top * 0.998;
    const breakLowerWick = Math.min(last15.o, last15.c) - last15.l;
    const isBullishBounceOnTop = (breakLowerWick >= 0.30 * rng) || (last15.c > last15.o && (last15.c - last15.o) >= 0.35 * rng);

    // Điều kiện VPA Retest: Nến retest hoặc cạn cung (vol <= 1.25x) hoặc có lực cầu mua đỡ rút chân (vol >= 1.2x kèm nến bật tăng)
    const isValidRetestVolume = volRatio <= 1.25 || (volRatio >= 1.2 && isBullishBounceOnTop);

    if (allowLong && prevClosedAbove && isBreakoutVolumeExploded && isRetestingBoxTop && isBullishBounceOnTop && isValidRetestVolume) {
      const entry = last15.c;
      // Cắt lỗ đặt ngay dưới đỉnh hộp vừa phá - đệm an toàn 0.25%
      const stop = breakBox.top - entry * 0.0025;
      const risk = (entry - stop) / entry;

      if (risk >= 0.0025 && risk <= 0.025) {
        // TP1: Chiều cao hộp mới (100% biên độ hộp cũ) theo lý thuyết Hộp Bậc Thang
        const tp1 = entry + boxHeight;
        // TP2: 1.8 lần chiều cao hộp
        const tp2 = entry + 1.8 * boxHeight;
        const rrRatio = +((tp1 - entry) / (entry - stop)).toFixed(1);
        const rr2Ratio = +((tp2 - entry) / (entry - stop)).toFixed(1);

        if (rrRatio >= 1.3 || rr2Ratio >= 2.0) {
          return {
            kind: "DARVAS_BREAKOUT",
            side: 1,
            coin,
            entry,
            stop,
            tp: tp2,
            tp1,
            rrRatio,
            box: breakBox,
            volumeRatio: +volRatio.toFixed(1),
            barTime: last15.t,
            note: `🚀 Bứt phá Hộp Darvas [${breakBox.bottom.toFixed(4)} - ${breakBox.top.toFixed(4)}]: Nổ Vol phá đỉnh (${prevVolRatio.toFixed(1)}x), nến 15m hồi test rút chân giữ vững đỉnh hộp (S/R Flip). Target Hộp Mới TP1 = ${tp1.toFixed(4)}`,
          };
        }
      }
    }
  }

  // =========================================================================
  // 🔴 KÈO 3: THỦNG ĐÁY HỘP DARVAS (DARVAS BOX BREAKDOWN & RETEST - SHORT)
  // Bản chất: Cạnh dưới hộp bị xả thủng dứt khoát kèm Volume lớn -> chuyển sang hộp phân phối thấp hơn
  // =========================================================================
  if (breakBox && allowShort && !btcAllowance?.isBtcStrongPump) {
    const boxHeight = breakBox.top - breakBox.bottom;
    // Điều kiện 1: Nến trước đã xả mạnh đóng dứt khoát dưới đáy hộp
    const prevClosedBelow = prev15.c < breakBox.bottom && (breakBox.bottom - prev15.c) / breakBox.bottom >= 0.001;
    // Điều kiện VPA: Cây nến Breakdown BẮT BUỘC có Volume xả bùng nổ (tối thiểu >= 1.35x SMA20) xác nhận Big Boys bán tháo đục thủng sàn
    const isBreakdownVolumeExploded = prevVolRatio >= 1.35;

    // Điều kiện 2: Nến hiện tại hồi lên kiểm tra lại đáy hộp cũ (Retest đáy hộp từ dưới lên):
    // Râu trên thò vào mép đáy hộp cũ nhưng GIÁ ĐÓNG CỬA BẮT BUỘC RÚT VỀ DƯỚI ĐÁY HỘP (bị từ chối cản đẩy xuống)
    const isRetestingBoxBottom = last15.h >= breakBox.bottom * 0.996 && last15.c <= breakBox.bottom * 1.002;
    const upperWick = last15.h - Math.max(last15.o, last15.c);
    const isBearishRejectionOnBottom = (upperWick >= 0.30 * rng) || (last15.c < last15.o && (last15.o - last15.c) >= 0.35 * rng);

    // Điều kiện VPA Retest: Nến hồi test cạn cầu (vol <= 1.25x) hoặc có lực bán dội xuống (vol >= 1.2x kèm nến từ chối)
    const isValidShortRetestVolume = volRatio <= 1.25 || (volRatio >= 1.2 && isBearishRejectionOnBottom);

    if (prevClosedBelow && isBreakdownVolumeExploded && isRetestingBoxBottom && isBearishRejectionOnBottom && isValidShortRetestVolume) {
      const entry = last15.c;
      // Cắt lỗ đặt ngay trên đáy hộp vừa thủng + đệm an toàn 0.25%
      const stop = breakBox.bottom + entry * 0.0025;
      const risk = (stop - entry) / entry;

      if (risk >= 0.0025 && risk <= 0.025) {
        // TP1: Chiều cao hộp rơi xuống phía dưới (Target 1 hộp Darvas bên dưới)
        const tp1 = entry - boxHeight;
        const tp2 = entry - 1.8 * boxHeight;
        const rrRatio = +((entry - tp1) / (stop - entry)).toFixed(1);

        if (rrRatio >= 1.5) {
          return {
            kind: "DARVAS_BREAKDOWN_SHORT",
            side: -1,
            coin,
            entry,
            stop,
            tp: tp2,
            tp1,
            rrRatio,
            box: breakBox,
            volumeRatio: +volRatio.toFixed(1),
            barTime: last15.t,
            note: `🩸 Thủng Đáy Hộp Darvas [${breakBox.bottom.toFixed(4)} - ${breakBox.top.toFixed(4)}]: Nổ Vol xả thủng đáy (${prevVolRatio.toFixed(1)}x), nến 15m hồi test bị bán dội ngược từ chối cản. Target Hộp Dưới TP1 = ${tp1.toFixed(4)}`,
          };
        }
      }
    }
  }

  return null;
}
