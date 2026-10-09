import assert from "node:assert/strict";
import {
  isAllowedSetup,
  isStarSetup,
  calculateSizing,
  calculatePartialPnL,
  isWatchSetup,
} from "../lib/trading-policy.ts";

// 1. Policy test v2.0.0
assert.equal(isAllowedSetup("bos", 1, "4H", 1, 1), true, "4H BOS LONG allowed");
assert.equal(isAllowedSetup("bos", -1, "4H", -1, -1), true, "4H BOS SHORT allowed with downtrend");
assert.equal(isAllowedSetup("bos", -1, "4H", 1, 1), false, "4H BOS SHORT blocked when strong uptrend");
assert.equal(isAllowedSetup("double_top_bottom", -1, "4H"), true, "4H Double top SHORT allowed");
assert.equal(isAllowedSetup("pinbar_reversal", -1, "4H"), true, "4H Pinbar SHORT allowed");

// 1H tests
assert.equal(isAllowedSetup("double_top_bottom", -1, "1H"), true, "1H Double top allowed");
assert.equal(isAllowedSetup("pinbar_reversal", -1, "1H"), true, "1H Pinbar allowed");
assert.equal(isAllowedSetup("bos", 1, "1H"), true, "1H BOS allowed");
assert.equal(isWatchSetup("double_top_bottom", -1, "1H"), true, "1H is watch and scalping alert");

// 2. Star test
assert.equal(isStarSetup(1, 1, 1), true, "LONG star when BTC & coin up");
assert.equal(isStarSetup(1, -1, 1), false, "LONG not star when coin down");
assert.equal(isStarSetup(-1, -1, 1), true, "SHORT star when coin is down");
assert.equal(isStarSetup(-1, -1, -1), true, "SHORT star when BTC and coin are both down");

// 3. Sizing test: Normal risk (SL 2%)
const s1 = calculateSizing(40, 0.02);
assert.equal(s1.notional, 200);
assert.equal(s1.margin, 20);
assert.equal(s1.actualRiskUsd, 4);
assert.equal(s1.isCapped, false);

// 4. Sizing test: SL 5%
const s2 = calculateSizing(40, 0.05);
assert.equal(s2.notional, 80);
assert.equal(s2.margin, 8);
assert.equal(s2.actualRiskUsd, 4);

// 5. Partial PnL test v2.0.0 (TP1 1.0R = 50%, TP2 2.0R = 50%, Total = 1.5R)
const pnl = calculatePartialPnL(4);
assert.equal(pnl.winTp1, 2.00, "50% at 1.0R is 0.50R = $2.00");
assert.equal(pnl.winTp2, 4.00, "50% at 2.0R is 1.00R = $4.00");
assert.equal(pnl.totalWin, 6.00, "Total partial win is 1.50R = $6.00");

console.log("All trading policy v2.0.0 tests passed!");
