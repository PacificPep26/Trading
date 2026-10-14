// Backtest kèo "Toàn cảnh" bằng đúng code live: pickCoin (lib/overview.ts), dữ liệu đầu vào dựng như telegram-alerts.ts
// (4H 120 / 1H 100 / 15m 300 nến đã đóng, BTC 1H 30 nến gồm nến đang chạy, trend ngày EMA50, chặn 6 giờ/coin).
// 2025–2026, phí 0 (giao dịch tay), trượt 0.02%/chiều cho lệnh Market và SL, funding 0.01%/8h. 2.5$/lệnh.
// Chạy: node --experimental-strip-types --no-warnings service/scripts/overview_study.mjs
import fs from "node:fs";
import { pickCoin } from "../../lib/overview.ts";

const H = 3_600_000, M15 = 900_000, DAY = 86_400_000;
const SLIP = 0.0002, FUND_8H = 0.0001, USD = 2.5, MAX_BARS = 192; // giữ tối đa 48 giờ
const START = Date.UTC(2025, 0, 1);
const COINS = ["BTC","ETH","SOL","HYPE","XRP","DOGE","BNB","ADA","AVAX","LINK","DOT","LTC","SUI","ARB","OP","NEAR","APT","INJ","TIA","1000PEPE","WIF"];
const load = (c, tf) => fs.readFileSync(new URL(`../../data/crypto/${c}USDT-PERP_${tf}.csv`, import.meta.url), "utf8").trim().split("\n").slice(1)
  .map((l) => { const r = l.split(","); return { t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5], closed: true }; });

// Như getDailyData: EMA50 trên nến ngày UTC đã đóng; trend(t) dùng các ngày đóng trước t
function dailyTrendFn(h1) {
  const days = new Map();
  for (const b of h1) { const d = Math.floor(b.t / DAY) * DAY; const x = days.get(d); if (!x) days.set(d, { t: d, c: b.c }); else x.c = b.c; }
  const arr = [...days.values()]; let ema = arr[0].c; const tr = new Map(); let n = 0;
  for (const d of arr) { ema += (2 / 51) * (d.c - ema); n++; tr.set(d.t + DAY, n >= 60 ? (d.c > ema ? 1 : -1) : 0); }
  return (t) => tr.get(Math.floor(t / DAY) * DAY) ?? 0;
}
function resample(bars, step) {
  const out = [];
  for (const b of bars) {
    const t = Math.floor(b.t / step) * step, x = out.at(-1);
    if (x && x.t === t) { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; x.v += b.v; }
    else out.push({ ...b, t });
  }
  return out;
}
// Index của nến cuối có t < tEnd (tất cả nến trước đó đã đóng tại thời điểm tEnd nếu cộng đủ độ dài nến)
const lastBefore = (arr, tEnd) => { let lo = 0, hi = arr.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t < tEnd) { k = m; lo = m + 1; } else hi = m - 1; } return k; };

// Thoát trên nến 15m: SL trước nếu cùng nến chạm cả hai; hết 48 giờ thì đóng ở giá đóng cửa
function exitR(m15, i0, side, entry, stop, tp, slipIn) {
  const r = Math.abs(entry - stop), riskPct = r / entry;
  const fill = entry * (1 + side * slipIn);
  for (let i = i0; i < Math.min(m15.length, i0 + MAX_BARS); i++) {
    const b = m15[i];
    const hold = (i - i0 + 1) * M15;
    const cost = (FUND_8H * hold) / (8 * H) / riskPct;
    if (side > 0 ? b.l <= stop : b.h >= stop) return side * (stop * (1 - side * SLIP) - fill) / r - cost;
    if (side > 0 ? b.h >= tp : b.l <= tp) return side * (tp - fill) / r - cost;
  }
  const last = m15[Math.min(m15.length, i0 + MAX_BARS) - 1];
  return side * (last.c - fill) / r - (FUND_8H * MAX_BARS * M15) / (8 * H) / riskPct;
}

const btc1hAll = load("BTC", "1h"), btc15 = load("BTC", "15m");
const btcTrend = dailyTrendFn(btc1hAll);
const trades = [], rand = [];
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

