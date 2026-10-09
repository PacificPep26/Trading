/**
 * trading-policy.ts
 * Hợp nhất TOÀN BỘ luật giao dịch giữa Website, Watchlist API và Bot Telegram.
 * Không để xảy ra tình trạng website một kiểu, bot một kiểu.
 */

export const MAX_LEVERAGE = 20;

export interface SetupPolicy {
  style: string;
  side: 1 | -1;
  entry: number;
  stop: number;
  timeframe: "4H" | "1H";
}

export interface TradeSizing {
  notional: number;
  leverage: number;
  margin: number;
  actualRiskUsd: number;
  isCapped: boolean;
}

/**
 * Kiểm tra xem một setup có được phép giao dịch theo luật đã kiểm chứng không:
 * - 4H: BOS LONG (không đánh BOS SHORT); Hai đỉnh SHORT (không đánh Hai đáy).
 * - 1H: CHỈ Hai đỉnh SHORT (không đánh Long).
 */
export function isAllowedSetup(style: string, side: 1 | -1, tf: "4H" | "1H"): boolean {
  if (tf === "4H") {
    if (style === "bos" && side > 0) return true; // BOS LONG
    if (style === "double_top_bottom" && side < 0) return true; // Hai đỉnh SHORT
    return false;
  }
  if (tf === "1H") {
    if (style === "double_top_bottom" && side < 0) return true; // Hai đỉnh SHORT
    return false;
  }
  return false;
}

/**
 * Kiểm tra xem setup có phải là KÈO ĐẸP ★★★ (thuận xu hướng ngày) không.
 * - LONG: khi BTC tăng VÀ coin tăng (so với EMA50 ngày)
 * - SHORT: khi BTC giảm HOẶC coin giảm (so với EMA50 ngày)
 */
export function isStarSetup(side: 1 | -1, ownDaily: number, btcDaily: number): boolean {
  if (side > 0) {
    return btcDaily > 0 && ownDaily > 0;
  } else {
    return ownDaily < 0;
  }
}

/**
 * Tính toán vị thế an toàn, giới hạn không vượt quá số dư tài khoản.
 * @param equity Vốn thực tế trong tài khoản (ví dụ 40$)
 * @param targetRiskUsd Rủi ro mong muốn (ví dụ 5$)
 * @param riskPct Khoảng cách dừng lỗ (|entry - stop| / entry)
 */
export function calculateSizing(equity: number, targetRiskUsd: number, riskPct: number): TradeSizing {
  if (riskPct <= 0) {
    return { notional: 0, leverage: 1, margin: 0, actualRiskUsd: 0, isCapped: false };
  }

  // Đòn bẩy an toàn: thanh lý xa hơn SL ít nhất 30%
  const safeLev = Math.min(MAX_LEVERAGE, Math.max(2, Math.floor(0.7 / riskPct)));

  // Sức mua tối đa của tài khoản (dùng tối đa 90% vốn để tránh thiếu ký quỹ)
  const maxNotional = equity * 0.9 * safeLev;

  // Vị thế lý tưởng theo rủi ro mục tiêu
  let idealNotional = targetRiskUsd / riskPct;
  let isCapped = false;

  if (idealNotional > maxNotional) {
    idealNotional = maxNotional;
    isCapped = true;
  }

  const margin = idealNotional / safeLev;
  const actualRiskUsd = idealNotional * riskPct;

  return {
    notional: Math.round(idealNotional * 10) / 10,
    leverage: safeLev,
    margin: Math.round(margin * 10) / 10,
    actualRiskUsd: Math.round(actualRiskUsd * 100) / 100,
    isCapped,
  };
}

/**
 * Tính toán lợi nhuận chuẩn toán học khi chốt 2 bước (50% ở TP1, 50% ở TP2).
 * Nếu risk = R ($):
 * TP1 ở 0.5R: lãi = 50% × 0.5 × R = +0.25R ($)
 * TP2 ở 1.0R: lãi = 50% × 1.0 × R = +0.50R ($)
 * Tổng lãi khi đạt cả 2 TP = +0.75R ($)
 */
export function calculatePartialPnL(riskUsd: number) {
  const winTp1 = riskUsd * 0.25; // 50% vị thế ở 0.5R
  const winTp2 = riskUsd * 0.50; // 50% vị thế ở 1.0R
  const totalWin = winTp1 + winTp2; // 0.75R
  return {
    winTp1,
    winTp2,
    totalWin,
  };
}
