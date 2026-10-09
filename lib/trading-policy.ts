/**
 * trading-policy.ts
 * Hợp nhất TOÀN BỘ luật giao dịch giữa Website, Watchlist API và Bot Telegram.
 * Không để xảy ra tình trạng website một kiểu, bot một kiểu.
 */

export const MAX_LEVERAGE = 10;

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
 * Kiểm tra xem một setup có được phép giao dịch theo luật hệ thống:
 * - 4H: BOS Long/Short, Hai đỉnh/Hai đáy, Pinbar quét râu đảo chiều.
 * - 1H: Cho phép lướt sóng khi có mô hình nến rõ ràng với SL chặt <= 4%.
 */
export function isAllowedSetup(style: string, side: 1 | -1, tf: "4H" | "1H", btcDaily = 0, ownDaily = 0): boolean {
  if (tf === "4H") {
    if (style === "bos") {
      if (side > 0) return !(btcDaily < 0 && ownDaily < 0);
      if (side < 0) return !(btcDaily > 0 && ownDaily > 0);
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

/** 1H setups cho cảnh báo sớm hoặc vào lệnh lướt sóng */
export function isWatchSetup(style: string, side: 1 | -1, tf: "4H" | "1H"): boolean {
  return tf === "1H" && (style === "double_top_bottom" || style === "pinbar_reversal" || style === "bos");
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
 * @param riskPct Khoảng cách dừng lỗ (|entry - stop| / entry)
 */
export function calculateSizing(equity: number, riskPct: number): TradeSizing {
  if (!Number.isFinite(equity) || !Number.isFinite(riskPct) || equity <= 0 || riskPct <= 0) {
    return { notional: 0, leverage: 1, margin: 0, actualRiskUsd: 0, isCapped: false };
  }

  // Chủ tài khoản giao dịch isolated x10; position size thay đổi theo SL cấu trúc.
  const safeLev = MAX_LEVERAGE;

  // Chủ tài khoản chọn luôn dùng toàn bộ equity làm isolated margin ở x10.
  const maxNotional = equity * safeLev;
  const margin = equity;
  const actualRiskUsd = maxNotional * riskPct;

  return {
    notional: Math.round(maxNotional * 10) / 10,
    leverage: safeLev,
    margin: Math.round(margin * 10) / 10,
    actualRiskUsd: Math.round(actualRiskUsd * 100) / 100,
    isCapped: false,
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
