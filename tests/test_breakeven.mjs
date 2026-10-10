import assert from "node:assert/strict";
process.env.MEXC_API_KEY = "k"; process.env.MEXC_SECRET_KEY = "s";
process.env.MEXC_LIVE_TRADING = "true"; process.env.MEXC_DRY_RUN = "false";
const { moveStopsToBreakeven } = await import("../lib/mexc-client.ts");

const calls = [];
const reply = (data) => ({ ok: true, json: async () => ({ success: true, data }) });
const run = async (holdVol, tpOrders) => {
  calls.length = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: init?.body });
    if (url.includes("open_positions")) return reply([{ positionId: 9, symbol: "LINK_USDT", holdVol, positionType: 1, openAvgPrice: 12.9 }]);
    if (url.includes("open_orders")) return reply([{ id: 1, positionId: 9, stopLossPrice: 12.67, isFinished: 0 }, ...tpOrders]);
    return reply(true);
  };
  return moveStopsToBreakeven();
};

// TP1 + TP2 vẫn còn → chưa dời
assert.deepEqual(await run(10, [{ id: 2, positionId: 9, takeProfitPrice: 13.1, vol: 5, isFinished: 0 }, { id: 3, positionId: 9, takeProfitPrice: 13.4, vol: 5, isFinished: 0 }]), []);
// TP1 đã khớp: còn 5 HĐ, chỉ còn TP2 → dời SL về 12.9
assert.deepEqual(await run(5, [{ id: 3, positionId: 9, takeProfitPrice: 13.4, vol: 5, isFinished: 0 }]), ["LINK_USDT"]);
assert.equal(JSON.parse(calls.at(-1).body).stopLossPrice, 12.9);
// TP1 đặt lỗi (chỉ có TP2) nhưng vẫn giữ đủ 10 HĐ → không dời
assert.deepEqual(await run(10, [{ id: 3, positionId: 9, takeProfitPrice: 13.4, vol: 5, isFinished: 0 }]), []);
console.log("All breakeven tests passed!");
