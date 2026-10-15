// Chạy lại ĐÚNG code live trên dữ liệu 2025–2026 để đối chiếu với các script Python (fee0_shootout.py):
//  A. Hai đỉnh/đáy 4H: analyse → isSwingSetupOk (bộ lọc live) → sổ swing-4h (vào giá mở nến 4H kế, SL trailing 3 ATR, không TP).
//  B. 📌 Limit dưới đáy 1H: restingLimit → addLimit → stepLimits (ghi paper ra file tạm như live), chỉ LONG như live.
//  C. 🎯 ICT quét đỉnh hôm qua → SHORT 1H: ictSweepShort → addLimit → stepLimits.
// Phí 0 (giao dịch tay), trượt 0.04% khứ hồi (đã có trong swing-4h.ts / resting-limit.ts). 2.5$/lệnh.
// Chạy: node --experimental-strip-types --no-warnings service/scripts/live_replay_study.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyse, restingLimit, ictSweepShort } from "../../lib/patterns.ts";
import { isSwingSetupOk } from "../../lib/trading-policy.ts";
import { openSwing, stepSwing, loadSwings } from "../../lib/swing-4h.ts";
import { addLimit, stepLimits, loadLimits } from "../../lib/resting-limit.ts";
import { soSetups, SO_LABEL } from "../../lib/so-setups.ts";

const H = 3_600_000, H4 = 4 * H, DAY = 86_400_000;
const START = Date.UTC(2025, 0, 1), USD = 2.5;
const COINS = ["BTC","ETH","SOL","HYPE","XRP","DOGE","BNB","ADA","AVAX","LINK","DOT","LTC","SUI","ARB","OP","NEAR","APT","INJ","TIA","1000PEPE","WIF"];
const dataUrl = (p) => new URL(`../../data/crypto/${p}`, import.meta.url);
const load = (c) => fs.readFileSync(dataUrl(`${c}USDT-PERP_1h.csv`), "utf8").trim().split("\n").slice(1)
  .map((l) => { const r = l.split(","); return { t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5], closed: true }; });
const loadFunding = (c) => { try { return fs.readFileSync(dataUrl(`funding/${c}USDT.csv`), "utf8").trim().split("\n").map((l) => l.split(",").map(Number)); } catch { return []; } };

function resample(bars, step) {
  const out = [];
  for (const b of bars) {
    const t = Math.floor(b.t / step) * step, x = out.at(-1);
    if (x && x.t === t) { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; x.v += b.v; }
    else out.push({ ...b, t });
  }
  return out;
}
// Như getDailyData: EMA50 trên nến ngày UTC đã đóng
function dailyTrendFn(h1) {
  const days = new Map();
  for (const b of h1) { const d = Math.floor(b.t / DAY) * DAY; const x = days.get(d); if (!x) days.set(d, { t: d, c: b.c }); else x.c = b.c; }
  const arr = [...days.values()]; let ema = arr[0].c; const tr = new Map(); let n = 0;
  for (const d of arr) { ema += (2 / 51) * (d.c - ema); n++; tr.set(d.t + DAY, n >= 60 ? (d.c > ema ? 1 : -1) : 0); }
  return (t) => tr.get(Math.floor(t / DAY) * DAY) ?? 0;
}
const lastBefore = (arr, t) => { let lo = 0, hi = arr.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m][0] <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k; };

const btc1h = load("BTC"), btcTrend = dailyTrendFn(btc1h), btcIdx = new Map(btc1h.map((b, i) => [b.t, i]));
const A = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "replay-"));
const B = [], C = [], D = Object.fromEntries(Object.keys(SO_LABEL).map((k) => [k, []]));

