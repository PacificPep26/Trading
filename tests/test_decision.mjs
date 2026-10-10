import assert from "node:assert/strict";
import { evaluateSetup } from "../lib/decision-engine.ts";

const now = Date.now();
const setup = { style: "bos", state: "triggered", side: 1, entry: 100, stop: 98, tp15: 103, tp2: 104, level: 99, distancePct: 0 };
const context = { coin: "SOL", timeframe: "4H", btcDaily: 1, ownDaily: 1, equity: 40, peakEquity: 40, lastBarTime: now - 4 * 60 * 60_000, now };

const accepted = evaluateSetup(setup, context);
assert.equal(accepted.code, "ACCEPTED");
assert.equal(accepted.plan.sizing.notional, 200);
assert.equal(accepted.plan.sizing.actualRiskUsd, 4);
assert.equal(accepted.plan.tp1, 102); // 1.0R = 100 + 2
assert.equal(accepted.plan.tp2, 104); // 2.0R = 100 + 4

// Runaway price check (drift > 0.25%)
assert.equal(evaluateSetup(setup, { ...context, livePrice: 100.5 }).code, "RUNAWAY_PRICE");

// Invalid stop: SL < 1.5% (entry 100, stop 99 -> 1.0% < 1.5%)
assert.equal(evaluateSetup({ ...setup, stop: 99 }, context).code, "INVALID_STOP");

// Invalid stop: SL > 6.0% (entry 100, stop 90 -> 10.0% > 6.0%)
assert.equal(evaluateSetup({ ...setup, stop: 90 }, context).code, "INVALID_STOP");

// Bot locked check (drawdown >= 20%)
assert.equal(evaluateSetup(setup, { ...context, equity: 31, peakEquity: 40 }).code, "BOT_LOCKED");

// Double top SHORT blocked when BTC Daily is Uptrend (btcDaily = 1)
assert.equal(evaluateSetup({ ...setup, style: "double_top_bottom", side: -1, stop: 102 }, context).code, "TREND_MISMATCH");

// Double top SHORT accepted when BTC Daily is Downtrend (btcDaily = -1)
assert.equal(evaluateSetup({ ...setup, style: "double_top_bottom", side: -1, stop: 102 }, { ...context, btcDaily: -1, ownDaily: -1 }).code, "ACCEPTED");

// 1H Pinbar SHORT accepted when BTC Daily is Downtrend (btcDaily = -1)
assert.equal(evaluateSetup({ ...setup, style: "pinbar_reversal", side: -1, stop: 102 }, { ...context, timeframe: "1H", btcDaily: -1, ownDaily: -1 }).code, "ACCEPTED");

console.log("All decision engine contract tests passed!");
