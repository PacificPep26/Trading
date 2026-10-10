/** Nguồn chân lý cho policy trading. Chuẩn hóa v2.0.0 */
export const STRATEGY_VERSION = "paper-v2.3.1";
export const MAX_LEVERAGE = 10;
export const RISK_PER_TRADE = 0.10;
export const MAX_DRAWDOWN = 0.20;
export const MIN_STOP_DISTANCE = 0.015; // 1.5% tối thiểu (chặn micro-stop, tránh phí sàn nuốt lãi)
export const MAX_STOP_DISTANCE = 0.060; // 6.0% tối đa (chặn mega-stop, an toàn cho isolated x10)
export const MAX_PRICE_DRIFT = 0.0025;   // 0.25% tối đa trôi giá (chống vào trễ, đu đỉnh/đu đáy)

export type StrategyStatus = "research" | "paper" | "rejected";
export type Timeframe = "4H" | "1H" | "1D";
export type DecisionCode =
  | "ACCEPTED"
  | "PENDING_CONFIRMATION"
  | "RUNAWAY_PRICE"
  | "STRATEGY_NOT_PAPER"
  | "TREND_MISMATCH"
  | "INVALID_STOP"
  | "INVALID_DATA"
  | "STALE_SIGNAL"
  | "BOT_LOCKED"
  | "LOW_VOLUME"
  | "BTC_MOMENTUM_BLOCKED"
  | "EXTREME_FUNDING"
  | "FAKEOUT_WICK_TRAP";

export const STRATEGY_REGISTRY = {
  bos: { version: STRATEGY_VERSION, status: "paper" as StrategyStatus, timeframe: "4H" as Timeframe },
  double_top_bottom: { version: STRATEGY_VERSION, status: "paper" as StrategyStatus, timeframe: "4H" as Timeframe },
  pinbar_reversal: { version: STRATEGY_VERSION, status: "paper" as StrategyStatus, timeframe: "4H" as Timeframe },
  bos_1h: { version: STRATEGY_VERSION, status: "paper" as StrategyStatus, timeframe: "1H" as Timeframe },
  double_top_bottom_1h: { version: STRATEGY_VERSION, status: "paper" as StrategyStatus, timeframe: "1H" as Timeframe },
  pinbar_reversal_1h: { version: STRATEGY_VERSION, status: "paper" as StrategyStatus, timeframe: "1H" as Timeframe },
  daily_trend_donchian: { version: STRATEGY_VERSION, status: "paper" as StrategyStatus, timeframe: "1D" as Timeframe },
} as const;

export interface TradeSizing {
  notional: number;
  leverage: number;
  margin: number;
  actualRiskUsd: number;
  isCapped: boolean;
}

/** Kiểm tra điều kiện cấu trúc & xu hướng */
export function isAllowedSetup(style: string, side: 1 | -1, tf: Timeframe, btcDaily = 0, ownDaily = 0): boolean {
  // QUY TẮC BẢO VỆ CHỐNG BÃO (MACRO BTC FILTER):
  // 1. Tuyệt đối KHÔNG SHORT khi BTC Ngày đang là Uptrend (+1)
  if (side < 0 && btcDaily > 0) return false;
  // 2. Tuyệt đối KHÔNG LONG khi BTC Ngày đang là Downtrend (-1)
  if (side > 0 && btcDaily < 0) return false;

  if (tf === "1D") {
    if (style === "daily_trend_donchian") {
      return side > 0 ? btcDaily > 0 : btcDaily < 0;
    }
    return false;
  }
  if (tf === "4H") {
    if (style === "bos") {
      if (side > 0) return !(ownDaily < 0);
      if (side < 0) return !(ownDaily > 0);
    }
    if (style === "double_top_bottom" || style === "pinbar_reversal") {
      return true;
    }
    return false;
  }
  if (tf === "1H") {
    if (style === "double_top_bottom" || style === "pinbar_reversal" || style === "bos") {
      return true;
    }
    return false;
  }
  return false;
}

/** Setup 1H hợp lệ để lướt sóng hoặc cảnh báo sớm */
export function isWatchSetup(style: string, side: 1 | -1, tf: Timeframe): boolean {
  return tf === "1H" && (style === "double_top_bottom" || style === "pinbar_reversal" || style === "bos");
}

/** Đánh dấu KÈO ĐẸP ★★★ thuận đà sóng lớn */
export function isStarSetup(side: 1 | -1, ownDaily: number, btcDaily: number): boolean {
  if (side > 0) {
    return ownDaily > 0 && btcDaily > 0;
  } else {
    return ownDaily < 0 && btcDaily < 0;
  }
}

/**
 * Chỉ cho phép vào lệnh LIVE tiền thật đối với chiến lược đã được chứng minh
 * có kỳ vọng toán học dương sau phí Taker MEXC (0.16%) và trượt giá:
 * Hiện tại CHO PHÉP:
 * 1. 1D Daily Trend Donchian Breakout (khi BTC cùng hướng)
 * 2. 4H Breakout nền (BOS) & Double Top/Bottom khi ĐỒNG THUẬN HOÀN TOÀN với BTC & Coin Daily Trend.
 */
