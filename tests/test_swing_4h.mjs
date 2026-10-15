import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const { openSwing, stepSwing, loadSwings, swingStats } = await import("../lib/swing-4h.ts");
const { isSwingSetupOk } = await import("../lib/trading-policy.ts");
const H4 = 4 * 3_600_000;
// 30 nến đi ngang quanh 100 (ATR ~2), rồi vào LONG ở nến 30
const bars = Array.from({ length: 30 }, (_, i) => ({ t: i * H4, o: 100, h: 101, l: 99, c: 100, closed: true }));
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sw-")), "s.json");
assert.equal(openSwing("SOL", { side: 1, entry: 100, stop: 95, entryTime: 30 * H4 }, file), true);
assert.equal(openSwing("SOL", { side: 1, entry: 100, stop: 95, entryTime: 30 * H4 }, file), false, "1 lệnh mở/coin");
// giá tăng mạnh → SL trailing được siết lên và nhắn
bars.push({ t: 30 * H4, o: 100, h: 106, l: 99.5, c: 105, closed: true }, { t: 31 * H4, o: 105, h: 111, l: 104.5, c: 110, closed: true });
const up = stepSwing("SOL", bars, file);
assert.ok(up.some((m) => /dời SL/.test(m)), up.join("|"));
const sl = loadSwings(file)[0].stop;
assert.ok(sl > 95 && sl < 110, `SL mới ${sl}`);
assert.equal(stepSwing("SOL", bars, file).length, 0, "không nhắn lại nến đã xử lý");
// giá rơi thủng SL mới → đóng, lời vì SL đã trên giá vào
bars.push({ t: 32 * H4, o: 109, h: 109, l: sl - 1, c: sl - 0.5, closed: true });
const down = stepSwing("SOL", bars, file);
assert.match(down[0], /chạm SL/);
const x = loadSwings(file)[0];
assert.equal(x.status, "closed"); assert.equal(x.exitPrice, sl); assert.ok(x.r > 0);
assert.equal(swingStats(loadSwings(file)).n, 1);
// bộ lọc kèo 4H
const s = { style: "double_top_bottom", state: "triggered", side: 1, entry: 100, stop: 97, volumeRatio: 2.5 };
const ctx = { ownDaily: 1, btcDaily: 1, lastBarTime: 0, now: 3_600_000 };
assert.equal(isSwingSetupOk(s, ctx), true);
assert.equal(isSwingSetupOk(s, { ...ctx, btcDaily: -1 }), false, "BTC ngược ngày");
assert.equal(isSwingSetupOk({ ...s, volumeRatio: 1.5 }, ctx), false, "volume < 2x");
assert.equal(isSwingSetupOk({ ...s, stop: 99 }, ctx), false, "SL < 1.5%");
assert.equal(isSwingSetupOk(s, { ...ctx, btc1h: [{ o: 100, c: 99 }] }), false, "BTC 1H vừa giảm 1%");
assert.equal(isSwingSetupOk(s, { ...ctx, livePrice: 101 }), false, "giá trôi > 0.25%");
assert.equal(isSwingSetupOk({ ...s, style: "bos" }, ctx), false, "chỉ hai đỉnh/đáy");
console.log("All swing 4H tests passed!");
