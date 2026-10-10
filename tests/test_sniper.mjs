import assert from "node:assert/strict";
import { sniperRadar, evaluate15mSniper, getTradingSessionInfo } from "../lib/sniper-engine.ts";

// Giờ phiên tự theo giờ mùa hè/đông của London & New York
assert.equal(getTradingSessionInfo(new Date("2026-07-15T07:30:00Z")).session, "London");
assert.equal(getTradingSessionInfo(new Date("2026-12-15T07:30:00Z")).session, "Off-hours");
assert.equal(getTradingSessionInfo(new Date("2026-12-15T14:45:00Z")).session, "New York");

// Nến 15m nằm BÊN TRONG nến 1H phá vỡ không được tính là nhịp hồi
const breakoutClose = 1_800_000_000_000;
const bar = (t, o, h, l, c) => ({ t, o, h, l, c, v: 1, closed: true });
const pinbar = (t) => bar(t, 100.5, 100.8, 99.5, 100.6); // râu dưới dài, chạm cản 100
const target = { coin: "X", side: 1, breakoutTime: breakoutClose, breakoutPrice: 100.6, brokenLevel: 100, waveHigh: 102, waveLow: 97, atr1h: 0, expiresAt: breakoutClose + 90 * 60_000 };
const before = [0, 1, 2, 3, 4].map((k) => pinbar(breakoutClose - (5 - k) * 900_000));

sniperRadar.set("X", { ...target });
assert.equal(evaluate15mSniper("X", before, breakoutClose), null, "pinbar trước khi nến 1H đóng không được kích hoạt");

sniperRadar.set("X", { ...target });
const sig = evaluate15mSniper("X", [...before, pinbar(breakoutClose)], breakoutClose + 900_000);
assert.ok(sig?.triggered, "pinbar 15m sau khi nến 1H đóng phải kích hoạt");
assert.ok(sig.riskPct >= 0.004 && sig.riskPct <= 0.025);
sniperRadar.clear();

console.log("All sniper tests passed!");
