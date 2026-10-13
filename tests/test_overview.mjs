import assert from "node:assert/strict";
const { scoreSide, pickCoin } = await import("../lib/overview.ts");
const H1 = 3_600_000, H4 = 4 * H1, M15 = 900_000;
const flat = (n, step, mk) => Array.from({ length: n }, (_, i) => ({ t: i * step, v: 1, closed: true, ...mk(i) }));
// 4H/1H đi ngang quanh 100, có swing đỉnh 1H ở 103 (mục tiêu LONG)
const h4 = flat(40, H4, (i) => ({ o: 100, h: 101 + (i % 7 === 3 ? 1 : 0), l: 99 - (i % 7 === 5 ? 1 : 0), c: 100 }));
const h1 = flat(40, H1, (i) => ({ o: 100, h: i === 30 ? 105 : 100.5, l: 99.5, c: 100 }));
// 15m: rơi xuống quét đáy 98.5 rồi nến xanh mạnh volume lớn
const m15 = flat(40, M15, () => ({ o: 100, h: 100.3, l: 99.7, c: 100 }));
m15[38] = { t: 38 * M15, o: 99.8, h: 99.9, l: 98.5, c: 99.7, v: 1, closed: true };
m15[39] = { t: 39 * M15, o: 99.7, h: 100.6, l: 99.6, c: 100.5, v: 5, closed: true };
const L = scoreSide(1, { own: 1, btc: 1, h4, h1, m15 });
assert.ok(L, "có kế hoạch LONG");
assert.ok(L.score >= 3, `LONG đủ lớp: ${L.score} ${L.reasons}`);
assert.ok(L.stop < 98.5 && L.tp > L.entry && L.rr >= 1.5, JSON.stringify(L));
// ngược trend + BTC ngược → ít lớp hơn
const L2 = scoreSide(1, { own: -1, btc: -1, h4, h1, m15 });
assert.ok(L2.score < L.score);
// minScore cao quá → không chọn
assert.equal(pickCoin("X", { own: -1, btc: -1, h4, h1, m15 }, 5), null);
console.log("All overview tests passed!");
