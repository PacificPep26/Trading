import assert from "node:assert/strict";
process.env.MEXC_API_KEY = "k"; process.env.MEXC_SECRET_KEY = "s";
process.env.MEXC_LIVE_TRADING = "true"; process.env.MEXC_DRY_RUN = "false";
const { trailingStop } = await import("../lib/trading-policy.ts");
const { tightenStop } = await import("../lib/mexc-client.ts");

const H4 = 4 * 3_600_000;
// 20 nến phẳng (range 2 → ATR 2), rồi giá chạy lên 120
const bars = Array.from({ length: 20 }, (_, i) => ({ t: i * H4, h: 101, l: 99, c: 100, closed: true }));
bars.push({ t: 20 * H4, h: 121, l: 119, c: 120, closed: true });
const atr = (2 * 13 + 21) / 14; // nến cuối: TR = 121 - 100
// LONG vào ở nến 19: SL = 120 - 3*ATR
assert.ok(Math.abs(trailingStop(bars, 1, 19 * H4, 95) - (120 - 3 * atr)) < 1e-9);
// không bao giờ nới SL
assert.equal(trailingStop(bars, 1, 19 * H4, 119), 119);
// nến chưa đóng bị bỏ qua
assert.equal(trailingStop([...bars.slice(0, 20), { ...bars[20], closed: false }], 1, 19 * H4, 90), 100 - 3 * 2);
// SHORT: best close thấp nhất
assert.equal(trailingStop(bars.slice(0, 20), -1, 0, 110), 100 + 3 * 2);
// ít dữ liệu → giữ nguyên
assert.equal(trailingStop(bars.slice(0, 5), 1, 0, 95), 95);

const calls = [];
const reply = (data) => ({ ok: true, json: async () => ({ success: true, data }) });
globalThis.fetch = async (url, init) => {
  calls.push({ url, body: init?.body });
  if (url.includes("open_orders")) return reply([{ id: 7, positionId: 9, stopLossPrice: "12.67", isFinished: 0 }]);
  return reply(true);
};
// siết SL LONG, làm tròn theo số lẻ của SL hiện tại
let r = await tightenStop({ positionId: 9, side: 1, newStop: 13.04567 });
assert.deepEqual(r, { moved: true, from: 12.67, dryRun: false });
assert.equal(JSON.parse(calls.at(-1).body).stopLossPrice, 13.05);
assert.equal(JSON.parse(calls.at(-1).body).stopPlanOrderId, 7);
// SL mới thấp hơn → không gọi đổi
calls.length = 0;
r = await tightenStop({ positionId: 9, side: 1, newStop: 12.5 });
assert.equal(r.moved, false);
assert.ok(!calls.some((c) => c.url.includes("change_plan_price")));
// không có SL → báo lỗi
await assert.rejects(tightenStop({ positionId: 1, side: 1, newStop: 13 }));
// dry-run: không gọi API
process.env.MEXC_DRY_RUN = "true";
calls.length = 0;
r = await tightenStop({ positionId: 9, side: 1, newStop: 13 });
assert.deepEqual(r, { moved: false, dryRun: true });
assert.equal(calls.length, 0);
console.log("All trailing live tests passed!");
