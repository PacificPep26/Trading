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

// 🔨 high test: hồi về đỉnh cũ 110.6 bằng nến búa (râu dưới dài) → lệnh chờ mua trên đỉnh nến
const { highTestSetup } = await import("../lib/so-setups.ts");
const ht = path_.map((c, i) => ({ t: i * H, o: i ? path_[i - 1] : c, h: c + 0.6, l: c - 0.6, c, v: 1, closed: true }));
ht.push({ t: ht.length * H, o: 111.5, h: 111.8, l: 110.5, c: 111.6, v: 1, closed: true });
const g = highTestSetup(ht);
assert.equal(g.length, 1); assert.equal(g[0].side, 1); assert.equal(g[0].trigger, 111.8);
assert.ok(g[0].stop < 110.5 && Math.abs((g[0].tp - 111.8) - 2 * (111.8 - g[0].stop)) < 1e-9, "SL dưới nến, TP 2R");
// lệnh chờ phá: chạm SL trước khi phá → huỷ; phá rồi chạm TP → thắng
const f2 = path.join(path.dirname(file), "ht.json");
addLimit("SOL", { side: 1, level: 111.8, limit: 111.8, stop: 110.3, tp: 114.8, atr: 0, barTime: 0, stopEntry: true, barMs: 4 * H }, f2);
stepLimits("SOL", [{ t: 4 * H, o: 111, h: 111.5, l: 110.2, c: 110.5, closed: true }], f2);
assert.equal(loadLimits(f2)[0].status, "cancelled");
addLimit("ETH", { side: 1, level: 111.8, limit: 111.8, stop: 110.3, tp: 114.8, atr: 0, barTime: 0, stopEntry: true, barMs: 4 * H }, f2);
stepLimits("ETH", [{ t: 4 * H, o: 111.6, h: 112.5, l: 111.4, c: 112.2, closed: true }, { t: 8 * H, o: 112.2, h: 115, l: 112, c: 114.9, closed: true }], f2);
const e2 = loadLimits(f2).find((r) => r.coin === "ETH");
assert.equal(e2.entry, 111.8); assert.equal(e2.exitPrice, 114.8); assert.ok(e2.r > 1.9);
console.log("All high test tests passed!");
// 📈 Supertrend 4H: 80 nến giảm đều rồi bật mạnh → đổi màu LONG đúng ở nến bật, SL dưới dải; nến sau không báo lại
const { stFlipSetup, supertrend } = await import("../lib/so-setups.ts");
const { openSwing, stepSwing, loadSwings } = await import("../lib/swing-4h.ts");
const dn = Array.from({ length: 80 }, (_, i) => { const p = 1000 - i; return { t: i * H, o: p, h: p + 1, l: p - 1.5, c: p - 0.5, v: 1, closed: true }; });
assert.equal(stFlipSetup(dn), null, "đang giảm, chưa đổi màu");
dn.push({ t: 80 * H, o: 921, h: 931, l: 920, c: 930, v: 1, closed: true });
const sf = stFlipSetup(dn);
assert.ok(sf && sf.side === 1 && sf.stop < sf.entry && sf.entry === 930, JSON.stringify(sf));
assert.equal(supertrend(dn).dir.at(-1), 1);
dn.push({ t: 81 * H, o: 930, h: 934, l: 929, c: 933, v: 1, closed: true });
assert.equal(stFlipSetup(dn), null, "chỉ báo nến đổi màu");
// SL dời theo dải (chỉ siết lên)
const f3 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "st-")), "st.json");
openSwing("SOL", { side: 1, entry: 930, stop: sf.stop, entryTime: 81 * H, trail: "st" }, f3);
for (let k = 82; k < 90; k++) dn.push({ t: k * H, o: 933 + (k - 82) * 3, h: 937 + (k - 82) * 3, l: 932 + (k - 82) * 3, c: 936 + (k - 82) * 3, v: 1, closed: true });
assert.ok(stepSwing("SOL", dn, f3).some((m) => /dời SL/.test(m)));
assert.ok(loadSwings(f3)[0].stop > sf.stop && loadSwings(f3)[0].status === "open");
console.log("All supertrend tests passed!");

// 🧲 TradingLab: đỉnh A, FVG giảm, đỉnh B tại i - 3, Limit ở đáy A
const { inducementSetup } = await import("../lib/so-setups.ts");
const idmCs = Array.from({ length: 65 }, (_, i) => ({ t: i * H, o: 100, h: 101, l: 99, c: 100, v: 1, closed: true }));
idmCs.push({ t: 65 * H, o: 120, h: 130, l: 124, c: 125, closed: true }); // A
idmCs.push({ t: 66 * H, o: 124, h: 124, l: 118, c: 119, closed: true });
idmCs.push({ t: 67 * H, o: 119, h: 120, l: 110, c: 111, closed: true }); // FVG: high 120 < 124
idmCs.push({ t: 68 * H, o: 110, h: 110, l: 100, c: 101, closed: true });
idmCs.push({ t: 69 * H, o: 101, h: 106, l: 100, c: 105, closed: true });
idmCs.push({ t: 70 * H, o: 105, h: 108, l: 102, c: 104, closed: true });
idmCs.push({ t: 71 * H, o: 104, h: 107, l: 101, c: 102, closed: true });
idmCs.push({ t: 72 * H, o: 102, h: 112, l: 105, c: 110, closed: true }); // B
idmCs.push({ t: 73 * H, o: 110, h: 109, l: 104, c: 105, closed: true });
idmCs.push({ t: 74 * H, o: 105, h: 107, l: 103, c: 104, closed: true });
idmCs.push({ t: 75 * H, o: 104, h: 105, l: 95, c: 96, closed: true });
const idmRes = inducementSetup(idmCs);
assert.equal(idmRes.length, 1);
assert.equal(idmRes[0].side, -1);
assert.equal(idmRes[0].limit, 124);
assert.ok(idmRes[0].stop > 130);
assert.equal(idmRes[0].tp, 95);
console.log("All inducement tests passed!");

