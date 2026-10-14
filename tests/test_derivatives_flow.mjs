import assert from "node:assert/strict";
const { evaluateLiquidationRisk } = await import("../lib/derivatives-flow.ts");

// 1. Test trường hợp đám đông FOMO Long quá mức + OI tăng vọt -> BẪY THANH LÝ LONG
const crowdLongFlow = {
  coin: "BTC",
  oiChange4hPct: 0.08,    // OI tăng +8%
  oiChange1hPct: 0.04,
  lsrCurrent: 1.55,       // LSR 1.55 (quá nhiều tài khoản Long)
  lsrAvg4h: 1.45,
  fundingRate: 0.0002,    // Funding dương cao
  isCrowdedLong: true,
  isCrowdedShort: false,
  isOiSurging: true,
};

const trapResult = evaluateLiquidationRisk(1, crowdLongFlow);
assert.equal(trapResult.isTrap, true, "Phải nhận diện Bẫy Long");
assert.equal(trapResult.scoreBonus, -1, "Phải trừ điểm để chặn bắt đáy");
assert.ok(trapResult.warningReason?.includes("Bẫy Long"), "Phải có lý do cảnh báo bẫy");

// 2. Test trường hợp Short bị dồn toa (Short kẹt) -> Tiềm năng SHORT SQUEEZE kích nổ tăng mạnh
const shortSqueezeFlow = {
  coin: "BTC",
  oiChange4hPct: 0.02,
  oiChange1hPct: 0.01,
  lsrCurrent: 0.68,       // Short chiếm áp đảo
  lsrAvg4h: 0.72,
  fundingRate: -0.0001,
  isCrowdedLong: false,
  isCrowdedShort: true,
  isOiSurging: false,
};

const squeezeResult = evaluateLiquidationRisk(1, shortSqueezeFlow);
assert.equal(squeezeResult.isTrap, false);
assert.equal(squeezeResult.scoreBonus, 1, "Phải cộng điểm Short Squeeze");
assert.ok(squeezeResult.warningReason?.includes("Short Squeeze"));

// 3. Test trường hợp bình thường
const normalFlow = {
  coin: "BTC",
  oiChange4hPct: 0.01,
  oiChange1hPct: 0.005,
  lsrCurrent: 1.05,
  lsrAvg4h: 1.02,
  fundingRate: 0.00005,
  isCrowdedLong: false,
  isCrowdedShort: false,
  isOiSurging: false,
};

const normalResult = evaluateLiquidationRisk(1, normalFlow);
assert.equal(normalResult.isTrap, false);
assert.equal(normalResult.scoreBonus, 0);

console.log("All derivatives flow tests passed successfully!");
