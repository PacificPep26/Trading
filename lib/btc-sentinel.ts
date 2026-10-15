import fs from "fs";
import path from "path";
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

export type BtcInvalidation = {
  side: 1 | -1;
  sweepPrice: number;
  breakPrice: number;
  time: number;
  note: string;
};

export type BtcSentinel = {
  dailyTrend: 1 | -1 | 0; // 1: Tăng, -1: Giảm, 0: Đi ngang
  allowLong: boolean;
  allowShort: boolean;
  sweep: BtcSweepSignal | null;
  invalidation: BtcInvalidation | null;
  statusText: string;
};

const DAY = 86_400_000;
const SWEEP_VALIDITY_MS = 3 * 3_600_000; // Cờ La Bàn có hiệu lực tối đa 3 giờ (12 cây nến 15m)
const STATE_FILE = path.join(process.cwd(), "data", "btc-sentinel-state.json");

type SentinelState = {
  activeSweep: BtcSweepSignal | null;
  lastInvalidated?: BtcInvalidation | null;
};

function loadState(): SentinelState {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {}
  return { activeSweep: null };
}

function saveState(state: SentinelState) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (e) {
    console.error("[SENTINEL] Không lưu được state:", e);
  }
}

/**
 * Phân tích cấu trúc BTC làm La Bàn Thị Trường đa khung thời gian (4H/1H/15m):
 * 1. Phát hiện cú quét thanh khoản đáy (Sweep Long) hoặc đỉnh (Sweep Short) của BTC theo cả PDL/PDH và Swing Low/High 4H/đa ngày.
 * 2. Bắt ngay cú rút râu mạnh trên khung 15m tại các vùng cản lớn.
 * 3. ĐIỀU KIỆN PHẾ TRUẤT (INVALIDATION): Nếu giá thủng mốc râu quét -> Lập tức thu hồi cờ Long và phát cảnh báo khẩn cấp.
 * 4. Khoá chiều ngược lại trên toàn bộ Altcoin (BTC quét đáy rút chân -> CẤM SHORT Altcoin).
 */
