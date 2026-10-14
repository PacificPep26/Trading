import assert from "node:assert/strict";
const { predictTradeExpectancy } = await import("../lib/ai-meta-scorer.ts");

// 1. Kèo hội tụ đầy đủ yếu tố vàng (5 lớp + CVD gom ngầm + Short squeeze + Tường mua đỡ)
const diamondFeatures = {
  baseScore: 5,
  rr: 2.2,
  hasSweep: true,
  isCvdAccumulating: true,
  isCvdDistributing: false,
  isOiSurging: false,
  isCrowdedTrap: false,
  isShortSqueezePotential: true,
  isBidWallGuarded: true,
  isAskWallBlocking: false,
  btcShockDrop: false,
};

const predDiamond = predictTradeExpectancy(diamondFeatures);
assert.equal(predDiamond.grade, "DIAMOND_ALL_IN");
assert.ok(predDiamond.confidenceScore >= 80, `Xác suất thắng phải cao: ${predDiamond.confidenceScore}%`);
assert.ok(predDiamond.explanation.some(e => e.includes("Cá voi gom ngầm")));

// 2. Kèo dính bẫy (CVD xả ngầm + Đám đông dồn toa + BTC shock đỏ)
const badFeatures = {
  baseScore: 3,
  rr: 1.5,
  hasSweep: false,
  isCvdAccumulating: false,
  isCvdDistributing: true,
  isOiSurging: true,
  isCrowdedTrap: true,
  isShortSqueezePotential: false,
  isBidWallGuarded: false,
  isAskWallBlocking: true,
  btcShockDrop: true,
};

const predBad = predictTradeExpectancy(badFeatures);
assert.equal(predBad.grade, "REJECT");
assert.ok(predBad.confidenceScore < 40, `Kèo xấu xác suất phải thấp: ${predBad.confidenceScore}%`);

console.log("All AI Meta-Scorer tests passed successfully!");

