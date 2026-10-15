// "Mấy ngày nay có kèo nào ăn không?" — chạy lại ĐÚNG code bot trên nến OKX thật N ngày gần nhất, liệt kê từng lệnh.
// Chạy: node --experimental-strip-types --no-warnings service/scripts/recent_replay.mjs [số ngày, mặc định 14]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyse, restingLimit, ictSweepShort } from "../../lib/patterns.ts";
import { isSwingSetupOk } from "../../lib/trading-policy.ts";
import { openSwing, stepSwing, loadSwings } from "../../lib/swing-4h.ts";
import { addLimit, stepLimits, loadLimits } from "../../lib/resting-limit.ts";
import { soSetups, SO_LABEL, highTestSetup, stFlipSetup, inducementSetup } from "../../lib/so-setups.ts";

const DAYS = Number(process.argv[2] ?? 14), H = 3_600_000, H4 = 4 * H, H15 = 15 * 60_000, DAY = 86_400_000, USD = 2.5;
const COINS = ["BTC","ETH","SOL","HYPE","XRP","DOGE","BNB","ADA","AVAX","LINK","DOT","LTC","SUI","ARB","OP","NEAR","APT","INJ","TIA","PEPE","WIF"];
const START = Date.now() - DAYS * DAY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// OKX history-candles (100 nến/lần), chỉ nến đã đóng, cũ → mới
async function history(inst, bar, count) {
  const out = [];
  let after = "";
  while (out.length < count) {
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=${inst}&bar=${bar}&limit=100${after ? `&after=${after}` : ""}`;
    const j = await (await fetch(url)).json();
    if (!j.data?.length) break;
    for (const r of j.data) out.push({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[6], closed: r[8] === "1" });
    after = j.data.at(-1)[0];
    await sleep(120);
  }
  return out.filter((b) => b.closed).reverse();
}
function dailyTrendFn(h1) {
  const days = new Map();
  for (const b of h1) { const d = Math.floor(b.t / DAY) * DAY; const x = days.get(d); if (!x) days.set(d, { t: d, c: b.c }); else x.c = b.c; }
  const arr = [...days.values()]; let ema = arr[0].c; const tr = new Map(); let n = 0;
  for (const d of arr) { ema += (2 / 51) * (d.c - ema); n++; tr.set(d.t + DAY, n >= 60 ? (d.c > ema ? 1 : -1) : 0); }
  return (t) => tr.get(Math.floor(t / DAY) * DAY) ?? 0;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "recent-"));
const files = { "📌 Limit": "limit", "🎯 ICT": "ict", "🔨 High test 4H": "ht", "🔨 High test 15m": "ht15", "🧲 TradingLab IDM": "idm", ...Object.fromEntries(Object.entries(SO_LABEL).map(([k, v]) => [v.name, `so-${k}`])) };
const f = (coin, k) => path.join(tmp, `${coin}-${k}.json`);
const swingTrades = [], stTrades = [];
const btc4 = await history("BTC-USDT-SWAP", "4H", 900), btcTrend = dailyTrendFn(btc4.flatMap((b) => [b]));

for (const coin of COINS) {
  const inst = `${coin}-USDT-SWAP`;
  const h15 = await history(inst, "15m", 120 + DAYS * 96 + 96);
  const h1 = await history(inst, "1H", 300 + DAYS * 24 + 24);
  const h4 = await history(inst, "4H", 300 + DAYS * 6 + 6);
  // xu hướng ngày cần ≥ 60 ngày: dựng từ nến 4H (900 nến ≈ 150 ngày)
  const h4long = coin === "BTC" ? btc4 : await history(inst, "4H", 900);
  const own = dailyTrendFn(h4long);
  for (let n = 120; n < h15.length; n++) {
    const now = h15[n].t + H15 + 60_000;
    if (now < START) continue;
    const bars = h15.slice(n - 119, n + 1);
    stepLimits(coin, bars, f(coin, "ht15"));
    for (const g of highTestSetup(bars, "swing")) {
      addLimit(coin, { side: g.side, level: g.trigger, limit: g.trigger, stop: g.stop, tp: g.tp, atr: 0, barTime: g.barTime, stopEntry: true, barMs: H15 }, f(coin, "ht15"));
    }
  }
  for (let n = 300; n < h1.length; n++) {
    const now = h1[n].t + H + 60_000;
    if (now < START) continue;
    const bars = h1.slice(n - 99, n + 1);
    for (const k of Object.values(files)) stepLimits(coin, (k === "ht" || k === "ht15") ? [] : bars, f(coin, k));
    if (own(now) > 0) { const rl = restingLimit(bars, 1); if (rl) addLimit(coin, rl, f(coin, "limit"), true); }
    const ict = ictSweepShort(bars);
    if (ict) addLimit(coin, ict, f(coin, "ict"));
    for (const g of inducementSetup(h1.slice(n - 299, n + 1))) {
      addLimit(coin, { side: g.side, level: g.limit, limit: g.limit, stop: g.stop, tp: g.tp, atr: 0, barTime: g.barTime }, f(coin, "idm"), true);
    }
    for (const so of soSetups(h1.slice(n - 299, n + 1))) {
      addLimit(coin, { side: so.side, level: so.entry, limit: so.entry, stop: so.stop, tp: so.tp, atr: 0, barTime: so.barTime, market: !so.limit }, f(coin, `so-${so.kind}`));
    }
  }
  for (let i = 300; i < h4.length; i++) {
    const now = h4[i].t + H4 + 60_000;
    if (now < START) continue;
    const win = h4.slice(i - 299, i + 1);
    stepSwing(coin, h4.slice(i - 119, i + 1), f(coin, "4h"));
    stepLimits(coin, h4.slice(i - 119, i + 1), f(coin, "ht"));
    if (!loadSwings(f(coin, "4h")).some((x) => x.status === "open")) {
      const a = analyse(win);
      const s = a.setups.find((x) => isSwingSetupOk(x, { ownDaily: own(now), btcDaily: btcTrend(now), lastBarTime: a.lastBarTime, now }));
      if (s && h4[i + 1]) openSwing(coin, { side: s.side, entry: h4[i + 1].o, stop: s.stop, entryTime: h4[i + 1].t }, f(coin, "4h"));
    }
    stepSwing(coin, win, f(coin, "st"));
    const st = stFlipSetup(win);
    if (st && h4[i + 1]) openSwing(coin, { side: st.side, entry: h4[i + 1].o, stop: st.stop, entryTime: h4[i + 1].t, trail: "st" }, f(coin, "st"));
    for (const g of highTestSetup(win)) addLimit(coin, { side: g.side, level: g.trigger, limit: g.trigger, stop: g.stop, tp: g.tp, atr: 0, barTime: g.barTime, stopEntry: true, barMs: H4 }, f(coin, "ht"));
  }
  for (const x of loadSwings(f(coin, "4h"))) swingTrades.push({ coin, ...x });
  for (const x of loadSwings(f(coin, "st"))) stTrades.push({ coin, ...x });
  process.stderr.write(`${coin} `);
}

const vn = (t) => new Date(t + 7 * H).toISOString().slice(5, 16).replace("T", " ");
const report = (name, rows) => {
  const done = rows.filter((x) => x.r !== undefined), open = rows.filter((x) => x.status === "open");
  const sum = done.reduce((a, x) => a + x.r, 0);
  console.log(`\n${name}: ${done.length} lệnh đóng · thắng ${done.filter((x) => x.r > 0).length} · tổng ${sum >= 0 ? "+" : ""}${(sum * USD).toFixed(1)}$ · đang mở ${open.length}`);
  for (const x of rows.filter((x) => x.status !== "cancelled" && x.status !== "pending")) {
    console.log(`  ${vn(x.createdBar ?? x.entryTime)} ${x.side > 0 ? "LONG " : "SHORT"} ${x.coin.padEnd(5)} vào ${x.entry} → ${x.exitPrice ?? "đang mở"}${x.r !== undefined ? ` · ${x.r >= 0 ? "+" : ""}${x.r.toFixed(2)}R (${(x.r * USD).toFixed(1)}$)` : ""}`);
  }
};
console.log(`\nKết quả ${DAYS} ngày gần nhất (giá OKX, code bot hiện tại, 2.5$/lệnh)`);
for (const [name, k] of Object.entries(files)) report(name, COINS.flatMap((c) => loadLimits(f(c, k)).map((x) => ({ ...x, coin: c }))));
report("📊 4H hai đỉnh/đáy", swingTrades);
report("📈 Supertrend 4H", stTrades);
fs.rmSync(tmp, { recursive: true, force: true });