export function isLiveEligible(
  style: string,
  side: 1 | -1,
  tf: Timeframe,
  ownDaily: number,
  btcDaily: number
): boolean {
  if (tf === "1D" && style === "daily_trend_donchian") {
    return side > 0 ? btcDaily > 0 : btcDaily < 0;
  }
  const isFullyAligned = side > 0 ? (ownDaily > 0 && btcDaily > 0) : (ownDaily < 0 && btcDaily < 0);
  // Cho phép 4H phá nền (BOS) và 4H Mô hình đảo chiều khi đồng thuận xu hướng lớn với BTC
  return tf === "4H" && (style === "bos" || style === "double_top_bottom") && isFullyAligned;
}

/** Kiểm tra Funding Rate có nằm trong biên an toàn không (tránh bẫy phí và squeeze) */
export function isFundingSafe(rate?: number): boolean {
  if (rate === undefined || !Number.isFinite(rate)) return true;
  // Giới hạn an toàn: |Funding| <= 0.03% (0.0003)
  return Math.abs(rate) <= 0.0003;
}

/** Kiểm tra quán tính ngắn hạn của BTC (Intraday Momentum Spillover) */
export function isBtcMomentumBlocked(
  side: 1 | -1,
  btc1hBars?: { o: number; c: number; h: number; l: number }[]
): boolean {
  if (!btc1hBars || btc1hBars.length === 0) return false;
  const recent = btc1hBars.slice(-2);
  for (const bar of recent) {
    const movePct = (bar.c - bar.o) / bar.o;
    // Nếu BTC đang có cây nến 1H tăng dựng đứng (+0.7%) -> CẤM SHORT
    if (side < 0 && movePct >= 0.007) return true;
    // Nếu BTC đang có cây nến 1H cắm đầu mạnh (-0.7%) -> CẤM LONG
    if (side > 0 && movePct <= -0.007) return true;
  }
  return false;
}

/**
 * Tính toán vị thế chuẩn vốn 40$, rủi ro tối đa 10% equity (4$) tại điểm cắt lỗ.
 */
export function calculateSizing(equity: number, stopDistancePct: number): TradeSizing {
  if (!Number.isFinite(equity) || !Number.isFinite(stopDistancePct) || equity <= 0 || stopDistancePct <= 0) {
    return { notional: 0, leverage: 1, margin: 0, actualRiskUsd: 0, isCapped: false };
  }
  const riskBudget = equity * RISK_PER_TRADE; // 4$ trên 40$
  const maxNotional = equity * MAX_LEVERAGE;  // 400$
  const riskSizedNotional = riskBudget / stopDistancePct;
  const notional = Math.min(maxNotional, riskSizedNotional);
  const margin = notional / MAX_LEVERAGE;
  const actualRiskUsd = notional * stopDistancePct;

  return {
    notional: Math.round(notional * 10) / 10,
    leverage: MAX_LEVERAGE,
    margin: Math.round(margin * 10) / 10,
    actualRiskUsd: Math.round(actualRiskUsd * 100) / 100,
    isCapped: riskSizedNotional > maxNotional,
  };
}

/**
 * Tính toán lợi nhuận 2 bước với cơ chế Front-Running TP Buffer:
 * - TP1 ở 0.90R (chốt 50% vị thế) = +0.45R (khớp sớm, bảo toàn vốn)
 * - TP2 ở 1.85R (chốt 50% vị thế) = +0.925R (khớp trước đáy/đỉnh cản)
 * Tổng lãi khi ăn cả 2 TP = +1.375R ($5.50 trên risk $4.0)
 */
export function calculatePartialPnL(riskUsd: number) {
  const winTp1 = Math.round(riskUsd * 0.45 * 100) / 100;
  const winTp2 = Math.round(riskUsd * 0.925 * 100) / 100;
  return { winTp1, winTp2, totalWin: Math.round((winTp1 + winTp2) * 100) / 100 };
}

export function isDrawdownLocked(equity: number, peakEquity: number): boolean {
  if (!Number.isFinite(equity) || !Number.isFinite(peakEquity) || equity <= 0 || peakEquity <= 0) return true;
  return 1 - equity / peakEquity >= MAX_DRAWDOWN;
}

/** Tạo chuỗi giải thích lý do vào lệnh (Sao vô) súc tích, thực chiến */
export function formatEntryReason(params: {
  style: string;
  side: 1 | -1;
  timeframe: string;
  btcDaily?: number;
  ownDaily?: number;
  volumeRatio?: number;
}): string {
  const parts: string[] = [];

  if (params.style === "bos") {
    parts.push(params.side > 0 ? `BOS ${params.timeframe} phá cản` : `BOS ${params.timeframe} thủng hỗ trợ`);
    parts.push("Nến thân đặc xác nhận");
  } else if (params.style === "double_top_bottom") {
    parts.push(params.side > 0 ? `Hai đáy ${params.timeframe} xác nhận` : `Hai đỉnh ${params.timeframe} xác nhận`);
  } else if (params.style === "pinbar_reversal") {
    parts.push(params.side > 0 ? `Pinbar ${params.timeframe} rút chân hỗ trợ` : `Pinbar ${params.timeframe} rút râu cản`);
  } else {
    parts.push(`Mô hình ${params.timeframe} đạt chuẩn`);
  }

  if (params.volumeRatio && params.volumeRatio >= 1.0) {
    parts.push(`Volume nến x${params.volumeRatio.toFixed(1)} TB20`);
  }

  if (params.btcDaily !== undefined) {
    if (params.btcDaily > 0 && params.side > 0) {
      parts.push("Thuận BTC Ngày Tăng ↗");
    } else if (params.btcDaily < 0 && params.side < 0) {
      parts.push("Thuận BTC Ngày Giảm ↘");
    }
  }

  return parts.join(" + ");
}
