import assert from "node:assert/strict";
import {
  getContractSize,
  calculateContractVol,
  signMexcRequest,
  getMexcAccountAsset,
  submitMexcOrder,
  submitMexcTpSl,
} from "../lib/mexc-client.ts";

// 1. Kiểm tra Contract Size
const solSize = getContractSize("SOL_USDT");
assert.equal(solSize, 0.1, "SOL contract size must be 0.1 SOL");

const dogeSize = getContractSize("DOGE_USDT");
assert.equal(dogeSize, 100, "DOGE contract size must be 100 DOGE");

const adaSize = getContractSize("ADA_USDT");
assert.equal(adaSize, 1, "ADA contract size must be 1 ADA");

// 2. Kiểm tra tính Vol (số lượng hợp đồng)
// SOL: Giá $100, muốn vào vị thế 200$ -> 1 contract = 100 * 0.1 = $10 -> 20 contracts
const solVol = calculateContractVol("SOL_USDT", 200, 100);
assert.equal(solVol.vol, 20, "Must be 20 contracts of SOL");
assert.equal(solVol.actualNotional, 200, "Actual notional should be 200$");

// DOGE: Giá $0.08, muốn vào vị thế 200$ -> 1 contract = 0.08 * 100 = $8 -> 25 contracts
const dogeVol = calculateContractVol("DOGE_USDT", 200, 0.08);
assert.equal(dogeVol.vol, 25, "Must be 25 contracts of DOGE");
assert.equal(dogeVol.actualNotional, 200, "Actual notional should be 200$");

// 3. Kiểm tra Signature HMAC-SHA256
const testSig = signMexcRequest("my_secret", "my_key", "1600000000000", "");
assert.ok(typeof testSig === "string" && testSig.length === 64, "Signature must be 64-char hex");

// 4. Kiểm tra Dry-Run Asset
const asset = await getMexcAccountAsset(100);
assert.equal(asset.equity, 100, "Default equity should be 100$");
assert.equal(asset.currency, "USDT", "Currency should be USDT");
assert.equal(asset.isMock, true, "Should be mock in dry-run without credentials");

// 5. Kiểm tra Dry-Run Order
const orderRes = await submitMexcOrder({
  symbol: "SOL_USDT",
  side: 1,
  notional: 200,
  price: 110,
  leverage: 10,
});
assert.equal(orderRes.success, true, "Dry run order must succeed");
assert.equal(orderRes.isDryRun, true, "Must flag isDryRun");
assert.ok(orderRes.orderId?.startsWith("mock_mexc_"), "Must return mock order id");

// 6. Kiểm tra Dry-Run TP / SL
const tpslRes = await submitMexcTpSl({
  symbol: "SOL_USDT",
  side: 1,
  vol: 18,
  stopLossPrice: 107.5,
  takeProfit1Price: 112.5,
  takeProfit2Price: 115.0,
});
assert.equal(tpslRes.success, true, "Dry run TP/SL must succeed");
assert.equal(tpslRes.isDryRun, true, "Must flag isDryRun");

console.log("All MEXC client & OpenAPI signature tests passed!");
