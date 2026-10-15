import assert from "node:assert/strict";
const { parseWatch, evaluateWatches } = await import("../lib/price-watch.ts");
const COINS = ["BTC", "SUI", "LTC"];
const now = Date.UTC(2026, 9, 13, 4, 30); // 11:30 VN
const w = parseWatch("theo dõi sui 1.041 1.029 1.085 btc 82750", COINS, now);
assert.deepEqual({ ...w, expires: undefined }, { coin: "SUI", side: 1, entry: 1.041, stop: 1.029, tp: 1.085, btcCancel: 82750, expires: undefined });
assert.equal(w.expires, Date.UTC(2026, 9, 13, 16, 59)); // 23:59 VN
assert.equal(parseWatch("theo doi LTC 61.35 60.9 63.2", COINS, now).btcCancel, undefined);
assert.equal(parseWatch("theo dõi DOGE 1 0.9 1.2", COINS, now), null); // coin lạ
assert.equal(parseWatch("theo dõi SUI 1.041 1.029 1.0", COINS, now), null); // TP sai phía
assert.equal(parseWatch("theo dõi SUI 1.041 1.06 1.0", COINS, now).side, -1); // SHORT
// chưa chạm → giữ; chạm → báo; BTC mất mức → huỷ; hết hạn → báo
let r = evaluateWatches([w], { SUI: 1.05, BTC: 83000 }, now);
assert.equal(r.msgs.length, 0); assert.equal(r.keep.length, 1);
r = evaluateWatches([w], { SUI: 1.04, BTC: 83000 }, now);
assert.match(r.msgs[0], /CHẠM ĐIỂM VÀO/); assert.equal(r.keep.length, 0);
r = evaluateWatches([w], { SUI: 1.05, BTC: 82700 }, now);
assert.match(r.msgs[0], /HUỶ/); assert.equal(r.keep.length, 0);
r = evaluateWatches([w], { SUI: 1.02, BTC: 83000 }, now);
assert.match(r.msgs[0], /qua luôn SL/);
r = evaluateWatches([w], { SUI: 1.05, BTC: 83000 }, w.expires + 1);
assert.match(r.msgs[0], /Hết hạn/);
console.log("All price watch tests passed!");

// ⏰ gần tới (< 0.5%) báo 1 lần, chưa chạm thì vẫn giữ theo dõi
{
  const { evaluateWatches: ev } = await import("../lib/price-watch.ts");
  const s = { coin: "SUI", side: -1, entry: 1.022, stop: 1.032, tp: 0.9608, expires: Date.now() + 3_600_000 };
  let r = ev([s], { SUI: 1.0, BTC: 80000 });
  assert.equal(r.msgs.length, 0); // còn xa 2.2%
  r = ev([s], { SUI: 1.018, BTC: 80000 }); // cách 0.39%
  assert.match(r.msgs[0], /GẦN TỚI/); assert.equal(r.keep.length, 1); assert.equal(r.keep[0].near, true);
  r = ev(r.keep, { SUI: 1.019, BTC: 80000 });
  assert.equal(r.msgs.length, 0); // không báo lại
  r = ev(r.keep, { SUI: 1.023, BTC: 80000 });
  assert.match(r.msgs[0], /CHẠM ĐIỂM VÀO/);
  console.log("near-entry watch ok");
}
