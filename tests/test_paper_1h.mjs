import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const { openPaper1h, managePaper1h, loadPaper1h, paper1hStats } = await import("../lib/paper-1h.ts");
const H = 3_600_000;
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "p1h-")), "p.json");
// 20 nến đi ngang (ATR 2) → nến xác nhận ở t=19 đóng 100; LONG SL 97
const bars = Array.from({ length: 20 }, (_, i) => ({ t: i * H, o: 100, h: 101, l: 99, c: 100, closed: true }));
assert.equal(openPaper1h("SOL", { side: 1, entry: 100, stop: 97, barTime: 19 * H }, file), true);
assert.equal(openPaper1h("SOL", { side: 1, entry: 100, stop: 97, barTime: 19 * H }, file), false); // đã có lệnh mở
// giá chạy lên 110 → SL kéo lên (110 - 3*ATR), chưa đóng
bars.push({ t: 20 * H, o: 100, h: 110.5, l: 100, c: 110, closed: true });
assert.deepEqual(managePaper1h("SOL", bars, file), []);
const s1 = loadPaper1h(file)[0].stop;
assert.ok(s1 > 97 && s1 < 110, `SL kéo lên: ${s1}`);
// nến chưa đóng bị bỏ qua
assert.deepEqual(managePaper1h("SOL", [...bars, { t: 21 * H, o: 110, h: 110, l: 90, c: 95, closed: false }], file), []);
// nến đóng thủng SL → đóng ở SL, R dương sau phí
bars.push({ t: 21 * H, o: 110, h: 110, l: 90, c: 95, closed: true });
const msg = managePaper1h("SOL", bars, file);
assert.match(msg[0], /PAPER 1H ĐÓNG/);
const p = loadPaper1h(file)[0];
assert.equal(p.exitPrice, s1);
assert.ok(Math.abs(p.r - ((s1 / 100 - 1) - 0.002) / 0.03) < 1e-9);
// gap qua SL → khớp ở giá mở
openPaper1h("ETH", { side: -1, entry: 100, stop: 103, barTime: 19 * H }, file);
managePaper1h("ETH", [...bars.slice(0, 20), { t: 20 * H, o: 105, h: 106, l: 104, c: 105, closed: true }], file);
const e = loadPaper1h(file).find((x) => x.coin === "ETH");
assert.equal(e.exitPrice, 105);
const st = paper1hStats(loadPaper1h(file));
assert.equal(st.n, 2); assert.equal(st.wins, 1); assert.equal(st.open, 0);
console.log("All paper 1H tests passed!");
