import type { Candle } from "./okx";

export type BtcSweepSignal = {
  side: 1 | -1;
  refPrice: number;
  sweepPrice: number;
  entry: number;
  stop: number;
  tp: number;
  barTime: number;
  note: string;
};

export type BtcSentinel = {
  dailyTrend: 1 | -1 | 0; // 1: Tăng, -1: Giảm, 0: Đi ngang
  allowLong: boolean;
  allowShort: boolean;
  sweep: BtcSweepSignal | null;
  statusText: string;
};

const DAY = 86_400_000;

/**
 * Phân tích cấu trúc BTC làm La Bàn Thị Trường:
 * 1. Phát hiện cú quét thanh khoản đáy (Sweep Long) hoặc đỉnh (Sweep Short) của BTC.
 * 2. Khoá chiều ngược lại trên toàn bộ Altcoin (BTC quét đáy rút chân -> CẤM SHORT Altcoin).
 */
export function analyseBtcSentinel(btcBars1h: Candle[], btcDailyTrend: 1 | -1 | 0): BtcSentinel {
  const cs = btcBars1h.filter((c) => c.closed !== false);
  const n = cs.length;
  if (n < 25) {
    return {
      dailyTrend: btcDailyTrend,
      allowLong: btcDailyTrend >= 0,
      allowShort: btcDailyTrend <= 0,
      sweep: null,
      statusText: "BTC chưa đủ dữ liệu",
    };
  }

  const c = cs[n - 1]; // nến 1H vừa đóng
  const day = Math.floor(c.t / DAY);
  const prevDay = cs.filter((x) => Math.floor(x.t / DAY) === day - 1);
  const pdl = prevDay.length >= 10 ? Math.min(...prevDay.map((x) => x.l)) : Math.min(...cs.slice(Math.max(0, n - 25), n - 1).map((x) => x.l));
  const pdh = prevDay.length >= 10 ? Math.max(...prevDay.map((x) => x.h)) : Math.max(...cs.slice(Math.max(0, n - 25), n - 1).map((x) => x.h));

  const range = c.h - c.l;
  const lowerWick = Math.min(c.o, c.c) - c.l;
  const upperWick = c.h - Math.max(c.o, c.c);

  let sweep: BtcSweepSignal | null = null;

  // 1. Quét đáy rút chân (SFP / Sweep Long): thọc thủng PDL/đáy 24h nhưng đóng nến bên trên, râu dưới >= 38%
  if (c.l < pdl && c.c > pdl && range > 0 && lowerWick >= 0.38 * range) {
    const stop = c.l - 50; // SL dưới râu quét 50$
    sweep = {
      side: 1,
      refPrice: pdl,
      sweepPrice: c.l,
      entry: c.c,
      stop,
      tp: pdh,
      barTime: c.t,
      note: `BTC quét đáy ${Math.round(c.l)} rút chân vượt ${Math.round(pdl)} (râu ${((lowerWick / range) * 100).toFixed(0)}%)`,
    };
  }
  // 2. Quét đỉnh rút râu (SFP / Sweep Short): thọc thủng PDH/đỉnh 24h nhưng đóng nến bên dưới, râu trên >= 38%
  else if (c.h > pdh && c.c < pdh && range > 0 && upperWick >= 0.38 * range) {
    const stop = c.h + 50;
    sweep = {
      side: -1,
      refPrice: pdh,
      sweepPrice: c.h,
      entry: c.c,
      stop,
      tp: pdl,
      barTime: c.t,
      note: `BTC quét đỉnh ${Math.round(c.h)} rút râu dưới ${Math.round(pdh)} (râu ${((upperWick / range) * 100).toFixed(0)}%)`,
    };
  }

  // Nếu BTC vừa quét đáy -> BẮT BUỘC CHỈ LONG, CẤM TOÀN BỘ LỆNH SHORT ALTCOIN!
  // Nếu BTC vừa quét đỉnh -> BẮT BUỘC CHỈ SHORT, CẤM TOÀN BỘ LỆNH LONG ALTCOIN!
  // Nếu không có sweep: Phải tuân theo xu hướng ngày của BTC (BTC ngày tăng -> cấm short altcoin).
  let allowLong = btcDailyTrend >= 0;
  let allowShort = btcDailyTrend <= 0;

  if (sweep?.side === 1) {
    allowLong = true;
    allowShort = false; // CHẶN HẾT SHORT TRÊN TOÀN THỊ TRƯỜNG
  } else if (sweep?.side === -1) {
    allowLong = false; // CHẶN HẾT LONG TRÊN TOÀN THỊ TRƯỜNG
    allowShort = true;
  }

  const statusText = sweep
    ? `⚡ ${sweep.note} → ${sweep.side > 0 ? "ƯU TIÊN LONG, CẤM SHORT ALTCOIN" : "ƯU TIÊN SHORT, CẤM LONG ALTCOIN"}`
    : `BTC xu hướng ngày: ${btcDailyTrend > 0 ? "TĂNG ↗ (chặn short altcoin)" : btcDailyTrend < 0 ? "GIẢM ↘ (chặn long altcoin)" : "LƯỠNG LỰ"}`;

  return { dailyTrend: btcDailyTrend, allowLong, allowShort, sweep, statusText };
}
