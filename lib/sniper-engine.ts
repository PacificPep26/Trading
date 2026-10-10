/**
 * Module Bắn Tỉa Đa Khung Thời Gian (Multi-Timeframe 15m Sniper Engine)
 * Thiết kế chuẩn Quant:
 * - 1H Breakout / BOS được đưa vào Radar rình mồi (Watchlist).
 * - Tự động hạ xuống nến 15m kiểm tra nhịp hồi quét thanh khoản (Retest / Sweep).
 * - Chỉ kích hoạt khi nến 15m xuất hiện phản ứng rút chân (Pinbar / Bullish Rejection).
 * - SL đặt dưới đáy râu 15m (siêu ngắn: ~0.6% - 1.0%), R:R tối thiểu 1:2.5.
 */

import type { Candle } from "./okx.ts";

export interface PendingSniperTarget {
  coin: string;
  side: 1 | -1;
  breakoutTime: number;
  breakoutPrice: number;
  brokenLevel: number;
  waveHigh: number;
  waveLow: number;
  atr1h: number;
  expiresAt: number; // Tối đa theo dõi trong 90 phút (6 nến 15m)
}

export interface SniperSignal {
  triggered: boolean;
  coin: string;
  side: 1 | -1;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  riskPct: number;
  reason: string;
}

// Bảng nhớ radar rình mồi toàn cục trong tiến trình server
declare global {
  var mtfSniperRadar: Map<string, PendingSniperTarget> | undefined;
}

export const sniperRadar = (globalThis.mtfSniperRadar ??= new Map<string, PendingSniperTarget>());

/**
 * Đăng ký một coin vừa phá vỡ đỉnh/đáy 1H vào Radar rình mồi
 */
export function registerSniperTarget(target: Omit<PendingSniperTarget, "expiresAt">): void {
  const expiresAt = Date.now() + 90 * 60 * 1000; // Theo dõi trong 90 phút
  sniperRadar.set(target.coin, { ...target, expiresAt });
  console.log(`[SNIPER RADAR] 🎯 Đã đưa ${target.coin} (${target.side > 0 ? "LONG" : "SHORT"}) vào radar 15m rình mồi quanh level ${target.brokenLevel}`);
}

/**
 * Quét kiểm tra nến 15m của một coin trong Radar xem đã có nhịp hồi và rút chân chuẩn chưa
 */
