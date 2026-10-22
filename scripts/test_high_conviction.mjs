import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';
import { evaluateMarket } from '../src/engine.js';
import { BOT_CONFIG } from '../src/config.js';
import { backtestSymbol, calculateMetrics } from './backtest_1year.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache_1year');

async function testStrategies() {
  const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json'), 'utf8')).map(normalizeCandle);
  const btcH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_4H.json'), 'utf8')).map(normalizeCandle);
  const symbols = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'LINK-USDT-SWAP', 'NEAR-USDT-SWAP'];

  let allTrades = [];
  for (const s of symbols) {
    const trades = await backtestSymbol(s, btcH1, btcH4);
    allTrades.push(...trades);
  }

  // Lọc chỉ lấy các lệnh có VSA Volume Absorption hoặc Quét Râu Mạnh (High Conviction SMC)
  const smcHighConviction = allTrades.filter(t => 
    t.reason.includes('VSA') || 
    t.reason.includes('Râu 4') || 
    t.reason.includes('Râu 5') || 
    t.reason.includes('Râu 6') || 
    t.reason.includes('Râu 7') || 
    t.reason.includes('Râu 8')
  );

  console.log(`\nTổng số lệnh toàn bộ: ${allTrades.length}`);
  const mAll = calculateMetrics(allTrades);
  console.log(`Toàn bộ: WinRate: ${mAll.winRate} | Total R: ${mAll.totalR} | Net USD: ${mAll.netPnlUsd}`);

  console.log(`\nSố lệnh SMC Rút Râu Mạnh / VSA Khối Lượng Hấp Thụ: ${smcHighConviction.length}`);
  const mSMC = calculateMetrics(smcHighConviction);
  console.log(`SMC High-Conviction: WinRate: ${mSMC.winRate} | Total R: ${mSMC.totalR} | Net USD: ${mSMC.netPnlUsd}`);
}

testStrategies();

