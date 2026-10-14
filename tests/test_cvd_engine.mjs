import assert from "node:assert/strict";
const { evaluateCvdSignal } = await import("../lib/cvd-engine.ts");

// 1. Test cá voi gom ngầm (CVD tích lũy mạnh)
const accumCvd = {
  coin: "SUI",
  delta1h: 50000,
  delta4hTotal: 180000,
  isCvdAccumulating: true,
  isCvdDistributing: false,
  ratioBuySell4h: 1.25, // Taker Buy vượt 25%
};

const longSignal = evaluateCvdSignal(1, accumCvd);
assert.equal(longSignal.scoreBonus, 1, "Phải cộng điểm khi cá voi gom ngầm");
assert.ok(longSignal.reason?.includes("CVD gom ngầm"), "Phải có lý do gom ngầm");

// 2. Test kéo xả bẫy Bulltrap (Giá tăng nhưng Taker Sell áp đảo)
const distCvd = {
  coin: "SUI",
  delta1h: -40000,
  delta4hTotal: -120000,
  isCvdAccumulating: false,
  isCvdDistributing: true,
  ratioBuySell4h: 0.78, // Taker Sell áp đảo
};

const bulltrapSignal = evaluateCvdSignal(1, distCvd);
assert.equal(bulltrapSignal.scoreBonus, -1, "Phải trừ điểm khi bị xả ngầm");
assert.ok(bulltrapSignal.reason?.includes("CVD xả ngầm"), "Phải cảnh báo xả ngầm");

// 3. Test cho phe SHORT
const shortSignal = evaluateCvdSignal(-1, distCvd);
assert.equal(shortSignal.scoreBonus, 1, "CVD xả chủ động là lợi thế cho Short");

console.log("All CVD engine tests passed successfully!");
