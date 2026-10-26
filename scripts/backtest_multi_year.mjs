/**
 * BACKTEST_MULTI_YEAR.MJS
 * Walk-forward test D1 Regime Gate qua nhiều giai đoạn lịch sử khác nhau (không
 * chỉ 1 năm gần nhất 10/2025-10/2026), để xác nhận cải thiện không phải overfit
 * vào đúng 1 sample. Tái dùng backtestSymbol() có sẵn, hỗ trợ customConfig để
 * kiểm nghiệm Volume Profile, ICT Breaker Block, và Parameter Sweeps.
 * Xem docs/REGIME_ADAPTIVE_PLAN.md & docs/strategies/VOLUME_PROFILE_BREAKER.md.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';
import { backtestSymbol } from './backtest_1year.mjs';
import { BOT_CONFIG } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache_1year');

export const SYMBOLS = [
  'BTC-USDT-SWAP',
  'ETH-USDT-SWAP',
  'SOL-USDT-SWAP',
  'LINK-USDT-SWAP',
  'NEAR-USDT-SWAP'
];

export const PERIODS = [
  { label: '2021 (Bull mạnh)', start: '2021-01-01', end: '2021-12-31' },
  { label: '2022 (Bear mạnh - Luna/FTX sập)', start: '2022-01-01', end: '2022-12-31' },
  { label: '2023 (Tích lũy/Sideway)', start: '2023-01-01', end: '2023-12-31' },
  { label: '2024 (Bull trở lại)', start: '2024-01-01', end: '2024-12-31' },
  { label: '2025 (tới nay)', start: '2025-01-01', end: '2026-10-24' }
];

export function computeStats(trades) {
  if (trades.length === 0) return { count: 0, winRate: '-', pf: '-', totalR: '0.00R', netR: 0, maxDDR: '0.00R', maxDDVal: 0 };
  const wins = trades.filter(t => t.netR > 0);
  const losses = trades.filter(t => t.netR < 0);
  const totalR = trades.reduce((s, t) => s + t.netR, 0);
  const grossWinR = wins.reduce((s, t) => s + t.netR, 0);
  const grossLossR = Math.abs(losses.reduce((s, t) => s + t.netR, 0));
  const pf = grossLossR > 0 ? (grossWinR / grossLossR) : (grossWinR > 0 ? Infinity : 0);

  let peak = 0;
  let running = 0;
  let maxDD = 0;
  for (const t of trades) {
    running += t.netR;
    if (running > peak) peak = running;
    const dd = running - peak;
    if (dd < maxDD) maxDD = dd;
  }

  return {
    count: trades.length,
    winRate: (wins.length / trades.length * 100).toFixed(1) + '%',
    pf: isFinite(pf) ? pf.toFixed(2) : '∞',
    pfVal: isFinite(pf) ? pf : 999,
    totalR: (totalR >= 0 ? '+' : '') + totalR.toFixed(2) + 'R',
    netR: totalR,
    maxDDR: maxDD.toFixed(2) + 'R',
    maxDDVal: maxDD
  };
}

export async function runPeriod(period, btcH1, btcH4, customConfig = null) {
  const startTs = new Date(period.start + 'T00:00:00Z').getTime();
  const endTs = new Date(period.end + 'T23:59:59Z').getTime();

  const allTrades = [];
  for (const instId of SYMBOLS) {
    const trades = await backtestSymbol(instId, btcH1, btcH4, customConfig, startTs, endTs);
    allTrades.push(...trades);
  }
  // Sắp xếp lệnh theo triggerTime để tính đúng timeline và Max Drawdown tổng
  allTrades.sort((a, b) => (a.entryTime || a.triggerTime || 0) - (b.entryTime || b.triggerTime || 0));
  return {
    period,
    stats: computeStats(allTrades),
    trades: allTrades
  };
}

export async function runMultiYearBacktest(customConfig = null) {
  const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json'), 'utf8')).map(normalizeCandle);
  const btcH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_4H.json'), 'utf8')).map(normalizeCandle);

  const results = [];
  const allYearTrades = [];

  for (const period of PERIODS) {
    const res = await runPeriod(period, btcH1, btcH4, customConfig);
    results.push(res);
    allYearTrades.push(...res.trades);
  }

  allYearTrades.sort((a, b) => (a.entryTime || a.triggerTime || 0) - (b.entryTime || b.triggerTime || 0));
  const fullStats = computeStats(allYearTrades);

  return {
    byPeriod: results,
    overall: fullStats,
    allTrades: allYearTrades
  };
}

async function main() {
  console.log('================================================================');
  console.log('🧭 WALK-FORWARD TEST D1 REGIME GATE QUA NHIỀU NĂM (2021-2026)');
  console.log('================================================================\n');

  const { byPeriod, overall } = await runMultiYearBacktest();

  console.log('Giai đoạn'.padEnd(35) + 'Lệnh'.padEnd(8) + 'Win Rate'.padEnd(12) + 'PF'.padEnd(8) + 'Tổng R'.padEnd(12) + 'Max DD');
  console.log('-'.repeat(85));

  for (const r of byPeriod) {
    console.log(
      r.period.label.padEnd(35) +
      String(r.stats.count).padEnd(8) +
      r.stats.winRate.padEnd(12) +
      r.stats.pf.padEnd(8) +
      r.stats.totalR.padEnd(12) +
      r.stats.maxDDR
    );
  }
  console.log('-'.repeat(85));
  console.log(
    'TỔNG TOÀN BỘ (2021-2026)'.padEnd(35) +
    String(overall.count).padEnd(8) +
    overall.winRate.padEnd(12) +
    overall.pf.padEnd(8) +
    overall.totalR.padEnd(12) +
    overall.maxDDR
  );
  console.log('================================================================\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch(err => console.error(err));
}
