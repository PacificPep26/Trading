/**
 * SWEEP_VP_BREAKER_PARAMS.MJS
 * Quét tham số toàn diện cho Volume Profile và ICT Breaker Block:
 * - Volume Profile: volumeProfileLookback ∈ {20, 35, 50, 80}, valueAreaPct ∈ {0.60, 0.70, 0.80}
 * - Breaker Block: pivotL/pivotR ∈ {1, 2, 3} (cả đối xứng và bất đối xứng)
 * - Đánh giá trên cả 1-năm (10/2025-10/2026) và Multi-Year (2021-2026).
 */

import { runMultiYearBacktest, computeStats, PERIODS } from './backtest_multi_year.mjs';
import { backtestSymbol } from './backtest_1year.mjs';
import { BOT_CONFIG, UNIVERSE_CONFIG } from '../src/config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache_1year');
const WATCHLIST = UNIVERSE_CONFIG.premierWatchlist.map(s => s.endsWith('-SWAP') ? s : s + '-SWAP');

const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json'), 'utf8')).map(normalizeCandle);
const btcH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_4H.json'), 'utf8')).map(normalizeCandle);
const start1YTs = new Date('2025-10-01T00:00:00Z').getTime();

async function run1Year(cfg) {
  const allTrades = [];
  for (const s of WATCHLIST) {
    const trades = await backtestSymbol(s, btcH1, btcH4, cfg, start1YTs, Infinity);
    allTrades.push(...trades);
  }
  allTrades.sort((a, b) => (a.entryTime || a.triggerTime || 0) - (b.entryTime || b.triggerTime || 0));
  return computeStats(allTrades);
}

export async function runVpSweep() {
  console.log('\n========================================================================================');
  console.log('🔍 BẮT ĐẦU QUÉT THAM SỐ VOLUME PROFILE: Lookback × ValueAreaPct');
  console.log('========================================================================================');

  const lookbacks = [20, 35, 50, 80];
  const vaPcts = [0.60, 0.70, 0.80];
  const modes = ['RANGING_ONLY', 'ALWAYS'];

  const results = [];

  for (const mode of modes) {
    console.log(`\n--- Chế độ: ${mode === 'RANGING_ONLY' ? 'V2 (D1 RANGING Gate)' : 'V1 (ALWAYS / OR)'} ---`);
    for (const lb of lookbacks) {
      for (const va of vaPcts) {
        const cfg = {
          ...BOT_CONFIG,
          useVolumeProfile: true,
          volumeProfileMode: mode,
          volumeProfileLookback: lb,
          volumeProfileValueAreaPct: va,
          volumeProfileNumBins: 24,
          useBreakerBlocks: false
        };

        const stats1Y = await run1Year(cfg);
        const multiRes = await runMultiYearBacktest(cfg);

        const row = {
          tech: 'Volume Profile',
          mode,
          lookback: lb,
          vaPct: va,
          stats1Y,
          overall: multiRes.overall,
          byPeriod: multiRes.byPeriod
        };
        results.push(row);

        console.log(
          `Lookback=${String(lb).padEnd(4)} VA=${va.toFixed(2)} | ` +
          `1Y: Lệnh=${String(stats1Y.count).padEnd(4)} PF=${stats1Y.pf.padEnd(5)} R=${stats1Y.totalR.padEnd(8)} DD=${stats1Y.maxDDR.padEnd(8)} | ` +
          `Multi: Lệnh=${String(multiRes.overall.count).padEnd(5)} PF=${multiRes.overall.pf.padEnd(5)} R=${multiRes.overall.totalR.padEnd(9)} DD=${multiRes.overall.maxDDR}`
        );
      }
    }
  }

  return results;
}

export async function runBreakerSweep() {
  console.log('\n========================================================================================');
  console.log('🔍 BẮT ĐẦU QUÉT THAM SỐ ICT BREAKER BLOCK: PivotL / PivotR');
  console.log('========================================================================================');

  const pivotPairs = [
    { pL: 1, pR: 1 },
    { pL: 2, pR: 2 },
    { pL: 3, pR: 3 },
    { pL: 1, pR: 2 },
    { pL: 2, pR: 1 },
    { pL: 2, pR: 3 },
    { pL: 3, pR: 2 }
  ];
  const modes = ['AND_FILTER', 'ADD_ZONES'];

  const results = [];

  for (const mode of modes) {
    console.log(`\n--- Chế độ: ${mode === 'AND_FILTER' ? 'V2 (AND Filter)' : 'V1 (ADD_ZONES / OR)'} ---`);
    for (const pair of pivotPairs) {
      const cfg = {
        ...BOT_CONFIG,
        useVolumeProfile: false,
        useBreakerBlocks: true,
        breakerBlockMode: mode,
        breakerPivotL: pair.pL,
        breakerPivotR: pair.pR
      };

      const stats1Y = await run1Year(cfg);
      const multiRes = await runMultiYearBacktest(cfg);

      const row = {
        tech: 'Breaker Block',
        mode,
        pivotL: pair.pL,
        pivotR: pair.pR,
        stats1Y,
        overall: multiRes.overall,
        byPeriod: multiRes.byPeriod
      };
      results.push(row);

      console.log(
        `Pivot L=${pair.pL} R=${pair.pR} | ` +
        `1Y: Lệnh=${String(stats1Y.count).padEnd(4)} PF=${stats1Y.pf.padEnd(5)} R=${stats1Y.totalR.padEnd(8)} DD=${stats1Y.maxDDR.padEnd(8)} | ` +
        `Multi: Lệnh=${String(multiRes.overall.count).padEnd(5)} PF=${multiRes.overall.pf.padEnd(5)} R=${multiRes.overall.totalR.padEnd(9)} DD=${multiRes.overall.maxDDR}`
      );
    }
  }

  return results;
}

async function main() {
  console.log('========================================================================================');
  console.log('🚀 THỰC THI PARAMETER SWEEP TOÀN DIỆN CHO VOLUME PROFILE & BREAKER BLOCK');
  console.log('Baseline tham chiếu:');
  console.log('  1-Năm: PF 1.52 | +62.92R | DD -15.55R | 238 lệnh');
  console.log('  Multi: PF 1.10 | +50.45R | DD -53.38R | 922 lệnh (2021: 0.95, 2022: 1.37, 2023: 0.70, 2024: 1.08, 2025: 1.36)');
  console.log('========================================================================================');

  const vpResults = await runVpSweep();
  const breakerResults = await runBreakerSweep();

  const allSweepResults = {
    baseline1Y: { count: 238, pf: '1.52', totalR: '+62.92R', maxDDR: '-15.55R' },
    baselineMulti: { count: 922, pf: '1.10', totalR: '+50.45R', maxDDR: '-53.38R' },
    vpResults,
    breakerResults
  };

  fs.writeFileSync('data/parameter_sweep_results.json', JSON.stringify(allSweepResults, null, 2), 'utf8');
  console.log('\n✅ Đã lưu toàn bộ kết quả sweep vào data/parameter_sweep_results.json');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch(err => console.error(err));
}

