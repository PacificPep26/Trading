/**
 * SIZING.JS - tách riêng khỏi engine.js để các chiến lược không import ngược engine (vòng import).
 */

/**
 * Tính toán Position Sizing chuẩn 1R kèm Cổng Bảo Vệ Thanh Lý (Liquidation Guard)
 */
export function calculatePositionSize(entry, stopLoss, riskUsd = 10, leverage = 10) {
  const riskPerUnit = Math.abs(entry - stopLoss);
  if (riskPerUnit <= 0) {
    return { size: 0, notional: 0, margin: 0, riskPerUnit: 0, isBlocked: true, blockReason: 'INVALID_RISK_PER_UNIT' };
  }

  const slDistanceRate = riskPerUnit / entry;
  const maxSafeSlRate = (1 / leverage) * 0.70;
  if (slDistanceRate >= maxSafeSlRate) {
    return {
      size: 0,
      notional: 0,
      margin: 0,
      riskPerUnit,
      slDistanceRate,
      isBlocked: true,
      blockReason: `LIQUIDATION_RISK: Khoảng cách SL (${(slDistanceRate * 100).toFixed(2)}%) quá gần mức thanh lý ${(100 / leverage).toFixed(1)}% (ngưỡng an toàn tối đa: ${(maxSafeSlRate * 100).toFixed(1)}%)`
    };
  }

  const size = riskUsd / riskPerUnit;
  const notional = size * entry;
  const margin = notional / leverage;

  return {
    size,
    notional,
    margin,
    riskPerUnit,
    slDistanceRate,
    isBlocked: false,
    blockReason: null
  };
}
