/**
 * TEST_VARIANTS_MULTI_YEAR.MJS
 * Chạy 4 biến thể (V1 VP, V1 Breaker, V2 VP, V2 Breaker) trên Multi-Year (2021-2026)
 * và 1-Year (10/2025-10/2026) để so sánh chi tiết với Baseline.
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

async function run1Year(config) {
  const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json'), 'utf8')).map(normalizeCandle);
  const btcH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_4H.json'), 'utf8')).map(normalizeCandle);
  const startTs = new Date('2025-10-01T00:00:00Z').getTime();
  const allTrades = [];
  for (const s of WATCHLIST) {
    const trades = await backtestSymbol(s, btcH1, btcH4, config, startTs, Infinity);
    allTrades.push(...trades);
  }
  allTrades.sort((a, b) => (a.entryTime || a.triggerTime || 0) - (b.entryTime || b.triggerTime || 0));
  return computeStats(allTrades);
}

const VARIANTS = [
  {
    name: 'Baseline (Cả 2 TẮT)',
    config: { ...BOT_CONFIG, useVolumeProfile: false, useBreakerBlocks: false }
  },
  {
    name: 'V1 Volume Profile (OR, ALWAYS)',
    config: {
      ...BOT_CONFIG,
      useVolumeProfile: true,
      volumeProfileMode: 'ALWAYS',
      volumeProfileLookback: 50,
      volumeProfileValueAreaPct: 0.70,
      volumeProfileNumBins: 24,
      useBreakerBlocks: false
    }
  },
  {
    name: 'V1 Breaker Block (OR, ADD_ZONES)',
    config: {
      ...BOT_CONFIG,
      useVolumeProfile: false,
      useBreakerBlocks: true,
      breakerBlockMode: 'ADD_ZONES',
      breakerPivotL: 2,
      breakerPivotR: 2
    }
  },
  {
    name: 'V2 Volume Profile (D1 RANGING)',
    config: {
      ...BOT_CONFIG,
      useVolumeProfile: true,
      volumeProfileMode: 'RANGING_ONLY',
      volumeProfileLookback: 50,
      volumeProfileValueAreaPct: 0.70,
      volumeProfileNumBins: 24,
      useBreakerBlocks: false
    }
  },
  {
    name: 'V2 Breaker Block (AND Filter)',
    config: {
      ...BOT_CONFIG,
      useVolumeProfile: false,
      useBreakerBlocks: true,
      breakerBlockMode: 'AND_FILTER',
      breakerPivotL: 2,
      breakerPivotR: 2
    }
  }
];

async function main() {
  console.log('========================================================================================');
  console.log('📊 KIỂM CHỨNG ĐA NĂM 4 BIẾN THỂ VOLUME PROFILE & ICT BREAKER BLOCK (2021-2026)');
  console.log('========================================================================================\n');

  const fullReport = [];

  for (const v of VARIANTS) {
    console.log(`>>> Đang chạy biến thể: ${v.name}...`);
    const t0 = Date.now();
    const stats1Y = await run1Year(v.config);
    const multiRes = await runMultiYearBacktest(v.config);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`    Xong trong ${elapsed}s: 1Y PF=${stats1Y.pf}, 1Y R=${stats1Y.totalR} | Multi PF=${multiRes.overall.pf}, Multi R=${multiRes.overall.totalR}`);

    fullReport.push({
      variant: v.name,
      stats1Y,
      overall: multiRes.overall,
      byPeriod: multiRes.byPeriod
    });
  }

  console.log('\n========================================================================================');
  console.log('📋 BẢNG SO SÁNH TỔNG HỢP 1-NĂM VÀ TOÀN BỘ MULTI-YEAR (2021-2026)');
  console.log('========================================================================================');
  console.log('Biến thể'.padEnd(35) + '1Y Lệnh'.padEnd(10) + '1Y PF'.padEnd(8) + '1Y Tổng R'.padEnd(12) + '1Y DD'.padEnd(10) + 'Multi Lệnh'.padEnd(12) + 'Multi PF'.padEnd(10) + 'Multi R'.padEnd(12) + 'Multi DD');
  console.log('-'.repeat(110));

  for (const r of fullReport) {
    console.log(
      r.variant.padEnd(35) +
      String(r.stats1Y.count).padEnd(10) +
      r.stats1Y.pf.padEnd(8) +
      r.stats1Y.totalR.padEnd(12) +
      r.stats1Y.maxDDR.padEnd(10) +
      String(r.overall.count).padEnd(12) +
      r.overall.pf.padEnd(10) +
      r.overall.totalR.padEnd(12) +
      r.overall.maxDDR
    );
  }

  console.log('\n========================================================================================');
  console.log('📅 CHI TIẾT TỪNG NĂM (2021 -> 2025/2026): PROFIT FACTOR / TỔNG R');
  console.log('========================================================================================');
  let header = 'Biến thể'.padEnd(35);
  for (const p of PERIODS) {
    header += p.label.split(' ')[0].padEnd(16);
  }
  console.log(header);
  console.log('-'.repeat(110));

  for (const r of fullReport) {
    let line = r.variant.padEnd(35);
    for (const bp of r.byPeriod) {
      line += `${bp.stats.pf} (${bp.stats.totalR})`.padEnd(16);
    }
    console.log(line);
  }
  console.log('========================================================================================\n');

  fs.writeFileSync('data/variants_multi_year_results.json', JSON.stringify(fullReport, null, 2), 'utf8');
  console.log('Đã lưu kết quả chi tiết vào data/variants_multi_year_results.json');
}

main().catch(err => console.error(err));