for (const coin of COINS) {
  const h1 = load(coin), h4 = resample(h1, H4), own = coin === "BTC" ? btcTrend : dailyTrendFn(h1), fund = loadFunding(coin);

  // A. Hai đỉnh/đáy 4H
  const fileA = path.join(tmp, `${coin}-4h.json`);
  for (let i = 300; i < h4.length - 1; i++) {
    const now = h4[i].t + H4 + 60_000; // lượt quét ngay sau khi nến 4H đóng
    if (now < START) continue;
    stepSwing(coin, h4.slice(i - 119, i + 1), fileA);
    if (loadSwings(fileA).some((x) => x.status === "open")) continue;
    const a = analyse(h4.slice(i - 299, i + 1));
    const bi = btcIdx.get(Math.floor(now / H) * H - H);
    const btcBars = bi !== undefined ? btc1h.slice(bi - 1, bi + 1) : undefined;
    const fi = lastBefore(fund, now), fundingRate = fi >= 0 ? fund[fi][1] : undefined;
    const s = a.setups.find((x) => isSwingSetupOk(x, { ownDaily: own(now), btcDaily: btcTrend(now), lastBarTime: a.lastBarTime, now, btc1h: btcBars, fundingRate, livePrice: h4[i + 1].o }));
    if (s) openSwing(coin, { side: s.side, entry: h4[i + 1].o, stop: s.stop, entryTime: h4[i + 1].t }, fileA);
  }
  for (const x of loadSwings(fileA)) if (x.status === "closed") A.push({ t: x.entryTime, r: x.r, held: (x.checkedTo - x.entryTime) / H + 4 });

  // B. 📌 Limit dưới đáy 1H (chỉ LONG như live)
  // C. 🎯 ICT quét đỉnh hôm qua → SHORT (ictSweepShort), paper riêng như live
  const file = path.join(tmp, `${coin}.json`), fileC = path.join(tmp, `${coin}-ict.json`);
  for (let n = 100; n < h1.length; n++) {
    const now = h1[n].t + H + 60_000;
    if (now < START) continue;
    const bars = h1.slice(n - 99, n + 1); // live lấy 100 nến 1H
    stepLimits(coin, bars, file);
    stepLimits(coin, bars, fileC);
    if (own(now) > 0) { const rl = restingLimit(bars, 1); if (rl) addLimit(coin, rl, file, true); } // như live: đáy mới thay lệnh chờ cũ
    const ict = ictSweepShort(bars);
    if (ict) addLimit(coin, ict, fileC);
    // D. kèo SO Trading: soSetups trên 300 nến 1H, mỗi kèo 1 sổ, Market vào ở giá mở nến kế
    if (n >= 300) {
      for (const k of Object.keys(SO_LABEL)) stepLimits(coin, bars, path.join(tmp, `${coin}-so-${k}.json`));
      for (const so of soSetups(h1.slice(n - 299, n + 1))) {
        addLimit(coin, { side: so.side, level: so.entry, limit: so.entry, stop: so.stop, tp: so.tp, atr: 0, barTime: so.barTime, market: !so.limit }, path.join(tmp, `${coin}-so-${so.kind}.json`));
      }
    }
  }
  for (const k of Object.keys(SO_LABEL)) for (const x of loadLimits(path.join(tmp, `${coin}-so-${k}.json`))) if (x.status === "closed" && x.r !== undefined) D[k].push({ t: x.createdBar, r: x.r });
  for (const x of loadLimits(file)) if (x.status === "closed" && x.r !== undefined) B.push({ t: x.createdBar, r: x.r });
  for (const x of loadLimits(fileC)) if (x.status === "closed" && x.r !== undefined) C.push({ t: x.createdBar, r: x.r });
  process.stderr.write(`${coin}: 4H ${A.length} · 📌 ${B.length} · 🎯 ${C.length}\n`);
}

function st(xs) {
  const n = xs.length; if (n < 2) return `n=${n}`;
  const rs = xs.map((x) => x.r), m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  return `n=${String(n).padStart(4)}  thắng ${(rs.filter((r) => r > 0).length / n * 100).toFixed(0)}%  TB ${m >= 0 ? "+" : ""}${m.toFixed(3)}R  t=${(m / (sd / Math.sqrt(n))).toFixed(2)}  tổng ${(m * n * USD >= 0 ? "+" : "") + (m * n * USD).toFixed(0)}$`;
}
const yr = (y) => (x) => new Date(x.t).getUTCFullYear() === y;
for (const [name, xs] of [["A. 📊 Hai đỉnh/đáy 4H, SL trailing 3 ATR", A], ["B. 📌 Limit dưới đáy 1H (LONG)", B], ["C. 🎯 ICT quét đỉnh hôm qua → SHORT 1H", C], ...Object.entries(D).map(([k, xs]) => [`D. ${SO_LABEL[k].name} (Python: ${SO_LABEL[k].stats})`, xs])]) {
  console.log(name);
  for (const y of [2025, 2026]) console.log(`  ${y}: ${st(xs.filter(yr(y)))}`);
  console.log(`  25–26: ${st(xs)}`);
}
if (A.length) console.log(`A giữ lệnh TB ${(A.reduce((a, x) => a + x.held, 0) / A.length / 24).toFixed(1)} ngày, lâu nhất ${(Math.max(...A.map((x) => x.held)) / 24).toFixed(0)} ngày`);
fs.rmSync(tmp, { recursive: true, force: true });
