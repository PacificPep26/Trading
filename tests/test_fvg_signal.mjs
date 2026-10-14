import assert from "node:assert/strict";
const { fvgSweepSignal } = await import("../lib/patterns.ts");
const H = 3_600_000, M = 900_000;
// H1: xu hướng tăng (đáy/đỉnh cao dần), rồi FVG tăng ở nến 40: low[40]=106 > high[38]=104
const h1 = [];
for (let i = 0; i < 44; i++) {
  const base = 100 + i * 0.1 + (i % 6 === 0 ? -1 : i % 6 === 3 ? 1 : 0);
  h1.push({ t: i * H, o: base, h: base + 0.5, l: base - 0.5, c: base, v: 1, closed: true });
}
h1[38] = { t: 38 * H, o: 103.6, h: 104, l: 103.4, c: 103.9, v: 1, closed: true };
h1[39] = { t: 39 * H, o: 104, h: 107, l: 103.9, c: 106.8, v: 1, closed: true };
h1[40] = { t: 40 * H, o: 106.8, h: 108, l: 106, c: 107.8, v: 1, closed: true };
// 15m sau FVG: hồi về vùng (≤106), rồi quét đáy 8 nến và đóng quay lại
const m15 = [];
const start = 41 * H;
for (let j = 0; j < 32; j++) m15.push({ t: start + j * M, o: 106.2, h: 106.5, l: 105.8, c: 106.2, v: 1, closed: true });
m15.push({ t: start + 32 * M, o: 106.1, h: 106.3, l: 105.5, c: 106.0, v: 1, closed: true }); // quét 105.8 rồi đóng trên
const s = fvgSweepSignal(h1.slice(0, 44), m15, 1);
assert.ok(s, "có tín hiệu");
assert.equal(s.side, 1); assert.equal(s.entry, 106.0); assert.ok(s.stop < 105.5 && s.tp >= 108);
assert.equal(fvgSweepSignal(h1.slice(0, 44), m15, -1), null); // ngược trend ngày
assert.equal(fvgSweepSignal(h1.slice(0, 44), m15.slice(0, 32), 1), null); // nến cuối chưa phải nến kích hoạt
console.log("All FVG signal tests passed!");
