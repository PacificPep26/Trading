import assert from "node:assert/strict";
const { nyToUtcMs, newsMessages, US_EVENTS } = await import("../lib/us-events.ts");
// giờ hè (EDT, UTC−4) và giờ đông (EST, UTC−5)
assert.equal(nyToUtcMs("2026-10-14T08:30"), Date.UTC(2026, 9, 14, 12, 30));
assert.equal(nyToUtcMs("2026-01-13T08:30"), Date.UTC(2026, 0, 13, 13, 30));
assert.equal(nyToUtcMs("2026-03-08T08:30"), Date.UTC(2026, 2, 8, 12, 30)); // ngày đổi sang giờ hè
assert.equal(nyToUtcMs("2026-11-01T08:30"), Date.UTC(2026, 10, 1, 13, 30)); // ngày về giờ đông
assert.ok(US_EVENTS.some((e) => e.type === "CPI" && e.t === Date.UTC(2026, 9, 14, 12, 30)));
const ev = [{ t: Date.UTC(2026, 9, 14, 12, 30), type: "CPI" }], sent = new Set();
assert.equal(newsMessages(ev, ev[0].t - 2 * 3_600_000, sent, []).length, 0, "quá sớm");
const pre = newsMessages(ev, ev[0].t - 30 * 60_000, sent, []);
assert.equal(pre.length, 1); assert.match(pre[0], /^⏰ 19:30 tin CPI/);
assert.equal(newsMessages(ev, ev[0].t - 25 * 60_000, sent, []).length, 0, "không gửi lại");
const bar = { t: ev[0].t, o: 83000, c: 82500, closed: true };
assert.equal(newsMessages(ev, ev[0].t + 2 * 60_000, sent, [bar]).length, 0, "nến 5m chưa đóng");
const post = newsMessages(ev, ev[0].t + 6 * 60_000, sent, [bar]);
assert.equal(post.length, 1); assert.match(post[0], /^⚡ CPI vừa ra · BTC nến 5m đầu 🔴 -0.60%/);
assert.equal(newsMessages(ev, ev[0].t + 10 * 60_000, sent, [bar]).length, 0);
console.log("All US events tests passed!");
