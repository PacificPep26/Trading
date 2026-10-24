/**
 * BACKTEST_MULTI_YEAR.MJS
 * Walk-forward test D1 Regime Gate qua nhiều giai đoạn lịch sử khác nhau (không
 * chỉ 1 năm gần nhất 10/2025-10/2026), để xác nhận cải thiện không phải overfit
 * vào đúng 1 sample. Tái dùng backtestSymbol() có sẵn, chỉ truyền startTs/endTs
 * khác nhau cho từng giai đoạn (đã tham số hóa trong backtest_1year.mjs).
 * Xem docs/REGIME_ADAPTIVE_PLAN.md.
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

// Các giai đoạn thị trường crypto khác nhau để walk-forward test (không chọn lọc
// theo kết quả mong muốn - lấy theo mốc năm dương lịch tròn, khách quan)
const PERIODS = [
  { label: '2021 (Bull mạnh)', start: '2021-01-01', end: '2021-12-31' },
  { label: '2022 (Bear mạnh - Luna/FTX sập)', start: '2022-01-01', end: '2022-12-31' },
  { label: '2023 (Tích lũy/Sideway)', start: '2023-01-01', end: '2023-12-31' },
  { label: '2024 (Bull trở lại)', start: '2024-01-01', end: '2024-12-31' },
  { label: '2025 (tới nay)', start: '2025-01-01', end: '2026-10-24' }
];

function computeStats(trades) {
  if (trades.length === 0) return { count: 0, winRate: '-', pf: '-', totalR: '0.00R' };
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

async function runPeriod(period, btcH1, btcH4) {
  const startTs = new Date(period.start + 'T00:00:00Z').getTime();
  const endTs = new Date(period.end + 'T23:59:59Z').getTime();

  const allTrades = [];
  for (const instId of SYMBOLS) {
    const trades = await backtestSymbol(instId, btcH1, btcH4, null, startTs, endTs);
    allTrades.push(...trades);
  }
  return computeStats(allTrades);
}

async function main() {
  console.log('================================================================');
  console.log('🧭 WALK-FORWARD TEST D1 REGIME GATE QUA NHIỀU NĂM (2021-2026)');
  console.log('================================================================\n');

  const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json'), 'utf8')).map(normalizeCandle);
  const btcH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_4H.json'), 'utf8')).map(normalizeCandle);

  console.log('Giai đoạn'.padEnd(35) + 'Lệnh'.padEnd(8) + 'Win Rate'.padEnd(12) + 'PF'.padEnd(8) + 'Tổng R');
  console.log('-'.repeat(75));

  for (const period of PERIODS) {
    const stats = await runPeriod(period, btcH1, btcH4);
    console.log(period.label.padEnd(35) + String(stats.count).padEnd(8) + stats.winRate.padEnd(12) + stats.pf.padEnd(8) + stats.totalR);
  }
  console.log('-'.repeat(75));
}

main().catch(err => console.error(err));
