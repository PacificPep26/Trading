import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';
import { evaluateMarket } from '../src/engine.js';
import { BOT_CONFIG } from '../src/config.js';
import { calculateMetrics } from './backtest_1year.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache_1year');

const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const H4_MS = 4 * 60 * 60 * 1000;
const START_BACKTEST_TS = new Date('2025-10-01T00:00:00Z').getTime();

function simulateSymbol(instId, btcH1, btcH4, testConfig) {
  const symbol = instId.replace('-SWAP', '');
  const fH4 = path.join(CACHE_DIR, `${instId}_4H.json`);
  const fH1 = path.join(CACHE_DIR, `${instId}_1H.json`);
  const fM15 = path.join(CACHE_DIR, `${instId}_15m.json`);

  const candlesH4 = JSON.parse(fs.readFileSync(fH4, 'utf8')).map(normalizeCandle);
  const candlesH1 = JSON.parse(fs.readFileSync(fH1, 'utf8')).map(normalizeCandle);
  const candlesM15 = JSON.parse(fs.readFileSync(fM15, 'utf8')).map(normalizeCandle);

  const closedTrades = [];
  let activeTrade = null;

  let startIndex = candlesM15.findIndex(c => c.ts >= START_BACKTEST_TS);
  if (startIndex < 50) startIndex = 50;

  let h4Pointer = 0;
  let h1Pointer = 0;
  let btcH1Pointer = 0;
  let btcH4Pointer = 0;

  for (let i = startIndex; i < candlesM15.length; i++) {
    const currentM15 = candlesM15[i];
    const m15CloseTime = currentM15.ts + M15_MS;

    if (activeTrade) {
      activeTrade.barsHeld++;
      const isLong = activeTrade.direction === 'LONG';
      const riskDist = Math.abs(activeTrade.entry - activeTrade.initialStopLoss);

      const favorablePrice = isLong ? currentM15.high : currentM15.low;
      const curMaxR = isLong
        ? (favorablePrice - activeTrade.entry) / riskDist
        : (activeTrade.entry - favorablePrice) / riskDist;

      // Trailing rule test
      if (!activeTrade.isProfitLocked && curMaxR >= testConfig.beTriggerR) {
        activeTrade.isProfitLocked = true;
        activeTrade.stopLoss = isLong
          ? activeTrade.entry + (testConfig.lockProfitR * riskDist)
          : activeTrade.entry - (testConfig.lockProfitR * riskDist);
      }

      // Time stop test
      if (testConfig.timeStopBars && activeTrade.barsHeld >= testConfig.timeStopBars && !activeTrade.isProfitLocked) {
        const exitPrice = currentM15.close;
        const grossPnl = isLong
          ? (exitPrice - activeTrade.entry) * activeTrade.sizing.size
          : (activeTrade.entry - exitPrice) * activeTrade.sizing.size;
        const fee = activeTrade.sizing.notional * testConfig.feeRate;
        const netPnl = grossPnl - fee;
        const netR = (exitPrice - activeTrade.entry) / riskDist * (isLong ? 1 : -1);

        closedTrades.push({
          ...activeTrade,
          exitTime: m15CloseTime,
          exitPrice,
          outcome: netR >= 0 ? 'TIME_WIN' : 'TIME_LOSS',
          netR,
          netUsd: netPnl
        });
        activeTrade = null;
        continue;
      }

      const isSLHit = isLong ? (currentM15.low <= activeTrade.stopLoss) : (currentM15.high >= activeTrade.stopLoss);
      const isTPHit = isLong ? (currentM15.high >= activeTrade.takeProfit) : (currentM15.low <= activeTrade.takeProfit);

      if (isSLHit) {
        const exitPrice = activeTrade.stopLoss;
        const grossPnl = isLong
          ? (exitPrice - activeTrade.entry) * activeTrade.sizing.size
          : (activeTrade.entry - exitPrice) * activeTrade.sizing.size;
        const fee = activeTrade.sizing.notional * testConfig.feeRate;
        const netPnl = grossPnl - fee;
        const netR = activeTrade.isProfitLocked ? testConfig.lockProfitR : -1.0;

        closedTrades.push({
          ...activeTrade,
          exitTime: m15CloseTime,
          exitPrice,
          outcome: activeTrade.isProfitLocked ? 'LOCK_PROFIT' : 'SL',
          netR,
          netUsd: netPnl
        });
        activeTrade = null;
      } else if (isTPHit) {
        const exitPrice = activeTrade.takeProfit;
        const grossPnl = isLong
          ? (exitPrice - activeTrade.entry) * activeTrade.sizing.size
          : (activeTrade.entry - exitPrice) * activeTrade.sizing.size;
        const fee = activeTrade.sizing.notional * testConfig.feeRate;
        const netPnl = grossPnl - fee;
        const netR = activeTrade.riskReward;

        closedTrades.push({
          ...activeTrade,
          exitTime: m15CloseTime,
          exitPrice,
          outcome: 'TP',
          netR,
          netUsd: netPnl
        });
        activeTrade = null;
      }
    }

    if (!activeTrade) {
      while (h4Pointer + 1 < candlesH4.length && candlesH4[h4Pointer + 1].ts + H4_MS <= m15CloseTime) h4Pointer++;
      while (h1Pointer + 1 < candlesH1.length && candlesH1[h1Pointer + 1].ts + H1_MS <= m15CloseTime) h1Pointer++;
      if (btcH1 && btcH1.length > 0) {
        while (btcH1Pointer + 1 < btcH1.length && btcH1[btcH1Pointer + 1].ts + H1_MS <= m15CloseTime) btcH1Pointer++;
      }
      if (btcH4 && btcH4.length > 0) {
        while (btcH4Pointer + 1 < btcH4.length && btcH4[btcH4Pointer + 1].ts + H4_MS <= m15CloseTime) btcH4Pointer++;
      }

      if (h4Pointer >= 90 && h1Pointer >= 15 && i >= 5) {
        const visibleH4 = candlesH4.slice(Math.max(0, h4Pointer - 150), h4Pointer + 1);
        const visibleH1 = candlesH1.slice(Math.max(0, h1Pointer - 40), h1Pointer + 1);
        const visibleM15 = candlesM15.slice(Math.max(0, i - 40), i + 1);

        let visibleBtcH1 = null;
        if (btcH1 && btcH1.length > 0 && btcH1Pointer >= 15) {
          visibleBtcH1 = btcH1.slice(Math.max(0, btcH1Pointer - 40), btcH1Pointer + 1);
        }
        let visibleBtcH4 = null;
        if (btcH4 && btcH4.length > 0 && btcH4Pointer >= 35) {
          visibleBtcH4 = btcH4.slice(Math.max(0, btcH4Pointer - 100), btcH4Pointer + 1);
        }

        const signal = evaluateMarket({
          symbol,
          candlesH4: visibleH4,
          candlesH1: visibleH1,
          candlesM15: visibleM15,
          btcH1Candles: visibleBtcH1,
          btcH4Candles: visibleBtcH4,
          config: testConfig
        });

        if (signal && !signal.isBlocked) {
          activeTrade = {
            ...signal,
            entryTime: currentM15.ts,
            initialStopLoss: signal.stopLoss,
            isProfitLocked: false,
            barsHeld: 0
          };
        }
      }
    }
  }

  return closedTrades;
}

