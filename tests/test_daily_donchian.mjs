import assert from "node:assert/strict";
import { analyseDaily } from "../lib/patterns.ts";
import { evaluateSetup } from "../lib/decision-engine.ts";
import { isAllowedSetup, isLiveEligible } from "../lib/trading-policy.ts";

// 1. Kiểm tra chính sách hợp lệ
assert.equal(isAllowedSetup("daily_trend_donchian", 1, "1D", 1, 1), true, "1D Donchian Long allowed when BTC is Uptrend");
assert.equal(isAllowedSetup("daily_trend_donchian", 1, "1D", -1, 1), false, "1D Donchian Long BLOCKED when BTC is Downtrend");
assert.equal(isLiveEligible("daily_trend_donchian", 1, "1D", 1, 1), true, "1D Donchian is Live eligible");

// 2. Mock 30 nến ngày
const mockDailyBars = [];
const basePrice = 100;
const now = Date.now();

for (let i = 0; i < 30; i++) {
  const t = now - (30 - i) * 86_400_000;
  // Giá dao động từ 90 đến 110 trong 28 ngày đầu
  const o = 100 + (i % 5) - 2;
  const h = o + 3;
  const l = o - 3;
  const c = o + 1;
  mockDailyBars.push({ t, o, h, l, c, v: 1000, closed: true });
}

// Cây nến cuối cùng bứt phá mạnh qua đỉnh 20 ngày
const highest20 = Math.max(...mockDailyBars.slice(9, 29).map(x => x.h));
const lastBar = mockDailyBars[29];
lastBar.o = highest20;
lastBar.c = highest20 + 5; // Close vượt đỉnh 20 ngày
lastBar.h = highest20 + 6;
lastBar.l = highest20 - 1;

const res = analyseDaily(mockDailyBars);
assert.equal(res.setups.length, 1, "Must find 1 breakout setup");
const s = res.setups[0];
assert.equal(s.style, "daily_trend_donchian");
assert.equal(s.side, 1);
assert.equal(s.state, "triggered");
assert.ok(s.stop < s.entry, "Stop loss must be below entry");

// 3. Đưa qua Decision Engine
const decision = evaluateSetup(s, {
  coin: "BTC",
  timeframe: "1D",
  btcDaily: 1,
  ownDaily: 1,
  equity: 50.57,
  peakEquity: 50.57,
  lastBarTime: lastBar.t,
  livePrice: s.entry,
});

assert.equal(decision.accepted, true, "Decision engine must accept 1D Donchian Breakout");
assert.equal(decision.plan?.sizing.actualRiskUsd, 4.0, "Risk must be exactly $4.0 for Tier 1 Starter");
assert.equal(decision.plan?.sizing.leverage, 10, "Leverage must be x10 Isolated");

console.log("All Daily Donchian Trend Following tests passed successfully!");

