import assert from "node:assert/strict";
import {
  getCapitalTier,
  checkTierChange,
  calculateTierSizing,
  CAPITAL_TIERS,
} from "../lib/capital-tier.ts";

// 1. Kiểm tra xác định tầng vốn theo số dư
const tier100 = getCapitalTier(100);
assert.equal(tier100.tier, 1, "Equity 100$ must be Tier 1");
assert.equal(tier100.riskPerTradeUsd, 4.0, "Tier 1 risk must be $4.0");

const tier120 = getCapitalTier(120.5);
assert.equal(tier120.tier, 2, "Equity 120.5$ must be Tier 2");
assert.equal(tier120.riskPerTradeUsd, 4.8, "Tier 2 risk must be $4.8");

const tier155 = getCapitalTier(155);
assert.equal(tier155.tier, 3, "Equity 155$ must be Tier 3");
assert.equal(tier155.riskPerTradeUsd, 6.0, "Tier 3 risk must be $6.0");

const tier220 = getCapitalTier(220);
assert.equal(tier220.tier, 4, "Equity 220$ must be Tier 4");
assert.equal(tier220.riskPerTradeUsd, 8.0, "Tier 4 risk must be $8.0");

// 2. Kiểm tra thăng hạng / tụt hạng
const stepUp = checkTierChange(105, 122);
assert.equal(stepUp.changed, true, "105$ -> 122$ should trigger tier change");
assert.equal(stepUp.direction, "up", "Direction should be up");
assert.equal(stepUp.newTier.tier, 2, "New tier should be Tier 2");

const stepDown = checkTierChange(125, 115);
assert.equal(stepDown.changed, true, "125$ -> 115$ should trigger tier change");
assert.equal(stepDown.direction, "down", "Direction should be down");
assert.equal(stepDown.newTier.tier, 1, "New tier should fall back to Tier 1");

const staySame = checkTierChange(100, 110);
assert.equal(staySame.changed, false, "100$ -> 110$ is same Tier 1");

// 3. Kiểm tra tính toán vị thế theo bậc thang (Margin & Notional)
// Ở Tier 1 ($100, risk $4.0):
const szTier1 = calculateTierSizing(100, 0.02); // SL 2.0%
assert.equal(szTier1.notional, 200, "Tier 1: 4$ / 2% = 200$ notional");
assert.equal(szTier1.margin, 20, "Tier 1: 200$ / 10 = 20$ margin");
assert.equal(szTier1.actualRiskUsd, 4, "Tier 1: Risk at SL must be 4$");

// Ở Tier 2 ($120, risk $4.8):
const szTier2 = calculateTierSizing(125, 0.02); // SL 2.0%
assert.equal(szTier2.notional, 240, "Tier 2: 4.8$ / 2% = 240$ notional");
assert.equal(szTier2.margin, 24, "Tier 2: 240$ / 10 = 24$ margin");
assert.equal(szTier2.actualRiskUsd, 4.8, "Tier 2: Risk at SL must be 4.8$");

// Ở Tier 3 ($150, risk $6.0):
const szTier3 = calculateTierSizing(160, 0.03); // SL 3.0%
assert.equal(szTier3.notional, 200, "Tier 3: 6$ / 3% = 200$ notional");
assert.equal(szTier3.margin, 20, "Tier 3: 200$ / 10 = 20$ margin");
assert.equal(szTier3.actualRiskUsd, 6, "Tier 3: Risk at SL must be 6$");

console.log("All capital tier & compounding ladder tests passed!");