for (const coin of COINS) {
  const h1All = load(coin, "1h"), m15 = load(coin, "15m"), h4All = resample(h1All, 4 * H);
  const own = coin === "BTC" ? btcTrend : dailyTrendFn(h1All);
  let quietUntil = 0;
  for (let k = 300; k < m15.length - 1; k++) {
    const now = m15[k].t + M15; // thời điểm quét: ngay khi nến 15m k vừa đóng
    if (now < START || now < quietUntil) continue;
    const i4 = lastBefore(h4All, now - 4 * H + 1), i1 = lastBefore(h1All, now - H + 1);
    if (i4 < 30 || i1 < 30) continue;
    const ib = lastBefore(btc1hAll, now - H + 1);
    // BTC 1H như API live: 29 nến đã đóng + nến đang chạy dựng từ các nến 15m đã đóng trong giờ hiện tại
    const btcH1 = btc1hAll.slice(Math.max(0, ib - 28), ib + 1);
    const hourStart = Math.floor(now / H) * H;
    const ie = lastBefore(btc15, now - M15 + 1), partial = [];
    for (let q = ie; q >= 0 && btc15[q].t >= hourStart; q--) partial.unshift(btc15[q]); // nến 15m đã đóng trong giờ hiện tại
    if (partial.length) btcH1.push({ t: hourStart, o: partial[0].o, h: Math.max(...partial.map((b) => b.h)), l: Math.min(...partial.map((b) => b.l)), c: partial.at(-1).c, v: 0, closed: false });
    const p = pickCoin(coin, {
      own: own(now), btc: btcTrend(now),
      h4: h4All.slice(Math.max(0, i4 - 118), i4 + 1), h1: h1All.slice(Math.max(0, i1 - 98), i1 + 1), m15: m15.slice(k - 298, k + 1), btcH1,
    }, 4);
    if (!p) continue;
    quietUntil = now + 6 * H;
    let j = k + 1, entry = p.entry, slipIn = 0;
    if (p.orderType === "MARKET") { entry = m15[j].o; slipIn = SLIP; }
    else {
      // Limit chờ hồi: khớp nếu giá chạm entry trong 4 nến 15m, không thì bỏ
      while (j < k + 5 && j < m15.length && !(p.side > 0 ? m15[j].l <= entry : m15[j].h >= entry)) j++;
      if (j >= k + 5 || j >= m15.length) { trades.push({ coin, t: now, side: p.side, score: p.score, type: p.orderType, filled: false }); continue; }
    }
    if (p.side > 0 ? entry <= p.stop || entry >= p.tp : entry >= p.stop || entry <= p.tp) continue; // giá mở đã vượt SL/TP
    const R = exitR(m15, j, p.side, entry, p.stop, p.tp, slipIn);
    trades.push({ coin, t: now, side: p.side, score: p.score, type: p.orderType, filled: true, R, rr: p.rr });
    // Đối chứng: cùng coin, cùng năm, cùng chiều, cùng khoảng cách SL/TP theo %, vào Market ở thời điểm ngẫu nhiên
    const yr = new Date(now).getUTCFullYear();
    const lo = lastBefore(m15, Math.max(START, Date.UTC(yr, 0, 1))) + 1, hi = lastBefore(m15, Date.UTC(yr + 1, 0, 1)) - MAX_BARS;
    if (hi > lo) {
      const q = lo + Math.floor(rnd() * (hi - lo)), e0 = m15[q].o;
      const sp = Math.abs(p.entry - p.stop) / p.entry, tp = Math.abs(p.tp - p.entry) / p.entry;
      rand.push({ t: m15[q].t, R: exitR(m15, q, p.side, e0, e0 * (1 - p.side * sp), e0 * (1 + p.side * tp), SLIP) });
    }
  }
  process.stderr.write(`${coin}: ${trades.filter((x) => x.coin === coin && x.filled).length} lệnh\n`);
}

function st(xs) {
  const n = xs.length; if (n < 2) return `n=${n}`;
  const rs = xs.map((x) => x.R), m = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  let eq = 0, peak = 0, dd = 0, run = 0, worst = 0;
  for (const x of [...xs].sort((a, b) => a.t - b.t)) { eq += x.R * USD; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); run = x.R < 0 ? run + 1 : 0; worst = Math.max(worst, run); }
  return `n=${String(n).padStart(4)}  thắng ${(rs.filter((r) => r > 0).length / n * 100).toFixed(1).padStart(4)}%  TB ${m >= 0 ? "+" : ""}${m.toFixed(3)}R  t=${(m / (sd / Math.sqrt(n))).toFixed(2).padStart(5)}  tổng ${(eq >= 0 ? "+" : "") + eq.toFixed(0)}$  sụt ${dd.toFixed(0)}$  thua liền ${worst}`;
}
const yr = (y) => (x) => new Date(x.t).getUTCFullYear() === y;
const done = trades.filter((x) => x.filled);
const limits = trades.filter((x) => x.type === "LIMIT_PULLBACK");
console.log(`Kèo Toàn cảnh 2025–2026, phí 0, ${USD}$/lệnh, ${COINS.length} coin`);
console.log("Tất cả          ", st(done));
for (const y of [2025, 2026]) console.log(`  ${y}          `, st(done.filter(yr(y))));
console.log("Điểm 4          ", st(done.filter((x) => x.score === 4)));
console.log("Điểm ≥5         ", st(done.filter((x) => x.score >= 5)));
console.log("Market          ", st(done.filter((x) => x.type === "MARKET")));
console.log("Limit chờ hồi   ", st(done.filter((x) => x.type === "LIMIT_PULLBACK")), ` (khớp ${limits.filter((x) => x.filled).length}/${limits.length})`);
console.log("LONG            ", st(done.filter((x) => x.side > 0)));
console.log("SHORT           ", st(done.filter((x) => x.side < 0)));
console.log("Đối chứng ngẫu nhiên", st(rand));
for (const y of [2025, 2026]) console.log(`  ${y}          `, st(rand.filter(yr(y))));
const months = (Math.max(...done.map((x) => x.t)) - START) / (30 * DAY);
console.log(`Tần suất: ${(done.length / months).toFixed(1)} lệnh/tháng`);
