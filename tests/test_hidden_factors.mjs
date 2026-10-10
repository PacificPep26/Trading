import assert from "node:assert/strict";
import { evaluateSetup } from "../lib/decision-engine.ts";

const now = Date.now();
const baseSetup = {
  style: "bos",
  state: "triggered",
  side: 1,
  entry: 100,
  stop: 98,
  tp15: 103,
  tp2: 104,
  level: 99,
  distancePct: 0,
  volumeRatio: 1.2,
  isCleanBody: true,
};

const baseContext = {
  coin: "SOL",
  timeframe: "4H",
  btcDaily: 1,
  ownDaily: 1,
  equity: 100,
  peakEquity: 100,
  lastBarTime: now - 4 * 60 * 60_000,
  now,
  livePrice: 100,
};

// 1. Kiểm tra nến kiệt Volume (< 0.75x SMA20) -> Bị từ chối LOW_VOLUME
const lowVolRes = evaluateSetup({ ...baseSetup, volumeRatio: 0.5 }, baseContext);
assert.equal(lowVolRes.code, "LOW_VOLUME", "Low volume setup must be rejected with LOW_VOLUME");

// 2. Kiểm tra nến Volume đạt chuẩn (>= 0.75x SMA20) -> Được chấp nhận
const normalVolRes = evaluateSetup({ ...baseSetup, volumeRatio: 1.1 }, baseContext);
assert.equal(normalVolRes.code, "ACCEPTED", "Normal volume setup must be accepted");

// 3. Kiểm tra BTC Intraday Momentum: BTC đang có nến 1H tăng dựng đứng (+1.0%) -> CẤM SHORT
const btcPumpingBars = [
  { o: 80000, h: 81000, l: 79900, c: 80800 }, // +1.0% pump
];
const shortDuringPump = evaluateSetup(
  { ...baseSetup, side: -1, stop: 102 },
  { ...baseContext, btcDaily: -1, ownDaily: -1, btc1hBars: btcPumpingBars }
);
assert.equal(shortDuringPump.code, "BTC_MOMENTUM_BLOCKED", "Shorting during strong BTC 1H pump must be blocked");

// 4. Kiểm tra BTC Intraday Momentum: BTC đang có nến 1H sập mạnh (-1.0%) -> CẤM LONG
const btcDumpingBars = [
  { o: 80000, h: 80100, l: 79000, c: 79200 }, // -1.0% dump
];
const longDuringDump = evaluateSetup(
  baseSetup,
  { ...baseContext, btc1hBars: btcDumpingBars }
);
assert.equal(longDuringDump.code, "BTC_MOMENTUM_BLOCKED", "Longing during strong BTC 1H dump must be blocked");

// 5. Kiểm tra Lệ phí Funding Rate bất thường (> 0.03%) -> Bị từ chối EXTREME_FUNDING
const extremeFundingRes = evaluateSetup(baseSetup, { ...baseContext, fundingRate: 0.0005 }); // 0.05%
assert.equal(extremeFundingRes.code, "EXTREME_FUNDING", "Extreme funding rate must be rejected");

const safeFundingRes = evaluateSetup(baseSetup, { ...baseContext, fundingRate: 0.0001 }); // 0.01%
assert.equal(safeFundingRes.code, "ACCEPTED", "Safe funding rate must be accepted");

// 6. Kiểm tra Bẫy phá vỡ giả (Fakeout Wick Trap: thân nến không dứt khoát)
const fakeoutWickRes = evaluateSetup({ ...baseSetup, isCleanBody: false }, baseContext);
assert.equal(fakeoutWickRes.code, "FAKEOUT_WICK_TRAP", "BOS with fakeout wick must be rejected");

console.log("All 6 hidden factor & trap filter tests passed successfully!");

