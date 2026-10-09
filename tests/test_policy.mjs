import assert from "node:assert/strict";
import {
  isAllowedSetup,
  isStarSetup,
  calculateSizing,
  calculatePartialPnL,
  isWatchSetup,
} from "../lib/trading-policy.ts";

// 1. Policy test
assert.equal(isAllowedSetup("bos", 1, "4H"), true, "4H BOS LONG allowed");
assert.equal(isAllowedSetup("bos", -1, "4H"), false, "4H BOS SHORT blocked");
assert.equal(isAllowedSetup("double_top_bottom", -1, "4H", -1, -1), true, "4H Double top SHORT allowed with both daily trends down");
assert.equal(isAllowedSetup("double_top_bottom", -1, "4H", 1, -1), false, "4H Double top blocked unless BTC and coin agree");
assert.equal(isAllowedSetup("double_top_bottom", 1, "4H", 1, 1), true, "4H Double bottom LONG allowed with both daily trends up");

assert.equal(isAllowedSetup("double_top_bottom", -1, "1H"), false, "1H is disabled: no statistically strong edge");
assert.equal(isAllowedSetup("double_top_bottom", 1, "1H"), false, "1H Double bottom LONG blocked");
assert.equal(isAllowedSetup("bos", 1, "1H"), false, "1H BOS LONG blocked");
assert.equal(isWatchSetup("double_top_bottom", -1, "1H"), true, "1H double top remains an early watch alert");
assert.equal(isWatchSetup("bos", 1, "1H"), false, "other 1H patterns are not watch alerts");

// 2. Star test
assert.equal(isStarSetup(1, 1, 1), true, "LONG star when BTC & coin up");
assert.equal(isStarSetup(1, -1, 1), false, "LONG not star when coin down");
assert.equal(isStarSetup(-1, -1, 1), true, "SHORT star when coin down");

// 3. Sizing test: Normal risk
const s1 = calculateSizing(40, 0.02);
assert.equal(s1.notional, 400);
assert.equal(s1.margin, 40);
assert.equal(s1.actualRiskUsd, 8);
assert.equal(s1.isCapped, false);

// 4. Sizing test: full $40 isolated margin x10; loss follows structural stop distance
const s2 = calculateSizing(40, 0.004);
assert.equal(s2.notional, 400, "Full $40 margin at x10 gives $400 maximum notional");
assert.equal(s2.actualRiskUsd, 1.6, "0.4% structural stop on $400 risks $1.60");
const s3 = calculateSizing(40, 0.08);
assert.equal(s3.actualRiskUsd, 32, "8% structural stop on $400 risks $32");

// 5. Partial PnL test (exact math check)
const pnl = calculatePartialPnL(5);
assert.equal(pnl.winTp1, 1.25, "50% at 0.5R is 0.25R = $1.25");
assert.equal(pnl.winTp2, 2.50, "50% at 1.0R is 0.50R = $2.50");
assert.equal(pnl.totalWin, 3.75, "Total partial win is 0.75R = $3.75");

console.log("All trading policy tests passed!");