export function analyseBtcSentinel(
  btcBars1h: Candle[],
  btcDailyTrend: 1 | -1 | 0,
  btcBars15m?: Candle[],
  btcBars4h?: Candle[]
): BtcSentinel {
  const cs = btcBars1h.filter((c) => c.closed !== false);
  const n = cs.length;
  if (n < 25) {
    return {
      dailyTrend: btcDailyTrend,
      allowLong: btcDailyTrend >= 0,
      allowShort: btcDailyTrend <= 0,
      sweep: null,
      invalidation: null,
      statusText: "BTC chưa đủ dữ liệu",
    };
  }

  const c = cs[n - 1]; // nến 1H vừa đóng
  const closed15m = (btcBars15m ?? []).filter((b) => b.closed !== false);
  const currentPrice = closed15m.at(-1)?.c ?? c.c;
  const state = loadState();

  // ==========================================
  // BƯỚC 1: XÁC ĐỊNH CẤU TRÚC XU HƯỚNG 4H & 1H (MARKET STRUCTURE)
  // Không chỉ nhìn Daily EMA50 (bị trễ hàng nghìn giá khi dump/pump)
  // ==========================================
  let ema20_1h = cs[0].c, ema50_1h = cs[0].c;
  for (const x of cs) {
    ema20_1h += (2 / 21) * (x.c - ema20_1h);
    ema50_1h += (2 / 51) * (x.c - ema50_1h);
  }
  const trend1h: 1 | -1 | 0 =
    currentPrice < ema20_1h && ema20_1h < ema50_1h
      ? -1
      : currentPrice > ema20_1h && ema20_1h > ema50_1h
      ? 1
      : currentPrice > ema20_1h
      ? 1
      : -1;

  let trend4h: 1 | -1 | 0 = trend1h;
  if (btcBars4h && btcBars4h.length >= 20) {
    const c4 = btcBars4h.filter((x) => x.closed !== false);
    if (c4.length >= 20) {
      let ema20_4h = c4[0].c, ema50_4h = c4[0].c;
      for (const x of c4) {
        ema20_4h += (2 / 21) * (x.c - ema20_4h);
        ema50_4h += (2 / 51) * (x.c - ema50_4h);
      }
      trend4h =
        currentPrice < ema20_4h && ema20_4h < ema50_4h
          ? -1
          : currentPrice > ema20_4h && ema20_4h > ema50_4h
          ? 1
          : currentPrice > ema20_4h
          ? 1
          : -1;
    }
  }

  // Cấu trúc chủ đạo: Nếu cả 4H và 1H đồng thuận giảm -> CẤM LONG ALTCOIN
  const marketStructure: 1 | -1 | 0 =
    trend4h === -1 && trend1h === -1
      ? -1
      : trend4h === 1 && trend1h === 1
      ? 1
      : trend4h;

  // ==========================================
  // BƯỚC 2: KIỂM TRA ĐIỀU KIỆN PHẾ TRUẤT (INVALIDATION)
  // ==========================================
  if (state.activeSweep) {
    const sw = state.activeSweep;
    const isExpired = c.t - sw.barTime > SWEEP_VALIDITY_MS;

    if (isExpired) {
      state.activeSweep = null;
      saveState(state);
    } else {
      // Nếu đang cờ LONG mà giá hiện tại đâm thủng đáy râu quét -> PHẾ TRUẤT NGAY!
      if (sw.side === 1 && currentPrice < sw.sweepPrice) {
        const inv: BtcInvalidation = {
          side: 1,
          sweepPrice: sw.sweepPrice,
          breakPrice: currentPrice,
          time: Date.now(),
          note: `BTC đã đâm thủng đáy quét ${Math.round(sw.sweepPrice)} (giá hiện tại: ${Math.round(currentPrice)}). Bẫy quét 2 nhịp (Second Sweep)!`,
        };
        state.activeSweep = null;
        state.lastInvalidated = inv;
        saveState(state);

        return {
          dailyTrend: marketStructure,
          allowLong: false, // KHÓA TOÀN BỘ LONG NGAY LẬP TỨC
          allowShort: true, // Mở Short theo đà thủng đáy
          sweep: null,
          invalidation: inv,
          statusText: `🚨 PHẾ TRUẤT LA BÀN BTC: ${inv.note}`,
        };
      }

      // Nếu đang cờ SHORT mà giá hiện tại vượt đỉnh râu quét -> PHẾ TRUẤT NGAY!
      if (sw.side === -1 && currentPrice > sw.sweepPrice) {
        const inv: BtcInvalidation = {
          side: -1,
          sweepPrice: sw.sweepPrice,
          breakPrice: currentPrice,
          time: Date.now(),
          note: `BTC đã vượt qua đỉnh quét ${Math.round(sw.sweepPrice)} (giá hiện tại: ${Math.round(currentPrice)}).`,
        };
        state.activeSweep = null;
        state.lastInvalidated = inv;
        saveState(state);

        return {
          dailyTrend: marketStructure,
          allowLong: true,
          allowShort: false,
          sweep: null,
          invalidation: inv,
          statusText: `🚨 PHẾ TRUẤT LA BÀN BTC: ${inv.note}`,
        };
      }
    }
  }

  // ==========================================
  // BƯỚC 3: PHÁT HIỆN CÚ QUÉT MỚI (SWEEP DETECTION)
  // Chỉ kích hoạt tại các đáy/đỉnh MACRO THẬT SỰ kèm nến đảo chiều & Volume lớn
  // ==========================================
  const day = Math.floor(c.t / DAY);
  const prevDay = cs.filter((x) => Math.floor(x.t / DAY) === day - 1);
  const pdl = prevDay.length >= 10 ? Math.min(...prevDay.map((x) => x.l)) : Math.min(...cs.slice(Math.max(0, n - 25), n - 1).map((x) => x.l));
  const pdh = prevDay.length >= 10 ? Math.max(...prevDay.map((x) => x.h)) : Math.max(...cs.slice(Math.max(0, n - 25), n - 1).map((x) => x.h));
  const macroLow = Math.min(...cs.map((x) => x.l));
  const macroHigh = Math.max(...cs.map((x) => x.h));

  // Tính volume trung bình 10 nến 1H gần nhất
  const prev10 = cs.slice(Math.max(0, n - 11), n - 1);
  const avgVol = prev10.length > 0 ? prev10.reduce((s, x) => s + (x.v || 0), 0) / prev10.length : 0;
  const isVolConfirmed = avgVol > 0 ? (c.v || 0) >= avgVol * 1.15 : false;

  let sweep: BtcSweepSignal | null = state.activeSweep;

  // Nếu chưa có active sweep trong cache, kiểm tra nến 1H vừa đóng
  if (!sweep) {
    const range1h = c.h - c.l;
    const lowerWick1h = Math.min(c.o, c.c) - c.l;
    const upperWick1h = c.h - Math.max(c.o, c.c);

    // Nến rút chân thật sự (Real Bullish Rejection):
    // - Nến xanh (c.c >= c.o): râu dưới >= 50% biên độ
    // - Nến đỏ (c.c < c.o): bắt buộc phải là Pinbar Hammer râu cực dài >= 65% biên độ
    // Tuyệt đối loại bỏ nến đỏ râu ngắn (phe bán áp đảo)
    const isRealBullishRejection =
      range1h >= 300 && ((c.c >= c.o && lowerWick1h >= 0.5 * range1h) || lowerWick1h >= 0.65 * range1h);

    // Trong xu hướng GIẢM (Downtrend), cú quét đáy Long BẮT BUỘC phải quét thủng đáy sâu nhất Macro Low hoặc PDL
    // Tuyệt đối không bắt các swing đáy lơ lửng ở lưng chừng sóng giảm!
    const isMacroLowSwept = c.l <= macroLow + 20 && c.c >= macroLow;
    const isPdlSwept = c.l < pdl && c.c >= pdl;

    if ((isMacroLowSwept || isPdlSwept) && isRealBullishRejection && isVolConfirmed) {
      const ref = isMacroLowSwept ? macroLow : pdl;
      sweep = {
        side: 1,
        refPrice: ref,
        sweepPrice: c.l,
        entry: c.c,
        stop: c.l - 50,
        tp: pdh,
        barTime: c.t,
        note: `BTC quét đáy ${Math.round(c.l)} rút chân giữ vững cản ${Math.round(ref)} (râu ${((lowerWick1h / range1h) * 100).toFixed(0)}%, Vol ${(c.v || 0).toFixed(0)})`,
      };
    }

    // Nến rút râu trên thật sự (Real Bearish Rejection):
    const isRealBearishRejection =
      range1h >= 300 && ((c.c <= c.o && upperWick1h >= 0.5 * range1h) || upperWick1h >= 0.65 * range1h);
    const isMacroHighSwept = c.h >= macroHigh - 20 && c.c <= macroHigh;
    const isPdhSwept = c.h > pdh && c.c <= pdh;

    if (!sweep && (isMacroHighSwept || isPdhSwept) && isRealBearishRejection && isVolConfirmed) {
      const ref = isMacroHighSwept ? macroHigh : pdh;
      sweep = {
        side: -1,
        refPrice: ref,
        sweepPrice: c.h,
        entry: c.c,
        stop: c.h + 50,
        tp: pdl,
        barTime: c.t,
        note: `BTC quét đỉnh ${Math.round(c.h)} rút râu dưới cản ${Math.round(ref)} (râu ${((upperWick1h / range1h) * 100).toFixed(0)}%, Vol ${(c.v || 0).toFixed(0)})`,
      };
    }
  }

  // 2. Khung 15m: Chỉ bắt quét râu đáy sâu nhất macroLow hoặc đỉnh macroHigh
  if (!sweep && closed15m.length >= 16) {
    const recent15m = closed15m.slice(-16);
    let lowest15m = recent15m[0];
    for (const b of recent15m) {
      if (b.l < lowest15m.l) lowest15m = b;
    }

    const r15 = lowest15m.h - lowest15m.l;
    const lw15 = Math.min(lowest15m.o, lowest15m.c) - lowest15m.l;
    const is15mBullishPin = (lowest15m.c >= lowest15m.o && lw15 >= 0.55 * r15) || lw15 >= 0.7 * r15;

    const avgVol15 = recent15m.reduce((s, x) => s + (x.v || 0), 0) / recent15m.length;
    const hasVol15 = avgVol15 > 0 ? (lowest15m.v || 0) >= avgVol15 * 1.2 : false;

    // Chỉ tính nếu đáy 15m này thực sự quét qua macroLow
    if (lowest15m.l <= macroLow + 20 && r15 >= 300 && is15mBullishPin && hasVol15 && currentPrice >= lowest15m.l + 350) {
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

  // Nếu tìm thấy sweep mới, lưu vào state
  if (sweep && (!state.activeSweep || state.activeSweep.barTime !== sweep.barTime)) {
    state.activeSweep = sweep;
    saveState(state);
  }

  // Xu hướng quyết định chiều lệnh:
  // Mặc định thuận theo cấu trúc 4H/1H (marketStructure)
  let allowLong = marketStructure > 0;
  let allowShort = marketStructure < 0;

  if (sweep?.side === 1) {
    allowLong = true;
    allowShort = false; // CHẶN HẾT SHORT KHI CÓ QUÉT ĐÁY MACRO XÁC NHẬN
  } else if (sweep?.side === -1) {
    allowLong = false; // CHẶN HẾT LONG KHI CÓ QUÉT ĐỈNH MACRO XÁC NHẬN
    allowShort = true;
  }

  const statusText = sweep
    ? `⚡ ${sweep.note} → ${sweep.side > 0 ? "ƯU TIÊN LONG, CẤM SHORT ALTCOIN" : "ƯU TIÊN SHORT, CẤM LONG ALTCOIN"}`
    : `Cấu trúc BTC 4H/1H: ${marketStructure > 0 ? "TĂNG ↗ (chỉ lọc Long altcoin)" : marketStructure < 0 ? "GIẢM ↘ (CẤM LONG, chỉ lọc Short altcoin)" : "LƯỠNG LỰ / TRANH CHẤP"}`;

  return { dailyTrend: marketStructure, allowLong, allowShort, sweep, invalidation: null, statusText };
}