async function runOptimization() {
  const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json'), 'utf8')).map(normalizeCandle);
  const btcH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_4H.json'), 'utf8')).map(normalizeCandle);
  const symbols = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'LINK-USDT-SWAP', 'NEAR-USDT-SWAP'];

  console.log('🧪 CHẠY TỐI ƯU HÓA ĐỊNH LƯỢNG (PARAMETER OPTIMIZATION) 1 NĂM...');

  const paramGrid = [
    { name: 'Gốc (beTrigger=1.5, lock=1.0, timeStop=0)', beTriggerR: 1.5, lockProfitR: 1.0, timeStopBars: 0 },
    { name: 'Kéo BE sớm (beTrigger=1.0, lock=0.2, timeStop=0)', beTriggerR: 1.0, lockProfitR: 0.2, timeStopBars: 0 },
    { name: 'Kéo BE chuẩn (beTrigger=1.2, lock=0.5, timeStop=0)', beTriggerR: 1.2, lockProfitR: 0.5, timeStopBars: 0 },
    { name: 'Kéo BE chuẩn + TimeStop 16 bars (4h)', beTriggerR: 1.2, lockProfitR: 0.5, timeStopBars: 16 },
    { name: 'Kéo BE 1.0R + Lock 0.5R + TimeStop 16 bars', beTriggerR: 1.0, lockProfitR: 0.5, timeStopBars: 16 }
  ];

  for (const grid of paramGrid) {
    const testConfig = { ...BOT_CONFIG, ...grid };
    let allTrades = [];
    for (const s of symbols) {
      const trades = simulateSymbol(s, btcH1, btcH4, testConfig);
      allTrades.push(...trades);
    }
    const m = calculateMetrics(allTrades);
    console.log(`\n📌 Cấu hình: ${grid.name}`);
    console.log(`   Trades: ${m.totalTrades} | WinRate: ${m.winRate} | Net PnL: ${m.netPnlUsd} | Total R: ${m.totalR} | MaxDD: ${m.maxDrawdownR}`);
  }
}

runOptimization();