export function evaluate15mSniper(
  coin: string,
  bars15m: Candle[],
  now = Date.now()
): SniperSignal | null {
  const target = sniperRadar.get(coin);
  if (!target) return null;

  // Nếu quá hạn 90 phút mà không có nhịp kích hoạt -> Hủy theo dõi
  if (now > target.expiresAt) {
    sniperRadar.delete(coin);
    console.log(`[SNIPER RADAR] ⌛ Hết hạn theo dõi 15m cho ${coin}. Xóa khỏi radar.`);
    return null;
  }

  if (bars15m.length < 5) return null;

  // Lấy các nến 15m đóng cửa SAU thời điểm 1H phá vỡ
  const closedBars = bars15m.filter((b) => b.closed && b.t >= target.breakoutTime);
  if (closedBars.length === 0) return null;

  const latestBar = closedBars[closedBars.length - 1];
  const prevBar = closedBars.length >= 2 ? closedBars[closedBars.length - 2] : null;

  const level = target.brokenLevel;
  const waveRange = target.waveHigh - target.waveLow;
  if (waveRange <= 0) return null;

  // Vùng chiết khấu: Giá nhúng về gần mốc cản bị phá (trong khoảng -0.5% đến +0.4% quanh level)
  // hoặc hồi sâu 38.2% - 61.8% con sóng
  const discountZoneTop = target.waveHigh - 0.382 * waveRange;
  const discountZoneBottom = target.waveLow + 0.20 * waveRange;

  if (target.side > 0) {
    // LONG: Kiểm tra xem nến 15m có thò râu nhúng về vùng cản/chiết khấu rồi rút chân không
    const touchedSupport = latestBar.l <= Math.max(level * 1.004, discountZoneTop) && latestBar.l >= discountZoneBottom;
    if (!touchedSupport) return null;

    const body = Math.abs(latestBar.c - latestBar.o);
    const lowerWick = Math.min(latestBar.o, latestBar.c) - latestBar.l;
    const totalRange = latestBar.h - latestBar.l;

    // Điều kiện rút chân uy tín:
    // 1. Râu dưới dài hơn thân nến (Pinbar / Rejection) HOẶC đóng nến xanh bao phủ nến trước
    const isRejectionPinbar = lowerWick >= body && totalRange > 0 && (lowerWick / totalRange) >= 0.45;
    const isBullishEngulfing = prevBar ? (latestBar.c > prevBar.h && latestBar.c > latestBar.o) : false;

    if (isRejectionPinbar || isBullishEngulfing) {
      const entry = latestBar.c;
      // Cắt lỗ đặt ngay dưới râu nến 15m vừa nhúng xuống (trừ hao 0.1% chống quét râu nhẹ)
      const stop = latestBar.l * 0.999;
      const riskPct = (entry - stop) / entry;

      // Bảo vệ: Khoảng cách SL phải nằm trong khoảng an toàn (0.4% đến 2.0%)
      if (riskPct < 0.004 || riskPct > 0.025) return null;

      const riskDist = entry - stop;
      const tp1 = entry + 1.5 * riskDist; // TP1 1.5R (về đỉnh cũ)
      const tp2 = entry + 3.0 * riskDist; // TP2 3.0R (vào sóng lớn)

      // Kích hoạt thành công -> Xóa khỏi radar để không bắn trùng
      sniperRadar.delete(coin);

      return {
        triggered: true,
        coin,
        side: 1,
        entry,
        stop,
        tp1,
        tp2,
        riskPct,
        reason: isRejectionPinbar
          ? `Nến 15m thò râu quét thanh khoản cản ${level.toFixed(3)} và rút chân mạnh (Pinbar Râu ${(lowerWick / totalRange * 100).toFixed(0)}%)`
          : `Nến 15m đóng xanh bao phủ cản ${level.toFixed(3)}, phe Mua đã vào đẩy sóng`,
      };
    }
  } else {
    // SHORT: Kiểm tra xem nến 15m có thò râu lên cản rồi xả xuống không
    const touchedResistance = latestBar.h >= Math.min(level * 0.996, target.waveLow + 0.382 * waveRange) && latestBar.h <= (target.waveHigh - 0.20 * waveRange);
    if (!touchedResistance) return null;

    const body = Math.abs(latestBar.c - latestBar.o);
    const upperWick = latestBar.h - Math.max(latestBar.o, latestBar.c);
    const totalRange = latestBar.h - latestBar.l;

    const isRejectionPinbar = upperWick >= body && totalRange > 0 && (upperWick / totalRange) >= 0.45;
    const isBearishEngulfing = prevBar ? (latestBar.c < prevBar.l && latestBar.c < latestBar.o) : false;

    if (isRejectionPinbar || isBearishEngulfing) {
      const entry = latestBar.c;
      const stop = latestBar.h * 1.001;
      const riskPct = (stop - entry) / entry;

      if (riskPct < 0.004 || riskPct > 0.025) return null;

      const riskDist = stop - entry;
      const tp1 = entry - 1.5 * riskDist;
      const tp2 = entry - 3.0 * riskDist;

      sniperRadar.delete(coin);

      return {
        triggered: true,
        coin,
        side: -1,
        entry,
        stop,
        tp1,
        tp2,
        riskPct,
        reason: isRejectionPinbar
          ? `Nến 15m thò râu quét cản ${level.toFixed(3)} và bị từ chối giá mạnh (Pinbar râu ${(upperWick / totalRange * 100).toFixed(0)}%)`
          : `Nến 15m đóng đỏ bao phủ cản ${level.toFixed(3)}, phe Bán áp đảo`,
      };
    }
  }

  return null;
}

/**
 * 1. MẢNH GHÉP KHUNG GIỜ VÀNG (Session Open Filter)
 * Xác định phiên giao dịch có dòng tiền lớn: London (14:00 - 18:00 VN) & New York (20:30 - 00:30 VN)
 */
