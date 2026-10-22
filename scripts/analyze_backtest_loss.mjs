import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';
import { evaluateMarket } from '../src/engine.js';
import { BOT_CONFIG } from '../src/config.js';
import { backtestSymbol, calculateMetrics } from './backtest_1year.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache_1year');

async function analyze() {
  const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json'), 'utf8')).map(normalizeCandle);
  const btcH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_4H.json'), 'utf8')).map(normalizeCandle);

  const symbols = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'LINK-USDT-SWAP', 'NEAR-USDT-SWAP'];
  let allTrades = [];

  for (const s of symbols) {
    const trades = await backtestSymbol(s, btcH1, btcH4);
    allTrades.push(...trades);
  }

  console.log(`\n================ TỔNG SỐ LỆNH: ${allTrades.length} ================`);

  // Phân tích theo Chiến lược (Strategy)
  const byStrat = {};
  for (const t of allTrades) {
    const strat = t.strategy || 'UNKNOWN';
    if (!byStrat[strat]) byStrat[strat] = [];
    byStrat[strat].push(t);
  }

  console.log('\n📊 HIỆU SUẤT THEO TỪNG CHIẾN LƯỢC:');
  console.log('-'.repeat(90));
  console.log('Chiến Lược'.padEnd(30) + 'Số Lệnh'.padEnd(10) + 'Thắng'.padEnd(8) + 'Khóa +1R'.padEnd(10) + 'Thua'.padEnd(8) + 'WinRate'.padEnd(10) + 'Total R'.padEnd(12) + 'Net USD');
  console.log('-'.repeat(90));

  for (const [strat, trs] of Object.entries(byStrat)) {
    const m = calculateMetrics(trs);
    console.log(
      strat.padEnd(30) +
      String(m.totalTrades).padEnd(10) +
      String(m.wins).padEnd(8) +
      String(m.locks).padEnd(10) +
      String(m.losses).padEnd(8) +
      m.winRate.padEnd(10) +
      m.totalR.padEnd(12) +
      m.netPnlUsd
    );
  }

  // Phân tích theo Hướng (LONG vs SHORT)
  const byDir = {};
  for (const t of allTrades) {
    const dir = t.direction;
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push(t);
  }

  console.log('\n📊 HIỆU SUẤT THEO HƯỚNG (LONG vs SHORT):');
  console.log('-'.repeat(90));
  for (const [dir, trs] of Object.entries(byDir)) {
    const m = calculateMetrics(trs);
    console.log(
      dir.padEnd(30) +
      String(m.totalTrades).padEnd(10) +
      String(m.wins).padEnd(8) +
      String(m.locks).padEnd(10) +
      String(m.losses).padEnd(8) +
      m.winRate.padEnd(10) +
      m.totalR.padEnd(12) +
      m.netPnlUsd
    );
  }
}

analyze();
