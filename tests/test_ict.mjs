import assert from "node:assert/strict";
const { ictSweepShort } = await import("../lib/patterns.ts");
const H = 3_600_000, DAY = 24 * H, D = 20_000 * DAY;
const bar = (t, o, h, l, c) => ({ t, o, h, l, c, v: 1, closed: true });
const cs = [];
for (let i = 14; i > 0; i--) cs.push(bar(D - DAY - i * H, 105, 106, 104, 105)); // hôm kia
for (let i = 0; i < 24; i++) cs.push(bar(D - DAY + i * H, 105, i === 10 ? 110 : 106, i === 5 ? 98 : 104, 105)); // hôm qua: PDH 110, PDL 98
const today = [
  [105, 106, 104, 105], [105, 106, 104, 105], [105, 105, 103, 104], // nến 2: swing đáy 103
  [105, 106, 104, 105], [105, 106, 104, 105], [105, 106, 104, 105],
  [106, 111, 105, 109],     // 6: quét đỉnh hôm qua (111 > 110)
  [109, 109.5, 107, 107.5], // 7
  [107.5, 107.8, 105.5, 106],
  [106, 106.5, 102.5, 102.8], // 9: đóng dưới 103 = ChoCh; high 106.5 < low nến 7 (107) = FVG
];
today.forEach(([o, h, l, c], i) => cs.push(bar(D + i * H, o, h, l, c)));
const s = ictSweepShort(cs);
assert.ok(s, "phải có kèo ICT");
assert.equal(s.side, -1); assert.equal(s.tp, 98); assert.equal(s.limit, (106.5 + 107) / 2);
assert.ok(s.stop > 111 && s.stop < 112, `SL trên râu quét: ${s.stop}`);
assert.equal(s.barTime, D + 9 * H);
assert.equal(ictSweepShort([...cs, bar(D + 10 * H, 102.8, 103, 101, 101.5)]), null, "chỉ báo 1 lần, lúc nến ChoCh vừa đóng");
assert.equal(ictSweepShort(cs.map((c) => (c.t === D + 6 * H ? { ...c, h: 109.9 } : c))), null, "không quét đỉnh thì không có kèo");
console.log("All ICT tests passed!");
