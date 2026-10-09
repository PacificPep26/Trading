import assert from "node:assert/strict";
import {
  isAllowedSetup,
  isStarSetup,
  calculateSizing,
  calculatePartialPnL,
} from "../lib/trading-policy.js";

// 1. Policy test
assert.equal(isAllowedSetup("bos", 1, "4H"), true, "4H BOS LONG allowed");
assert.equal(isAllowedSetup("bos", -1, "4H"), false, "4H BOS SHORT blocked");
assert.equal(isAllowedSetup("double_top_bottom", -1, "4H"), true, "4H Double top SHORT allowed");
assert.equal(isAllowedSetup("double_top_bottom", 1, "4H"), false, "4H Double bottom LONG blocked");

assert.equal(isAllowedSetup("double_top_bottom", -1, "1H"), true, "1H Double top SHORT allowed");
assert.equal(isAllowedSetup("double_top_bottom", 1, "1H"), false, "1H Double bottom LONG blocked");
assert.equal(isAllowedSetup("bos", 1, "1H"), false, "1H BOS LONG blocked");

// 2. Star test
assert.equal(isStarSetup(1, 1, 1), true, "LONG star when BTC & coin up");
assert.equal(isStarSetup(1, -1, 1), false, "LONG not star when coin down");
assert.equal(isStarSetup(-1, -1, 1), true, "SHORT star when coin down");

// 3. Sizing test: Normal risk
const s1 = calculateSizing(40, 5, 0.02);
assert.equal(s1.notional, 250);
assert.equal(s1.actualRiskUsd, 5);
assert.equal(s1.isCapped, false);

// 4. Sizing test: Tight stop (must be capped by equity to avoid insufficient margin)
const s2 = calculateSizing(40, 5, 0.004);
assert.ok(s2.isCapped, "Must cap when notional exceeds account purchasing power");
assert.ok(s2.notional <= 40 * 0.9 * 20, "Notional within account equity purchasing power");
assert.ok(s2.actualRiskUsd < 5, "Actual risk reduced when capped");

// 5. Partial PnL test (exact math check)
const pnl = calculatePartialPnL(5);
assert.equal(pnl.winTp1, 1.25, "50% at 0.5R is 0.25R = $1.25");
assert.equal(pnl.winTp2, 2.50, "50% at 1.0R is 0.50R = $2.50");
assert.equal(pnl.totalWin, 3.75, "Total partial win is 0.75R = $3.75");

console.log("All trading policy tests passed!");
