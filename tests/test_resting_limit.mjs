import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const { restingLimit } = await import("../lib/patterns.ts");
const { addLimit, stepLimits, loadLimits, limitStats } = await import("../lib/resting-limit.ts");
const H = 3_600_000;
// đỉnh 110 ở nến 20, đáy 100 ở nến 30, rồi 3 nến cao hơn → đáy 1H vừa xác nhận ở nến cuối (33)
const cs = Array.from({ length: 44 }, (_, i) => {
  const mid = i === 30 ? 109 : i === 40 ? 101 : 105;
  return { t: i * H, o: mid, h: i === 30 ? 110 : mid + 1, l: i === 40 ? 100 : mid - 1, c: mid, v: 1, closed: true };
});
const s = restingLimit(cs, 1);
assert.ok(s, "có kèo LONG");
assert.equal(s.level, 100); assert.equal(s.tp, 110);
assert.ok(s.limit < 100 && s.stop < s.limit);
assert.ok(Math.abs((100 - s.limit) / s.atr - 0.5) < 1e-9 && Math.abs((s.limit - s.stop) / s.atr - 1.5) < 1e-9);
assert.equal(restingLimit(cs.slice(0, 43), 1), null); // chưa đủ 3 nến sau đáy
// nến tạo đáy volume ≥ 2.5x TB 20 nến trước → bỏ
assert.equal(restingLimit(cs.map((c, i) => (i === 40 ? { ...c, v: 3 } : c)), 1), null);
assert.ok(restingLimit(cs.map((c, i) => (i === 40 ? { ...c, v: 2 } : c)), 1));
// paper: chờ → khớp → TP
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rl-")), "l.json");
assert.equal(addLimit("NEAR", s, file), true);
assert.equal(addLimit("NEAR", s, file), false);
const t0 = s.barTime;
let m = stepLimits("NEAR", [{ t: t0 + H, o: 101, h: 102, l: s.limit - 0.01, c: 101, closed: true }], file);
assert.match(m[0], /KHỚP/);
m = stepLimits("NEAR", [{ t: t0 + 2 * H, o: 105, h: 111, l: 104, c: 110, closed: true }], file);
assert.match(m[0], /ĐÓNG/);
const x = loadLimits(file)[0];
assert.equal(x.status, "closed"); assert.equal(x.exitPrice, 110); assert.ok(x.r > 1);
// huỷ khi chạy tới TP trước khi khớp
addLimit("OP", s, file);
m = stepLimits("OP", [{ t: t0 + H, o: 105, h: 111, l: 104, c: 110, closed: true }], file);
assert.match(m[0], /huỷ/); assert.equal(loadLimits(file).find((r) => r.coin === "OP").status, "cancelled");
// khớp và chạm SL cùng nến = thua
addLimit("ADA", s, file);
stepLimits("ADA", [{ t: t0 + H, o: 101, h: 101, l: s.stop - 1, c: s.stop - 0.5, closed: true }], file);
assert.ok(loadLimits(file).find((r) => r.coin === "ADA").r < -1);
// đáy mới thay lệnh chờ cũ chưa khớp; lệnh đã khớp thì không thay
const f2 = path.join(path.dirname(file), "r.json");
addLimit("SUI", s, f2);
assert.equal(addLimit("SUI", { ...s, limit: s.limit - 1, barTime: t0 + 5 * H }, f2), false, "mặc định giữ lệnh cũ");
assert.equal(addLimit("SUI", { ...s, limit: s.limit - 1, barTime: t0 + 5 * H }, f2, true), true);
const sui = loadLimits(f2).filter((r) => r.coin === "SUI");
assert.deepEqual(sui.map((r) => r.status), ["cancelled", "pending"]); assert.equal(sui[1].limit, s.limit - 1);
stepLimits("SUI", [{ t: t0 + 6 * H, o: 101, h: 102, l: s.limit - 2, c: 101, closed: true }], f2);
assert.equal(addLimit("SUI", s, f2, true), false, "đang có lệnh khớp thì không đặt thêm");
const st = limitStats(loadLimits(file));
assert.equal(st.n, 2); assert.equal(st.wins, 1);
console.log("All resting limit tests passed!");
