/**
 * BACKTEST_BY_REGIME.MJS
 * Tái dùng backtestSymbol() có sẵn trong backtest_1year.mjs (không viết lại),
 * chỉ thêm bước gắn nhãn giai đoạn D1 (từ scripts/analyze_regime_history.mjs)
 * cho mỗi lệnh theo ngày vào lệnh, rồi phân nhóm kết quả theo (giai đoạn × setup)
 * để biết setup nào thật sự hợp giai đoạn nào.
 * Xem docs/REGIME_ADAPTIVE_PLAN.md Phần 3.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';
import { backtestSymbol } from './backtest_1year.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache_1year');

const SYMBOLS = [
  'BTC-USDT-SWAP',
  'ETH-USDT-SWAP',
  'SOL-USDT-SWAP',
  'LINK-USDT-SWAP',
  'NEAR-USDT-SWAP'
];

function loadRegimeMap(instId) {
  const f = path.join(CACHE_DIR, `${instId}_regime_daily.json`);
  if (!fs.existsSync(f)) return null;
  const labels = JSON.parse(fs.readFileSync(f, 'utf8'));
  const map = new Map();
  for (const l of labels) map.set(l.date, l.phase);
  return map;
}

function regimeAt(regimeMap, ts) {
  if (!regimeMap) return 'UNKNOWN';
  const date = new Date(ts).toISOString().slice(0, 10);
  return regimeMap.get(date) || 'UNKNOWN';
}

function computeStats(trades) {
  if (trades.length === 0) return null;
  const wins = trades.filter(t => t.netR > 0);
  const losses = trades.filter(t => t.netR < 0);
  const totalR = trades.reduce((s, t) => s + t.netR, 0);
  const grossWinR = wins.reduce((s, t) => s + t.netR, 0);
  const grossLossR = Math.abs(losses.reduce((s, t) => s + t.netR, 0));
  const pf = grossLossR > 0 ? (grossWinR / grossLossR) : (grossWinR > 0 ? Infinity : 0);
  return {
    count: trades.length,
    winRate: (wins.length / trades.length * 100).toFixed(1) + '%',
    pf: isFinite(pf) ? pf.toFixed(2) : '∞',
    totalR: (totalR >= 0 ? '+' : '') + totalR.toFixed(2) + 'R'
  };
}

async function main() {
  console.log('================================================================');
  console.log('🧭 BACKTEST PHÂN NHÓM THEO GIAI ĐOẠN (REGIME) × SETUP - 1 NĂM');
  console.log('================================================================\n');

  const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json'), 'utf8')).map(normalizeCandle);
  const btcH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_4H.json'), 'utf8')).map(normalizeCandle);

  const allTagged = [];
  for (const instId of SYMBOLS) {
    const regimeMap = loadRegimeMap(instId);
    const trades = await backtestSymbol(instId, btcH1, btcH4);
    for (const t of trades) {
      allTagged.push({ ...t, symbol: instId.replace('-SWAP', ''), regime: regimeAt(regimeMap, t.entryTime) });
    }
    console.log(`✅ ${instId}: ${trades.length} lệnh đã gắn nhãn giai đoạn`);
  }

  // Phân nhóm theo (regime, strategy)
  const groups = new Map();
  for (const t of allTagged) {
    const key = `${t.regime} × ${t.strategy}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const rows = [];
  for (const [key, trades] of groups.entries()) {
    const stats = computeStats(trades);
    if (stats) rows.push({ key, ...stats });
  }
  rows.sort((a, b) => b.count - a.count);

  console.log('\n📊 BẢNG KẾT QUẢ THEO (GIAI ĐOẠN × SETUP):');
  console.log('-'.repeat(95));
  console.log('Giai đoạn × Setup'.padEnd(50) + 'Lệnh'.padEnd(8) + 'Win Rate'.padEnd(12) + 'PF'.padEnd(8) + 'Tổng R');
  console.log('-'.repeat(95));
  rows.forEach(r => {
    console.log(r.key.padEnd(50) + String(r.count).padEnd(8) + r.winRate.padEnd(12) + r.pf.padEnd(8) + r.totalR);
  });
  console.log('-'.repeat(95));

  // Tổng hợp riêng theo giai đoạn (gộp mọi setup)
  const byRegimeOnly = new Map();
  for (const t of allTagged) {
    if (!byRegimeOnly.has(t.regime)) byRegimeOnly.set(t.regime, []);
    byRegimeOnly.get(t.regime).push(t);
  }
  console.log('\n📊 TỔNG HỢP RIÊNG THEO GIAI ĐOẠN (GỘP MỌI SETUP):');
  console.log('-'.repeat(70));
  for (const [regime, trades] of byRegimeOnly.entries()) {
    const stats = computeStats(trades);
    console.log(`${regime.padEnd(20)} ${String(stats.count).padEnd(8)} Win Rate: ${stats.winRate.padEnd(10)} PF: ${stats.pf.padEnd(8)} Tổng R: ${stats.totalR}`);
  }
}

main().catch(err => console.error(err));
