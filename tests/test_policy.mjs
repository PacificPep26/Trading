import assert from "node:assert/strict";
import {
  isAllowedSetup,
  isStarSetup,
  calculateSizing,
  calculatePartialPnL,
  isWatchSetup,
  isAutoTradeTimeWindow,
  isLiveEligible,
} from "../lib/trading-policy.ts";

// 1. Policy test v2.3.1
assert.equal(isAllowedSetup("bos", 1, "4H", 1, 1), true, "4H BOS LONG allowed");
assert.equal(isAllowedSetup("bos", -1, "4H", -1, -1), true, "4H BOS SHORT allowed with downtrend");
assert.equal(isAllowedSetup("bos", -1, "4H", 1, 1), false, "4H BOS SHORT blocked when strong uptrend");
assert.equal(isAllowedSetup("double_top_bottom", -1, "4H"), true, "4H Double top SHORT allowed with neutral btc");
assert.equal(isAllowedSetup("pinbar_reversal", -1, "4H"), true, "4H Pinbar SHORT allowed with neutral btc");

// Macro BTC filter: Tuyệt đối cấm SHORT khi BTC Ngày Uptrend
assert.equal(isAllowedSetup("pinbar_reversal", -1, "4H", 1, 1), false, "4H Pinbar SHORT MUST be blocked when BTC Daily is Uptrend");
assert.equal(isAllowedSetup("double_top_bottom", -1, "4H", 1, 1), false, "4H Double top SHORT MUST be blocked when BTC Daily is Uptrend");
assert.equal(isAllowedSetup("pinbar_reversal", 1, "4H", -1, -1), false, "4H Pinbar LONG MUST be blocked when BTC Daily is Downtrend");

// 1H tests
assert.equal(isAllowedSetup("double_top_bottom", -1, "1H"), true, "1H Double top allowed");
assert.equal(isAllowedSetup("pinbar_reversal", -1, "1H"), true, "1H Pinbar allowed");
assert.equal(isAllowedSetup("bos", 1, "1H"), true, "1H BOS allowed");
assert.equal(isAllowedSetup("bos", -1, "1H", 1, 1), false, "1H BOS SHORT blocked when BTC Daily is Uptrend");
assert.equal(isWatchSetup("double_top_bottom", -1, "1H"), true, "1H is watch and scalping alert");

// 2. Star test
assert.equal(isStarSetup(1, 1, 1), true, "LONG star when BTC & coin up");
assert.equal(isStarSetup(1, -1, 1), false, "LONG not star when coin down");
assert.equal(isStarSetup(-1, -1, 1), false, "SHORT not star when BTC is up");
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

// 5. Partial PnL test with Front-Running Buffer (TP1 0.90R = 50%, TP2 1.85R = 50%, Total = 1.375R)
const pnl = calculatePartialPnL(4);
assert.equal(pnl.winTp1, 1.80, "50% at 0.90R is 0.45R = $1.80");
assert.equal(pnl.winTp2, 3.70, "50% at 1.85R is 0.925R = $3.70");
assert.equal(pnl.totalWin, 5.50, "Total partial win with front-run buffer is $5.50");

// 6. Time Window (16:00 - 08:00 VN Time = UTC 09:00 - 01:00)
// 17:00 VN = 10:00 UTC
const eveningTime = new Date("2026-10-10T10:00:00Z");
assert.equal(isAutoTradeTimeWindow(eveningTime), true, "17:00 VN is in auto-trade window");
// 23:00 VN = 16:00 UTC
const nightTime = new Date("2026-10-10T16:00:00Z");
assert.equal(isAutoTradeTimeWindow(nightTime), true, "23:00 VN is in auto-trade window");
// 02:00 VN = 19:00 UTC previous day
const midnightTime = new Date("2026-10-10T19:00:00Z");
assert.equal(isAutoTradeTimeWindow(midnightTime), true, "02:00 VN is in auto-trade window");
// 07:30 VN = 00:30 UTC
const morningTime = new Date("2026-10-10T00:30:00Z");
assert.equal(isAutoTradeTimeWindow(morningTime), true, "07:30 VN is in auto-trade window");
// 10:00 VN = 03:00 UTC
const daytime = new Date("2026-10-10T03:00:00Z");
assert.equal(isAutoTradeTimeWindow(daytime), false, "10:00 VN is outside auto-trade window (paper/alert mode)");
// 15:00 VN = 08:00 UTC
const lateAfternoon = new Date("2026-10-10T08:00:00Z");
assert.equal(isAutoTradeTimeWindow(lateAfternoon), false, "15:00 VN is outside auto-trade window");

// 7. Live Eligibility (Chuẩn Kim Cương: Volume >= 2.0x, Long bật nền & Short rớt nền)
// Long BOS with vol 2.5x during evening -> ELIGIBLE
assert.equal(isLiveEligible("bos", 1, "4H", 1, 1, 2.5, eveningTime), true, "4H BOS Long with vol 2.5x in window is eligible");
// Short BOS with vol 2.5x during evening -> ELIGIBLE
assert.equal(isLiveEligible("bos", -1, "4H", -1, -1, 2.5, eveningTime), true, "4H BOS Short with vol 2.5x in window is eligible");
// Double Top Short with vol 2.0x during night -> ELIGIBLE
assert.equal(isLiveEligible("double_top_bottom", -1, "4H", -1, -1, 2.0, nightTime), true, "4H Double Top Short with vol 2.0x in window is eligible");
// Low volume (1.5x) during evening -> BLOCKED (rejected from live, keeps paper/alert)
assert.equal(isLiveEligible("bos", 1, "4H", 1, 1, 1.5, eveningTime), false, "4H BOS Long with vol 1.5x blocked from live");
// Daytime (10:00 VN) even with vol 3.0x -> BLOCKED from auto-trade
assert.equal(isLiveEligible("bos", 1, "4H", 1, 1, 3.0, daytime), false, "4H BOS Long during daytime blocked from live auto-trade");

console.log("All trading policy v2.3.1 tests passed!");
