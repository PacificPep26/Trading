import assert from "node:assert/strict";
const { evaluateOrderbookSignal } = await import("../lib/orderbook-depth.ts");

// 1. Test trường hợp có tường mua lớn bảo vệ bên dưới (Bid Wall Guarded)
const guardedBook = {
  coin: "BTC",
  bidAskRatio: 1.85, // Bids áp đảo
  strongestBidWallPrice: 83000,
  strongestBidWallVol: 850,
  isBidWallGuarded: true,
  isAskWallBlocking: false,
};

const longGuard = evaluateOrderbookSignal(1, guardedBook);
assert.equal(longGuard.scoreBonus, 1, "Phải cộng điểm khi có tường mua lớn đỡ");
assert.ok(longGuard.reason?.includes("Tường mua đỡ"), "Phải có lý do tường mua đỡ");
assert.ok(longGuard.suggestedStop && longGuard.suggestedStop < 83000, "SL phải nằm sau lưng tường mua");

// 2. Test trường hợp có tường bán khổng lồ cản ngay trên đầu (Ask Wall Blocking)
const blockedBook = {
  coin: "BTC",
  bidAskRatio: 0.65,
  strongestAskWallPrice: 83800,
  strongestAskWallVol: 920,
  isBidWallGuarded: false,
  isAskWallBlocking: true,
};

const longBlocked = evaluateOrderbookSignal(1, blockedBook);
assert.equal(longBlocked.scoreBonus, -1, "Phải trừ điểm khi bị tường bán chặn đường");
assert.ok(longBlocked.reason?.includes("Tường bán cản"), "Phải cảnh báo tường cản");

// 3. Test cho phe Short
const shortAdvantage = evaluateOrderbookSignal(-1, blockedBook);
assert.equal(shortAdvantage.scoreBonus, 1, "Tường bán ép giá là lợi thế cho Short");

console.log("All orderbook depth tests passed successfully!");