export function getTradingSessionInfo(date = new Date()): {
  session: "London" | "New York" | "Asian" | "Off-hours";
  isHighVolumeWindow: boolean;
  multiplierText: string;
} {
  const vnHour = (date.getUTCHours() + 7) % 24;
  const vnMinute = date.getUTCMinutes();
  const timeNum = vnHour + vnMinute / 60;

  // Phiên London: 14:00 - 18:00 VN
  if (timeNum >= 14.0 && timeNum < 18.0) {
    return { session: "London", isHighVolumeWindow: true, multiplierText: "🔥 Phiên London (Tiền to Châu Âu đang vào)" };
  }
  // Phiên New York (Phố Wall): 20:30 - 00:30 VN
  if ((timeNum >= 20.5 && timeNum <= 24.0) || timeNum < 0.5) {
    return { session: "New York", isHighVolumeWindow: true, multiplierText: "🚀 Phiên New York / Phố Wall (Thanh khoản đỉnh cao)" };
  }
  // Phiên Á: 07:00 - 12:00 VN
  if (timeNum >= 7.0 && timeNum < 12.0) {
    return { session: "Asian", isHighVolumeWindow: false, multiplierText: "☕ Phiên Châu Á (Thanh khoản vừa phải)" };
  }
  return { session: "Off-hours", isHighVolumeWindow: false, multiplierText: "🌙 Khung giờ tĩnh (Thanh khoản mỏng)" };
}

/**
 * 2. MẢNH GHÉP HẤP THỤ LỰC XẢ (Volume Absorption Detection)
 * Phát hiện khi nến có Volume cực đại (> 2.0x) nhưng giá rút chân mạnh (Cá mập hấp thụ hàng)
 */
export function detectVolumeAbsorption(candles: Candle[]): {
  isAbsorption: boolean;
  type?: "bullish_absorption" | "bearish_absorption";
  ratio: number;
} {
  if (candles.length < 21) return { isAbsorption: false, ratio: 1.0 };
  const current = candles[candles.length - 1];
  const prev20 = candles.slice(-21, -1);
  const avgVol = prev20.reduce((sum, c) => sum + c.v, 0) / 20;
  const ratio = avgVol > 0 ? current.v / avgVol : 1.0;

  if (ratio >= 2.0) {
    const totalRange = current.h - current.l;
    if (totalRange <= 0) return { isAbsorption: false, ratio };
    const lowerWick = Math.min(current.o, current.c) - current.l;
    const upperWick = current.h - Math.max(current.o, current.c);

    if (lowerWick / totalRange >= 0.4) {
      return { isAbsorption: true, type: "bullish_absorption", ratio };
    }
    if (upperWick / totalRange >= 0.4) {
      return { isAbsorption: true, type: "bearish_absorption", ratio };
    }
  }
  return { isAbsorption: false, ratio };
}

/**
 * 3. MẢNH GHÉP BẪY ÉP PHÍ TÀI TRỢ (Funding Squeeze Anomaly)
 * Phát hiện phe Short bị ép phí âm nặng (âm sâu <= -0.05%), dễ kích hoạt Short Squeeze bắn dựng cột
 */
export function detectFundingSqueeze(fundingRate?: number): {
  isSqueezeSetup: boolean;
  direction?: 1 | -1;
  desc: string;
} {
  if (fundingRate === undefined || !Number.isFinite(fundingRate)) {
    return { isSqueezeSetup: false, desc: "Funding bình thường" };
  }
  // Short squeeze: Đám đông Short quá đà (Funding âm sâu <= -0.05%)
  if (fundingRate <= -0.0005) {
    return {
      isSqueezeSetup: true,
      direction: 1, // Thiên hướng Long ép Short cháy
      desc: `⚡ BẪY ÉP PHÍ SHORT SQUEEZE: Funding âm nặng (${(fundingRate * 100).toFixed(3)}%). Phe Short đang bị bào mòn phí, dễ kích hoạt cột nổ dựng đứng!`,
    };
  }
  // Long squeeze: Đám đông Long fomo quá đà (Funding dương cao >= +0.06%)
  if (fundingRate >= 0.0006) {
    return {
      isSqueezeSetup: true,
      direction: -1, // Thiên hướng Short ép Long buông tay
      desc: `⚠️ BẪY ÉP PHÍ LONG SQUEEZE: Funding dương cực cao (${(fundingRate * 100).toFixed(3)}%). Phe Long đang chịu phí khủng, dễ có cây xả rũ!`,
    };
  }
  return { isSqueezeSetup: false, desc: "Funding ổn định" };
}
