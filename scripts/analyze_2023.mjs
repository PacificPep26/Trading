import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';
import { backtestSymbol } from './backtest_1year.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache_1year');
const SYMBOLS = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'LINK-USDT-SWAP', 'NEAR-USDT-SWAP'];

function loadRegimeMap(instId) {
  const f = path.join(CACHE_DIR, `${instId}_regime_daily.json`);
  if (!fs.existsSync(f)) return null;
  const labels = JSON.parse(fs.readFileSync(f, 'utf8'));
  const map = new Map();
  for (const l of labels) map.set(l.date, l.phase);
  return map;
}
function regimeAt(map, ts) {
  if (!map) return 'UNKNOWN';
  return map.get(new Date(ts).toISOString().slice(0, 10)) || 'UNKNOWN';
}
function computeStats(trades) {
  if (trades.length === 0) return null;
  const wins = trades.filter(t => t.netR > 0);
  const losses = trades.filter(t => t.netR < 0);
  const totalR = trades.reduce((s, t) => s + t.netR, 0);
  const gW = wins.reduce((s, t) => s + t.netR, 0);
  const gL = Math.abs(losses.reduce((s, t) => s + t.netR, 0));
  const pf = gL > 0 ? (gW / gL) : (gW > 0 ? Infinity : 0);
  return { count: trades.length, winRate: (wins.length / trades.length * 100).toFixed(1) + '%', pf: isFinite(pf) ? pf.toFixed(2) : '∞', totalR: (totalR >= 0 ? '+' : '') + totalR.toFixed(2) + 'R' };
}

const startTs = new Date('2023-01-01T00:00:00Z').getTime();
const endTs = new Date('2023-12-31T23:59:59Z').getTime();
const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json'), 'utf8')).map(normalizeCandle);
const btcH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_4H.json'), 'utf8')).map(normalizeCandle);

const allTagged = [];
for (const instId of SYMBOLS) {
  const regimeMap = loadRegimeMap(instId);
  const trades = await backtestSymbol(instId, btcH1, btcH4, null, startTs, endTs);
  for (const t of trades) allTagged.push({ ...t, symbol: instId.replace('-SWAP', ''), regime: regimeAt(regimeMap, t.entryTime) });
}

const groups = new Map();
for (const t of allTagged) {
  const key = `${t.regime} x ${t.strategy}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(t);
}
const rows = [];
for (const [key, trades] of groups.entries()) {
  const stats = computeStats(trades);
  if (stats) rows.push({ key, ...stats });
}
rows.sort((a, b) => parseFloat(a.totalR) - parseFloat(b.totalR));
console.log('2023 phan nhom theo (giai doan x setup), sap theo Tong R tang dan (te nhat truoc):');
rows.forEach(r => console.log(`  ${r.key.padEnd(45)} ${String(r.count).padEnd(6)} WR:${r.winRate.padEnd(8)} PF:${r.pf.padEnd(6)} ${r.totalR}`));

const byMonth = new Map();
for (const t of allTagged) {
  const m = new Date(t.entryTime).toISOString().slice(0, 7);
  if (!byMonth.has(m)) byMonth.set(m, []);
  byMonth.get(m).push(t);
}
console.log('\n2023 theo thang:');
Array.from(byMonth.keys()).sort().forEach(m => {
  const s = computeStats(byMonth.get(m));
  console.log(`  ${m}: ${String(s.count).padEnd(6)} WR:${s.winRate.padEnd(8)} PF:${s.pf.padEnd(6)} ${s.totalR}`);
});
