/**
 * Quản lý vốn theo Nấc thang (Compounding Step Ladder)
 * Chuẩn v2.1.0 cho bot Auto-Trade MEXC
 */

import { MAX_LEVERAGE, MIN_STOP_DISTANCE, MAX_STOP_DISTANCE } from "./trading-policy.ts";

export interface CapitalTier {
  tier: number;
  name: string;
  minEquity: number;
  maxEquity: number;
  baseCapital: number;
  riskPerTradeUsd: number; // Tiền rủi ro cố định cho 1R
  maxOpenTrades: number;   // Số lệnh tối đa được giữ đồng thời
  ratchetFloorUsd: number; // Mốc chặn dưới bảo vệ phần lời đã đạt
}

export const CAPITAL_TIERS: CapitalTier[] = [
  {
    tier: 1,
    name: "Tầng Khởi Động ($40 - $79)",
    minEquity: 30,
    maxEquity: 79.99,
    baseCapital: 50,
    riskPerTradeUsd: 2.5,
    maxOpenTrades: 2,
    ratchetFloorUsd: 30,
  },
  {
    tier: 2,
    name: "Tầng 1 (Tiêu chuẩn $100)",
    minEquity: 80,
    maxEquity: 119.99,
    baseCapital: 100,
    riskPerTradeUsd: 4.0,
    maxOpenTrades: 3,
    ratchetFloorUsd: 70,
  },
  {
    tier: 3,
    name: "Tầng 2 (Bứt phá $120)",
    minEquity: 120,
    maxEquity: 149.99,
    baseCapital: 120,
    riskPerTradeUsd: 4.8,
    maxOpenTrades: 3,
    ratchetFloorUsd: 110,
  },
  {
    tier: 4,
    name: "Tầng 3 (Tăng tốc $150)",
    minEquity: 150,
    maxEquity: 199.99,
    baseCapital: 150,
    riskPerTradeUsd: 6.0,
    maxOpenTrades: 4,
    ratchetFloorUsd: 135,
  },
  {
    tier: 5,
    name: "Tầng 4 (Vững vàng $200+)",
    minEquity: 200,
    maxEquity: Infinity,
    baseCapital: 200,
    riskPerTradeUsd: 8.0,
    maxOpenTrades: 4,
    ratchetFloorUsd: 180,
  },
];

/**
 * Xác định tầng vốn dựa trên số dư thực tế
 */
export function getCapitalTier(equity: number): CapitalTier {
  if (!Number.isFinite(equity) || equity <= 0) {
    return CAPITAL_TIERS[0];
  }
  for (const tier of CAPITAL_TIERS) {
    if (equity >= tier.minEquity && equity <= tier.maxEquity) {
      return tier;
    }
  }
  if (equity > CAPITAL_TIERS[CAPITAL_TIERS.length - 1].maxEquity) {
    return CAPITAL_TIERS[CAPITAL_TIERS.length - 1];
  }
  return CAPITAL_TIERS[0];
}

/**
 * Kiểm tra xem tài khoản có thăng hạng hoặc tụt hạng vốn không
 */
export function checkTierChange(prevEquity: number, currentEquity: number): {
  changed: boolean;
  oldTier: CapitalTier;
  newTier: CapitalTier;
  direction: "up" | "down" | "same";
} {
  const oldTier = getCapitalTier(prevEquity);
  const newTier = getCapitalTier(currentEquity);

  if (oldTier.tier === newTier.tier) {
    return { changed: false, oldTier, newTier, direction: "same" };
  }

  return {
    changed: true,
    oldTier,
    newTier,
    direction: newTier.tier > oldTier.tier ? "up" : "down",
  };
}

export interface TierSizing {
  tier: CapitalTier;
  notional: number;
  margin: number;
  leverage: number;
  actualRiskUsd: number;
  isCapped: boolean;
}

/**
 * Tính toán số tiền ký quỹ (Margin) và vị thế theo nấc thang vốn
 */
export function calculateTierSizing(equity: number, stopDistancePct: number): TierSizing {
  const tier = getCapitalTier(equity);
  const riskBudget = tier.riskPerTradeUsd;
  const maxNotional = equity * MAX_LEVERAGE;

  if (!Number.isFinite(stopDistancePct) || stopDistancePct <= 0) {
    return { tier, notional: 0, margin: 0, leverage: MAX_LEVERAGE, actualRiskUsd: 0, isCapped: false };
  }

  const riskSizedNotional = riskBudget / stopDistancePct;
  const notional = Math.min(maxNotional, riskSizedNotional);
  const margin = notional / MAX_LEVERAGE;
  const actualRiskUsd = notional * stopDistancePct;

  return {
    tier,
    notional: Math.round(notional * 10) / 10,
    margin: Math.round(margin * 10) / 10,
    leverage: MAX_LEVERAGE,
    actualRiskUsd: Math.round(actualRiskUsd * 100) / 100,
    isCapped: riskSizedNotional > maxNotional,
  };
}
