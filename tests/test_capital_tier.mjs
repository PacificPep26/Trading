import assert from "node:assert/strict";
import {
  getCapitalTier,
  checkTierChange,
  calculateTierSizing,
} from "../lib/capital-tier.ts";

// 1. Kiểm tra xác định tầng vốn theo số dư
const tier52 = getCapitalTier(52.13);
assert.equal(tier52.tier, 1, "Equity 52.13$ must be Tier 1 Starter");
assert.equal(tier52.riskPerTradeUsd, 2.5, "Tier 1 risk must be $2.5");

const tier100 = getCapitalTier(100);
assert.equal(tier100.tier, 2, "Equity 100$ must be Tier 2");
assert.equal(tier100.riskPerTradeUsd, 4.0, "Tier 2 risk must be $4.0");

const tier120 = getCapitalTier(120.5);
assert.equal(tier120.tier, 3, "Equity 120.5$ must be Tier 3");
assert.equal(tier120.riskPerTradeUsd, 4.8, "Tier 3 risk must be $4.8");

const tier155 = getCapitalTier(155);
assert.equal(tier155.tier, 4, "Equity 155$ must be Tier 4");
assert.equal(tier155.riskPerTradeUsd, 6.0, "Tier 4 risk must be $6.0");

const tier220 = getCapitalTier(220);
assert.equal(tier220.tier, 5, "Equity 220$ must be Tier 5");
assert.equal(tier220.riskPerTradeUsd, 8.0, "Tier 5 risk must be $8.0");

// 2. Kiểm tra thăng hạng / tụt hạng
const stepUp = checkTierChange(52, 85);
assert.equal(stepUp.changed, true, "52$ -> 85$ should trigger tier change");
assert.equal(stepUp.direction, "up", "Direction should be up");
assert.equal(stepUp.newTier.tier, 2, "New tier should be Tier 2");

const stepDown = checkTierChange(85, 65);
assert.equal(stepDown.changed, true, "85$ -> 65$ should trigger tier change");
assert.equal(stepDown.direction, "down", "Direction should be down");
assert.equal(stepDown.newTier.tier, 1, "New tier should fall back to Tier 1");

const staySame = checkTierChange(50, 60);
assert.equal(staySame.changed, false, "50$ -> 60$ is same Tier 1");

// 3. Kiểm tra tính toán vị thế theo bậc thang (Margin & Notional)
// Ở Tier 1 ($52, risk $2.5):
const szTier1 = calculateTierSizing(52, 0.02); // SL 2.0%
assert.equal(szTier1.notional, 125, "Tier 1: 2.5$ / 2% = 125$ notional");
assert.equal(szTier1.margin, 12.5, "Tier 1: 125$ / 10 = 12.5$ margin");
assert.equal(szTier1.actualRiskUsd, 2.5, "Tier 1: Risk at SL must be 2.5$");

// Ở Tier 2 ($100, risk $4.0):
const szTier2 = calculateTierSizing(100, 0.02); // SL 2.0%
assert.equal(szTier2.notional, 200, "Tier 2: 4.0$ / 2% = 200$ notional");
assert.equal(szTier2.margin, 20, "Tier 2: 200$ / 10 = 20$ margin");
assert.equal(szTier2.actualRiskUsd, 4.0, "Tier 2: Risk at SL must be 4.0$");

// Ở Tier 3 ($125, risk $4.8):
const szTier3 = calculateTierSizing(125, 0.02); // SL 2.0%
assert.equal(szTier3.notional, 240, "Tier 3: 4.8$ / 2% = 240$ notional");
assert.equal(szTier3.margin, 24, "Tier 3: 240$ / 10 = 24$ margin");
assert.equal(szTier3.actualRiskUsd, 4.8, "Tier 3: Risk at SL must be 4.8$");

console.log("All capital tier & compounding ladder tests passed!");

