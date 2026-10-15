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
 * Phân tích cấu trúc BTC làm La Bàn Thị Trường đa khung thời gian (4H/1H/15m):
 * 1. Phát hiện cú quét thanh khoản đáy (Sweep Long) hoặc đỉnh (Sweep Short) của BTC theo cả PDL/PDH và Swing Low/High 4H/đa ngày.
 * 2. Bắt ngay cú rút râu mạnh trên khung 15m tại các vùng cản lớn.
 * 3. Khoá chiều ngược lại trên toàn bộ Altcoin (BTC quét đáy rút chân -> CẤM SHORT Altcoin).
 */
export function analyseBtcSentinel(
  btcBars1h: Candle[],
  btcDailyTrend: 1 | -1 | 0,
  btcBars15m?: Candle[]
): BtcSentinel {
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

  // 1. Tìm các Swing Low/High quan trọng trong 100 nến 1H gần nhất (~ 4 ngày)
  const majorSwingLows: number[] = [];
  const majorSwingHighs: number[] = [];
  for (let i = 2; i < n - 2; i++) {
    if (cs[i].l < cs[i - 1].l && cs[i].l < cs[i - 2].l && cs[i].l < cs[i + 1].l && cs[i].l < cs[i + 2].l) {
      majorSwingLows.push(cs[i].l);
    }
    if (cs[i].h > cs[i - 1].h && cs[i].h > cs[i - 2].h && cs[i].h > cs[i + 1].h && cs[i].h > cs[i + 2].h) {
      majorSwingHighs.push(cs[i].h);
    }
  }

  let sweep: BtcSweepSignal | null = null;

  // 2. Kiểm tra nến 1H vừa đóng: SFP qua PDL hoặc qua Swing Low lớn
  const range1h = c.h - c.l;
  const lowerWick1h = Math.min(c.o, c.c) - c.l;
  const upperWick1h = c.h - Math.max(c.o, c.c);

  const sweptSwingLow1h = majorSwingLows.find((sl) => c.l < sl && c.c >= sl);
  if ((c.l < pdl && c.c > pdl && lowerWick1h >= 0.35 * range1h) || sweptSwingLow1h) {
    const ref = sweptSwingLow1h ?? pdl;
    sweep = {
      side: 1,
      refPrice: ref,
      sweepPrice: c.l,
      entry: c.c,
      stop: c.l - 50,
      tp: pdh,
      barTime: c.t,
      note: `BTC quét đáy ${Math.round(c.l)} rút chân giữ vững cản ${Math.round(ref)} (râu ${range1h > 0 ? ((lowerWick1h / range1h) * 100).toFixed(0) : 0}%)`,
    };
  }

  const sweptSwingHigh1h = majorSwingHighs.find((sh) => c.h > sh && c.c <= sh);
  if (!sweep && ((c.h > pdh && c.c < pdh && upperWick1h >= 0.35 * range1h) || sweptSwingHigh1h)) {
    const ref = sweptSwingHigh1h ?? pdh;
    sweep = {
      side: -1,
      refPrice: ref,
      sweepPrice: c.h,
      entry: c.c,
      stop: c.h + 50,
      tp: pdl,
      barTime: c.t,
      note: `BTC quét đỉnh ${Math.round(c.h)} rút râu dưới cản ${Math.round(ref)} (râu ${range1h > 0 ? ((upperWick1h / range1h) * 100).toFixed(0) : 0}%)`,
    };
  }

  // 3. Nếu 1H chưa kích hoạt, kiểm tra khung 15m gần nhất (trong 16 nến 15m ~ 4 giờ qua):
  if (!sweep && btcBars15m && btcBars15m.length >= 16) {
    const closed15m = btcBars15m.filter((b) => b.closed !== false);
    const recent15m = closed15m.slice(-16);
    const currentPrice = closed15m.at(-1)?.c ?? c.c;

    // Tìm cây nến 15m quét râu sâu nhất (thấp nhất trong 4h qua)
    let lowest15m = recent15m[0];
    for (const b of recent15m) {
      if (b.l < lowest15m.l) lowest15m = b;
    }

    const r15 = lowest15m.h - lowest15m.l;
    const lw15 = Math.min(lowest15m.o, lowest15m.c) - lowest15m.l;

    // Đạt chuẩn Quét Thật 15m: Râu dưới >= 35%, biên độ nến >= 250$, và giá hiện tại vẫn đang giữ cao hơn đáy râu >= 300$
    if (r15 >= 250 && lw15 >= 0.35 * r15 && currentPrice >= lowest15m.l + 300) {
      sweep = {
        side: 1,
        refPrice: lowest15m.l,
        sweepPrice: lowest15m.l,
        entry: currentPrice,
        stop: lowest15m.l - 50,
        tp: pdh,
        barTime: lowest15m.t,
        note: `BTC quét đáy ${Math.round(lowest15m.l)} khung 15m rút râu ${((lw15 / r15) * 100).toFixed(0)}%, giá đang giữ trên ${Math.round(currentPrice)}`,
      };
    }
  }

  let allowLong = btcDailyTrend >= 0;
  let allowShort = btcDailyTrend <= 0;

  if (sweep?.side === 1) {
    allowLong = true;
    allowShort = false; // CHẶN HẾT SHORT TRÊN TOÀN THỊ TRƯỜNG KHI BTC VỪA QUÉT ĐÁY RÚT CHÂN
  } else if (sweep?.side === -1) {
    allowLong = false; // CHẶN HẾT LONG TRÊN TOÀN THỊ TRƯỜNG KHI BTC VỪA QUÉT ĐỈNH RÚT RÂU
    allowShort = true;
  }

  const statusText = sweep
    ? `⚡ ${sweep.note} → ${sweep.side > 0 ? "ƯU TIÊN LONG, CẤM SHORT ALTCOIN" : "ƯU TIÊN SHORT, CẤM LONG ALTCOIN"}`
    : `BTC xu hướng ngày: ${btcDailyTrend > 0 ? "TĂNG ↗ (chặn short altcoin)" : btcDailyTrend < 0 ? "GIẢM ↘ (chặn long altcoin)" : "LƯỠNG LỰ"}`;

  return { dailyTrend: btcDailyTrend, allowLong, allowShort, sweep, statusText };
}

