// Backtest sniper 15m bằng đúng code live: analyse(1H) -> evaluateSetup(1H) -> radar -> evaluate15mSniper(15m)
// Chạy: node --experimental-strip-types --no-warnings service/scripts/sniper_15m_study.mjs 2>/dev/null
import fs from "node:fs";
import { analyse } from "../../lib/patterns.ts";
import { evaluateSetup } from "../../lib/decision-engine.ts";
import { sniperRadar, evaluate15mSniper, getTradingSessionInfo, detectVolumeAbsorption } from "../../lib/sniper-engine.ts";

const H = 3_600_000, M15 = 900_000, DAY = 86_400_000;
const FEE = 0.0008, SLIP = 0.0002; // taker MEXC mỗi chiều + trượt giá
const COINS = ["BTC","ETH","SOL","HYPE","XRP","DOGE","BNB","ADA","AVAX","LINK","DOT","LTC","SUI","ARB","OP","NEAR","APT","INJ","TIA","1000PEPE","WIF"];
const load = (c, tf) => fs.readFileSync(new URL(`../../data/crypto/${c}USDT-PERP_${tf}.csv`, import.meta.url), "utf8").trim().split("\n").slice(1)
  .map((l) => { const r = l.split(","); return { t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5], closed: true }; });

// Xu hướng ngày như getDailyData: EMA50 trên nến ngày đã đóng; trả về hàm trend(t)
function dailyTrendFn(h1) {
  const days = new Map();
  for (const b of h1) { const d = Math.floor(b.t / DAY) * DAY; const x = days.get(d); if (!x) days.set(d, { t: d, c: b.c }); else x.c = b.c; }
  const arr = [...days.values()]; let ema = arr[0].c; const tr = new Map(); let n = 0;
  for (const d of arr) { ema += (2 / 51) * (d.c - ema); n++; tr.set(d.t + DAY, n >= 60 ? (d.c > ema ? 1 : -1) : 0); }
  return (t) => tr.get(Math.floor(t / DAY) * DAY) ?? 0;
}

// Mô phỏng: vào ở giá mở nến 15m kế tiếp (+trượt), TP1 50% rồi dời SL hòa vốn, TP2 phần còn lại; SL trước nếu cùng nến
function sim(bars, i0, side, stop, tp1R, tp2R) {
  const entry = bars[i0].o * (1 + side * SLIP);
  const r = Math.abs(entry - stop);
  if (side > 0 ? stop >= entry : stop <= entry) return null;
  const tp1 = entry + side * tp1R * r, tp2 = entry + side * tp2R * r;
  const riskPct = r / entry;
  let half = false, sl = stop, gross = 0;
  for (let i = i0; i < Math.min(bars.length, i0 + 7 * 96); i++) {
    const b = bars[i];
    const hitSl = side > 0 ? b.l <= sl : b.h >= sl;
    if (hitSl) { const px = sl * (1 - side * SLIP); gross += (half ? 0.5 : 1) * side * (px - entry) / r; return { R: gross - fees(riskPct), G: gross, riskPct, t: bars[i0].t }; }
    if (!half && (side > 0 ? b.h >= tp1 : b.l <= tp1)) { gross += 0.5 * tp1R; half = true; sl = entry; }
    if (half && (side > 0 ? b.h >= tp2 : b.l <= tp2)) { gross += 0.5 * tp2R; return { R: gross - fees(riskPct), G: gross, riskPct, t: bars[i0].t }; }
  }
  const last = bars[Math.min(bars.length, i0 + 7 * 96) - 1];
  gross += (half ? 0.5 : 1) * side * (last.c - entry) / r;
  return { R: gross - fees(riskPct), G: gross, riskPct, t: bars[i0].t };
}
const fees = (riskPct) => (2 * FEE) / riskPct; // phí 2 chiều quy ra R

