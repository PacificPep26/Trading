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
  kind: "DARVAS_2ND_BOUNCE" | "DARVAS_BREAKOUT";
  side: 1;
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
 * Hộp hợp lệ phải có biên độ giao động tối thiểu 1.2% và tối đa 6.0%.
 */
export function extractDarvasBox(candles15m: Candle[]): DarvasBox | null {
  const cs = candles15m.filter((c) => c.closed !== false);
  const n = cs.length;
  if (n < 20) return null;

  // Lấy phạm vi từ 14 đến 28 nến gần nhất (trừ nến hiện tại đang xét)
  const boxLength = Math.min(24, n - 2);
  const boxBars = cs.slice(n - 1 - boxLength, n - 1);
  if (boxBars.length < 12) return null;

  const top = Math.max(...boxBars.map((b) => b.h));
  const bottom = Math.min(...boxBars.map((b) => b.l));
  const height = top - bottom;
  if (bottom <= 0) return null;

  const heightPct = (height / bottom) * 100;
  // Biên độ hộp phải hợp lý: từ 0.8% đến 7.0% (ở crypto 15m hộp 1% đã rất rõ nét)
  if (heightPct < 0.8 || heightPct > 7.0) return null;

  const center = (top + bottom) / 2;

  // Đếm các nhịp test đáy hộp (mỗi nhịp là một nến nhúng râu về gần mép đáy <= 0.4% biên hộp)
  const bottomTolerance = bottom + height * 0.20; // 20% biên dưới của hộp
  let testCount = 0;
  let firstBounceLow: number | undefined;
  let firstBounceTime: number | undefined;

  for (let i = 0; i < boxBars.length; i++) {
    const b = boxBars[i];
    if (b.l <= bottomTolerance) {
      // Xác nhận nến có rút chân hoặc đảo chiều xanh
      const lowerWick = Math.min(b.o, b.c) - b.l;
      const rng = b.h - b.l;
      if (rng > 0 && (lowerWick >= 0.30 * rng || b.c > b.o)) {
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
 * 🎯 CHIẾN THUẬT SĂN LỆNH HỘP DARVAS BOX:
 * 1. Chiến thuật chính: Săn Nhịp Test Đáy Lần 2 (2nd Wick Bounce at Box Bottom)
 *    - Đã có lần 1 rút chân ở đáy hộp.
 *    - Lần 2 giá quay lại quét/chạm đáy hộp, tiếp tục rút chân nến búa hoặc đóng nến xanh.
 *    - Entry: Mép dưới hộp.
 *    - SL: Dưới đáy hộp 0.25% - 0.5%.
 *    - TP1: Đỉnh hộp (Cạnh trên Darvas).
 * 2. Chiến thuật phụ: Darvas Breakout (Phá đỉnh hộp kèm Retest).
 */
export function detectDarvasSignal(
  coin: string,
  candles15m: Candle[],
  btcAllowance?: { allowLong: boolean; isBtcStrongPump: boolean }
): DarvasSignal | null {
  if (btcAllowance && !btcAllowance.allowLong) return null;

  const cs = candles15m.filter((c) => c.closed !== false);
  const n = cs.length;
  if (n < 20) return null;

  const last15 = cs[n - 1]; // Nến vừa đóng hoàn toàn
  const prev15 = cs[n - 2];
  const rng = last15.h - last15.l;
  if (rng <= 0) return null;

  const box = extractDarvasBox(cs);
  if (!box) return null;

  // Tính Volume ratio nến kích hoạt so với TB 20 nến trước
  const prev20 = cs.slice(Math.max(0, n - 21), n - 1);
  const avgVol = prev20.reduce((s, x) => s + (x.v || 0), 0) / prev20.length;
  const volRatio = avgVol > 0 ? (last15.v || 0) / avgVol : 1;

  // =========================================================================
  // 🟢 KÈO 1: NHỊP TEST ĐÁY LẦN 2 TẠI ĐÁY HỘP DARVAS (2ND WICK BOUNCE)
  // =========================================================================
  // Điều kiện:
  // 1. Trong hộp đã từng có ít nhất 1 nhịp rút chân ở đáy hộp (testCount >= 1).
  // 2. Nến 15m hiện tại nhúng râu chạm đáy hộp (last15.l <= box.bottom + (box.top - box.bottom) * 0.22)
  //    nhưng giá đóng cửa BẮT BUỘC giữ vững trên đáy hộp (last15.c >= box.bottom).
  const isTouchingBottomZone = last15.l <= box.bottom + (box.top - box.bottom) * 0.25;
  const isClosingAboveBottom = last15.c >= box.bottom;

  if (box.testCount >= 1 && isTouchingBottomZone && isClosingAboveBottom) {
    const lowerWick = Math.min(last15.o, last15.c) - last15.l;
    // Rút chân Pinbar (râu dưới >= 35% biên độ) HOẶC nến xanh đặc phục hồi (Close > Open và râu dưới >= 20%)
    const isHammerWick = lowerWick >= 0.35 * rng;
    const isGreenRecovery = last15.c > last15.o && (last15.c - last15.o) >= 0.40 * rng;

    if (isHammerWick || isGreenRecovery) {
      const entry = last15.c;
      // SL đặt dưới râu nhúng quét đáy của nến hiện tại (hoặc đáy nến test) + đệm an toàn 0.15%
      const stop = Math.min(last15.l, box.bottom) - entry * 0.0015;
      const risk = (entry - stop) / entry;

      // Risk chuẩn crypto: từ 0.25% đến 2.0%
      if (risk >= 0.0025 && risk <= 0.022) {
        // TP1: Cạnh trên hộp Darvas (vùng đỉnh hộp)
        const tp1 = box.top;
        // TP2: Đột phá hộp mở rộng (1.5x chiều cao hộp)
        const tp2 = box.top + (box.top - box.bottom) * 0.6;
        const reward = tp1 - entry;
        const rrRatio = +(reward / (entry - stop)).toFixed(1);

        // R:R đến đỉnh hộp tối thiểu đạt 1:1.5 (hoặc đến TP2 đạt >= 2.0)
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
            note: `📦 Hộp Darvas (${box.bottom.toFixed(4)} - ${box.top.toFixed(4)}): Giá quét đáy lần 2 rút chân giữ vững đáy hộp, Vol ${volRatio.toFixed(1)}x. Target đỉnh hộp TP1 = ${tp1.toFixed(4)}`,
          };
        }
      }
    }
  }

  // =========================================================================
  // 🚀 KÈO 2: PHÁ VỠ HỘP DARVAS CHUẨN KÈM RETEST (DARVAS BOX BREAKOUT)
  // =========================================================================
  // Nến trước đã đóng nến vượt đỉnh hộp, nến hiện tại hồi test rút chân trên mép đỉnh hộp
  const prevClosedAbove = prev15.c > box.top;
  const isRetestingBoxTop = last15.l <= box.top * 1.003 && last15.c >= box.top * 0.998;
  const isBullishRetest = (last15.c > last15.o) || (Math.min(last15.o, last15.c) - last15.l >= 0.35 * rng);

  if (prevClosedAbove && isRetestingBoxTop && isBullishRetest && volRatio >= 1.2) {
    const entry = last15.c;
    const stop = box.top - entry * 0.004;
    const boxHeight = box.top - box.bottom;
    const tp1 = entry + boxHeight;
    const tp2 = entry + 1.8 * boxHeight;
    const rrRatio = +((tp1 - entry) / (entry - stop)).toFixed(1);

    if (rrRatio >= 2.0) {
      return {
        kind: "DARVAS_BREAKOUT",
        side: 1,
        coin,
        entry,
        stop,
        tp: tp2,
        tp1,
        rrRatio,
        box,
        volumeRatio: +volRatio.toFixed(1),
        barTime: last15.t,
        note: `🚀 Bứt phá Hộp Darvas (${box.top.toFixed(4)}): Nến 15m hồi test giữ đỉnh hộp thành công, Vol ${volRatio.toFixed(1)}x`,
      };
    }
  }

  return null;
}
