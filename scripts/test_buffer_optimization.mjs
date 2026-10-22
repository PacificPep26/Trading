import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';
import { evaluateMarket } from '../src/engine.js';
import { BOT_CONFIG } from '../src/config.js';
import { backtestSymbol, calculateMetrics } from './backtest_1year.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache_1year');

async function testBuffers() {
  const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json'), 'utf8')).map(normalizeCandle);
  const btcH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_4H.json'), 'utf8')).map(normalizeCandle);
  const symbols = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'LINK-USDT-SWAP', 'NEAR-USDT-SWAP'];

  for (const buf of [0.25, 0.4, 0.6]) {
    const customConfig = { ...BOT_CONFIG, atrBufferMultiplier: buf, beTriggerR: 1.2, lockProfitR: 0.5 };
    let allTrades = [];
    for (const s of symbols) {
      const trades = await backtestSymbol(s, btcH1, btcH4, customConfig);
      allTrades.push(...trades);
    }
    const m = calculateMetrics(allTrades);
    console.log(`\nBuffer ATR: ${buf} | beTrigger: 1.2 | lock: 0.5`);
    console.log(`Trades: ${m.totalTrades} | WinRate: ${m.winRate} | Net PnL: ${m.netPnlUsd} | Total R: ${m.totalR} | MaxDD: ${m.maxDrawdownR}`);
  }
}

testBuffers();