const btc1h = load("BTC", "1h"); const btcTrend = dailyTrendFn(btc1h);
const btcIdx = new Map(btc1h.map((b, i) => [b.t, i]));
const base = [], snip = [];
for (const coin of COINS) {
  const h1 = load(coin, "1h"), m15 = load(coin, "15m");
  const own = coin === "BTC" ? btcTrend : dailyTrendFn(h1);
  const m15Idx = new Map(m15.map((b, i) => [b.t, i]));
  let busyUntil = 0;
  for (let i = 120; i < h1.length - 1; i++) {
    const closeT = h1[i].t + H;
    if (closeT < busyUntil) continue;
    const win = h1.slice(i - 119, i + 1);
    const a = analyse(win);
    const bi = btcIdx.get(h1[i].t);
    const btcBars = bi !== undefined ? btc1h.slice(Math.max(0, bi - 9), bi + 1) : undefined;
    for (const s of a.setups) {
      if (s.state !== "triggered") continue;
      const d = evaluateSetup(s, { coin, timeframe: "1H", btcDaily: btcTrend(closeT), ownDaily: own(closeT), equity: 50, peakEquity: 50, lastBarTime: a.lastBarTime, livePrice: s.entry, now: closeT, btc1hBars: btcBars });
      if (!d.accepted) continue;
      // Baseline: vào ngay lệnh 1H như bot đang gửi (TP 0.9R / 1.85R)
      const j0 = m15Idx.get(closeT);
      if (j0 === undefined) break;
      const b1 = sim(m15, j0, s.side, s.stop, 0.9, 1.85); if (b1) base.push({ ...b1, coin, style: s.style });
      // Sniper: radar 90 phút sau khi nến 1H đóng
      sniperRadar.set(coin, { coin, side: s.side, breakoutTime: closeT, breakoutPrice: s.entry, brokenLevel: s.level,
        waveHigh: Math.max(...win.slice(-12).map((b) => b.h)), waveLow: Math.min(...win.slice(-12).map((b) => b.l)), atr1h: 0, expiresAt: closeT + 90 * 60_000 });
      for (let k = j0; k < j0 + 8 && k < m15.length - 1; k++) {
        const now = m15[k].t + M15;
        const sig = evaluate15mSniper(coin, m15.slice(Math.max(0, k - 29), k + 1), now);
        if (sig?.triggered) { const r = sim(m15, k + 1, sig.side, sig.stop, 1.5, 3.0); if (r) snip.push({ ...r, coin, style: s.style, sess: getTradingSessionInfo(new Date(now)).session, abs: detectVolumeAbsorption(m15.slice(Math.max(0,k-21),k+1)).isAbsorption }); break; }
        if (!sniperRadar.has(coin)) break;
      }
      sniperRadar.delete(coin);
      busyUntil = closeT + 4 * H;
      break;
    }
  }
  process.stderr.write(`${coin} base=${base.length} snip=${snip.length}\n`);
}
const st = (xs) => { const n = xs.length; if (!n) return "n=0"; const m = xs.reduce((a, x) => a + x.R, 0) / n; const sd = Math.sqrt(xs.reduce((a, x) => a + (x.R - m) ** 2, 0) / (n - 1)); return `n=${n} avgR=${m.toFixed(3)} t=${(m / sd * Math.sqrt(n)).toFixed(2)} win=${(xs.filter((x) => x.R > 0).length / n * 100).toFixed(0)}%`; };
const byYear = (xs) => [2023, 2024, 2025, 2026].map((y) => `${y}: ${st(xs.filter((x) => new Date(x.t).getUTCFullYear() === y))}`).join(" | ");
console.log("BASELINE 1H vào ngay:", st(base)); console.log("  ", byYear(base));
console.log("SNIPER 15m:", st(snip)); console.log("  ", byYear(snip));
for (const [lo, hi] of [[0.004, 0.006], [0.006, 0.01], [0.01, 0.015], [0.015, 0.025]]) console.log(`  SL ${lo * 100}-${hi * 100}%:`, st(snip.filter((x) => x.riskPct >= lo && x.riskPct < hi)));
for (const sty of ["bos", "double_top_bottom", "pinbar_reversal"]) console.log(`  ${sty}: base ${st(base.filter((x) => x.style === sty))} | snip ${st(snip.filter((x) => x.style === sty))}`);
const usd = snip.reduce((a, x) => a + x.R * 4, 0); console.log(`Sniper tổng net với 4$/lệnh: ${usd.toFixed(0)}$ qua ${snip.length} lệnh`);

const gst=(xs)=>{const n=xs.length;return `grossR=${(xs.reduce((a,x)=>a+x.G,0)/n).toFixed(3)}`};
console.log("SNIPER chưa trừ phí:", gst(snip), "| baseline chưa trừ phí:", gst(base));
for (const se of ["London","New York","Asian","Off-hours"]) console.log("  phiên", se, st(snip.filter(x=>x.sess===se)));
console.log("  có cá mập hấp thụ:", st(snip.filter(x=>x.abs)), "| không:", st(snip.filter(x=>!x.abs)));
