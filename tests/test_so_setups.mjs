import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const { soSetups } = await import("../lib/so-setups.ts");
const { addLimit, stepLimits, loadLimits } = await import("../lib/resting-limit.ts");
const H = 3_600_000;
// đi ngang → đáy 99 → đỉnh 110.6 → đáy 104 → phá đỉnh lên 115 → hồi về đỉnh cũ (3 nến thử, đóng trên 110.6) → nến tăng mạnh
const path_ = [...Array(80).fill(100), 99, 101, 103, 105, 107, 109, 110, 108, 106, 104, 106, 108, 110, 112, 114, 115, 113, 112, 111, 111.2, 111.3];
const cs = path_.map((c, i) => ({ t: i * H, o: i ? path_[i - 1] : c, h: c + 0.6, l: c - 0.6, c, v: 1, closed: true }));
cs.push({ t: cs.length * H, o: 111.3, h: 113.1, l: 111.2, c: 113, v: 1, closed: true });
const pb = soSetups(cs).find((s) => s.kind === "pullback");
assert.ok(pb, "phải có kèo hồi đỉnh cũ");
assert.equal(pb.side, 1); assert.equal(pb.entry, 113);
assert.ok(pb.stop < 110.4 && pb.stop > 109.5, `SL dưới nến thử thấp nhất (110.4): ${pb.stop}`);
assert.ok(Math.abs((pb.tp - pb.entry) - 3 * (pb.entry - pb.stop)) < 1e-9 && Math.abs((pb.tp1 - pb.entry) - 2 * (pb.entry - pb.stop)) < 1e-9, "TP1 2R, TP2 3R");
assert.equal(soSetups(cs.slice(0, 80)).length, 0, "đi ngang thì không có kèo");
// sổ paper Market: khớp ở giá mở nến kế, được tính TP ngay trong nến đó
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "so-")), "p.json");
addLimit("SOL", { side: 1, level: 112, limit: 112, stop: 110, tp: 116, atr: 0, barTime: 0, market: true }, file);
const m = stepLimits("SOL", [{ t: H, o: 112.5, h: 116.5, l: 112.2, c: 116, closed: true }], file);
assert.match(m[0], /KHỚP 112.5/); assert.match(m[1], /ĐÓNG/);
assert.equal(loadLimits(file)[0].exitPrice, 116);
console.log("All SO setups tests passed!");
