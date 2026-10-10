import assert from "node:assert/strict";
import {
  getContractSize,
  calculateContractVol,
  signMexcRequest,
  getMexcAccountAsset,
  getMexcOpenPositions,
  submitMexcOrder,
  submitMexcTpSl,
} from "../lib/mexc-client.ts";

const originalFetch = globalThis.fetch;
const originalEnv = {
  key: process.env.MEXC_API_KEY,
  secret: process.env.MEXC_SECRET_KEY,
  live: process.env.MEXC_LIVE_TRADING,
  dryRun: process.env.MEXC_DRY_RUN,
};
process.env.MEXC_LIVE_TRADING = "false";
process.env.MEXC_DRY_RUN = "true";
delete process.env.MEXC_API_KEY;
delete process.env.MEXC_SECRET_KEY;

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

// 7. Live mode must use the current endpoint and attach SL atomically.
process.env.MEXC_API_KEY = "test_key";
process.env.MEXC_SECRET_KEY = "test_secret";
process.env.MEXC_LIVE_TRADING = "true";
process.env.MEXC_DRY_RUN = "false";
let orderRequest;
globalThis.fetch = async (url, init) => {
  orderRequest = { url: String(url), init };
  return Response.json({ success: true, code: 0, data: { orderId: "live-order-1" } });
};
const liveOrder = await submitMexcOrder({
  symbol: "SOL_USDT",
  side: 1,
  notional: 125,
  price: 100,
  leverage: 10,
  stopLossPrice: 98,
});
assert.equal(liveOrder.success, true);
assert.ok(orderRequest.url.endsWith("/api/v1/private/order/create"));
assert.equal(JSON.parse(orderRequest.init.body).stopLossPrice, 98);

// 8. TP orders require a real position id and verify every API response.
const tpBodies = [];
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith("/position/open_positions")) {
    return Response.json({ success: true, code: 0, data: [{ positionId: "pos-1", symbol: "SOL_USDT", holdVol: 18, positionType: 1 }] });
  }
  if (String(url).endsWith("/stoporder/open_orders")) {
    return Response.json({ success: true, code: 0, data: [{ id: "sl-1", positionId: "pos-1", stopLossPrice: 98, isFinished: 0 }] });
  }
  tpBodies.push(JSON.parse(init.body));
  return Response.json({ success: true, code: 0, data: `tp-${tpBodies.length}` });
};
const liveProtection = await submitMexcTpSl({
  symbol: "SOL_USDT",
  side: 1,
  vol: 18,
  stopLossPrice: 98,
  takeProfit1Price: 102,
  takeProfit2Price: 104,
});
assert.equal(liveProtection.success, true);
assert.deepEqual(tpBodies.map((body) => body.vol), [9, 9]);
assert.deepEqual(tpBodies.map((body) => body.positionId), ["pos-1", "pos-1"]);

// 8b. 1D Donchian has no fixed TP (price 0): keep the SL, send no TP order.
tpBodies.length = 0;
const noTp = await submitMexcTpSl({
  symbol: "SOL_USDT",
  side: 1,
  vol: 18,
  stopLossPrice: 98,
  takeProfit1Price: 0,
  takeProfit2Price: 0,
});
assert.equal(noTp.success, true);
assert.equal(noTp.slConfirmed, true);
assert.equal(tpBodies.length, 0);

// 9. Position lookup fails closed; an API error must never look like an empty account.
globalThis.fetch = async () => Response.json({ success: false, code: 500, message: "temporary failure" }, { status: 503 });
await assert.rejects(() => getMexcOpenPositions(), /MEXC_POSITIONS_UNAVAILABLE/);

globalThis.fetch = originalFetch;
for (const [key, value] of Object.entries({
  MEXC_API_KEY: originalEnv.key,
  MEXC_SECRET_KEY: originalEnv.secret,
  MEXC_LIVE_TRADING: originalEnv.live,
  MEXC_DRY_RUN: originalEnv.dryRun,
})) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

console.log("All MEXC client & OpenAPI signature tests passed!");

