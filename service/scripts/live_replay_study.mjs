// Chạy lại ĐÚNG code live trên dữ liệu 2025–2026 để đối chiếu với các script Python (fee0_shootout.py):
//  A. Hai đỉnh/đáy 4H: analyse → evaluateSetup (mọi bộ lọc live) → isLiveEligible → vào ở giá mở nến 4H kế
//     → SL trailing bằng trailingStop() sau mỗi nến 4H đóng. So 2 kiểu: không giới hạn thời gian (live) / tối đa 60 nến (backtest).
//  B. 📌 Limit dưới đáy 1H: restingLimit → addLimit → stepLimits (ghi paper ra file tạm như live), chỉ LONG như live.
// Phí 0 (giao dịch tay), trượt 0.04% khứ hồi + funding 0.01%/8h cho A (B đã có trượt trong resting-limit.ts). 2.5$/lệnh.
// Chạy: node --experimental-strip-types --no-warnings service/scripts/live_replay_study.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyse, restingLimit, ictSweepShort } from "../../lib/patterns.ts";
import { evaluateSetup } from "../../lib/decision-engine.ts";
import { isLiveEligible, trailingStop } from "../../lib/trading-policy.ts";
import { addLimit, stepLimits, loadLimits } from "../../lib/resting-limit.ts";

const H = 3_600_000, H4 = 4 * H, DAY = 86_400_000;
const START = Date.UTC(2025, 0, 1), COST = 0.0004, FUND_8H = 0.0001, USD = 2.5;
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
const A = { live: [], cap60: [] }, rejects = {};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "replay-"));
const B = [], C = [];

for (const coin of COINS) {
  const h1 = load(coin), h4 = resample(h1, H4), own = coin === "BTC" ? btcTrend : dailyTrendFn(h1), fund = loadFunding(coin);

  // A. Hai đỉnh/đáy 4H
  let busyUntil = 0;
  for (let i = 300; i < h4.length - 1; i++) {
    const now = h4[i].t + H4 + 60_000; // lượt quét ngay sau khi nến 4H đóng
    if (now < START || h4[i].t < busyUntil) continue;
    const a = analyse(h4.slice(i - 299, i + 1));
    const bi = btcIdx.get(Math.floor(now / H) * H - H);
    const btcBars = bi !== undefined ? btc1h.slice(bi - 1, bi + 1) : undefined;
    const fi = lastBefore(fund, now), fundingRate = fi >= 0 ? fund[fi][1] : undefined;
    for (const s of a.setups) {
      if (s.state !== "triggered" || s.style !== "double_top_bottom") continue;
      const btc = btcTrend(now), ownD = own(now);
      const d = evaluateSetup(s, { coin, timeframe: "4H", btcDaily: btc, ownDaily: ownD, equity: 100, peakEquity: 100,
        lastBarTime: a.lastBarTime, livePrice: h4[i + 1].o, btc1hBars: btcBars, fundingRate, now });
      if (!d.accepted) { rejects[d.reason] = (rejects[d.reason] ?? 0) + 1; continue; }
      if (!isLiveEligible(s.style, s.side, "4H", ownD, btc, s.volumeRatio ?? 1, new Date(now))) { rejects.NOT_LIVE_ELIGIBLE = (rejects.NOT_LIVE_ELIGIBLE ?? 0) + 1; continue; }
      const side = s.side, entry = h4[i + 1].o, risk0 = Math.abs(entry - s.stop) / entry;
      if (side > 0 ? s.stop >= entry : s.stop <= entry) continue;
      for (const [name, maxBars] of [["live", Infinity], ["cap60", 60]]) {
        let stop = s.stop, out = null;
        for (let k = i + 1; k < h4.length; k++) {
          const b = h4[k];
          if (side > 0 ? b.l <= stop : b.h >= stop) { out = { px: (side > 0 ? b.o < stop : b.o > stop) ? b.o : stop, k }; break; }
          if (k - i >= maxBars) { out = { px: b.c, k }; break; }
          stop = trailingStop(h4.slice(Math.max(0, k - 119), k + 1), side, h4[i + 1].t, stop);
        }
        if (!out) continue;
        const held = (out.k - i) * 4;
        const r = (side * (out.px / entry - 1) - COST - FUND_8H * held / 8) / risk0;
        A[name].push({ t: h4[i + 1].t, r, held });
        if (name === "live") busyUntil = h4[out.k].t + H4;
      }
      break;
    }
  }

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
  }
  for (const x of loadLimits(file)) if (x.status === "closed" && x.r !== undefined) B.push({ t: x.createdBar, r: x.r });
  for (const x of loadLimits(fileC)) if (x.status === "closed" && x.r !== undefined) C.push({ t: x.createdBar, r: x.r });
  process.stderr.write(`${coin}: 4H ${A.live.length} · 📌 ${B.length}\n`);
}

function st(xs) {
  const n = xs.length; if (n < 2) return `n=${n}`;
  const rs = xs.map((x) => x.r), m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  return `n=${String(n).padStart(4)}  thắng ${(rs.filter((r) => r > 0).length / n * 100).toFixed(0)}%  TB ${m >= 0 ? "+" : ""}${m.toFixed(3)}R  t=${(m / (sd / Math.sqrt(n))).toFixed(2)}  tổng ${(m * n * USD >= 0 ? "+" : "") + (m * n * USD).toFixed(0)}$`;
}
const yr = (y) => (x) => new Date(x.t).getUTCFullYear() === y;
for (const [name, xs] of [["A. Hai đỉnh/đáy 4H, trailing (live, không giới hạn giờ)", A.live], ["A. Hai đỉnh/đáy 4H, trailing, tối đa 60 nến (như backtest)", A.cap60], ["B. 📌 Limit dưới đáy 1H (LONG)", B], ["C. 🎯 ICT quét đỉnh hôm qua → SHORT 1H", C]]) {
  console.log(name);
  for (const y of [2025, 2026]) console.log(`  ${y}: ${st(xs.filter(yr(y)))}`);
  console.log(`  25–26: ${st(xs)}`);
}
if (A.live.length) console.log(`A giữ lệnh TB ${(A.live.reduce((a, x) => a + x.held, 0) / A.live.length / 24).toFixed(1)} ngày, lâu nhất ${(Math.max(...A.live.map((x) => x.held)) / 24).toFixed(0)} ngày`);
console.log("Lý do live loại kèo hai đỉnh/đáy 4H:", rejects);
fs.rmSync(tmp, { recursive: true, force: true });
