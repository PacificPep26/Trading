import assert from "node:assert/strict";
const { wickReversal } = await import("../lib/patterns.ts");
const H = 3_600_000;
// 28 nến đi ngang 100–102, rồi nến rút chân thủng đáy 24 nến, rồi nến xanh mạnh vượt đỉnh nến rút chân
const flat = Array.from({ length: 28 }, (_, i) => ({ t: i * H, o: 101, h: 102, l: 100, c: 101, v: 1, closed: true }));
const sweep = { t: 28 * H, o: 101, h: 101.2, l: 97, c: 100.5, v: 1, closed: true };
const green = { t: 29 * H, o: 100.6, h: 103, l: 100.5, c: 102.8, v: 1, closed: true };
const w = wickReversal([...flat, sweep, green]);
assert.equal(w.side, 1); assert.equal(w.level, 100); assert.equal(w.entry, 102.8);
assert.ok(w.stop < 97 && Math.abs(w.tp - (102.8 + 1.8 * (102.8 - w.stop))) < 1e-9);
// nến xác nhận chưa đóng → bỏ qua
assert.equal(wickReversal([...flat, sweep, { ...green, closed: false }]), null);
// nến xanh yếu (không vượt đỉnh nến rút chân) → không báo
assert.equal(wickReversal([...flat, sweep, { ...green, h: 101.1, c: 101.0 }]), null);
// đối xứng SHORT: quét đỉnh rồi nến đỏ mạnh
const sw2 = { t: 28 * H, o: 101, h: 105, l: 100.8, c: 101.5, v: 1, closed: true };
const red = { t: 29 * H, o: 101.4, h: 101.5, l: 99, c: 99.2, v: 1, closed: true };
const s = wickReversal([...flat, sw2, red]);
assert.equal(s.side, -1); assert.equal(s.level, 102); assert.ok(s.stop > 105);
console.log("All wick reversal tests passed!");
