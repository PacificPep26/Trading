import fs from 'fs';
import path from 'path';
import { normalizeCandle } from '../src/indicators.js';
import { evaluateMarket, DEFAULT_CONFIG } from '../src/engine.js';
import { calculateMetrics } from './backtest_1year.mjs';

const CACHE_DIR = 'data/cache_1year';
const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const H4_MS = 4 * 60 * 60 * 1000;
const START_BACKTEST_TS = new Date('2025-10-01T00:00:00Z').getTime();

async function simulateBeRules(beTriggerR, lockR, tpR = 2.0, requireVsa = false) {
  const symbols = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'LINK-USDT-SWAP', 'NEAR-USDT-SWAP'];
  let allTrades = [];

  for (const instId of symbols) {
    const candlesH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, instId + '_4H.json'), 'utf8')).map(normalizeCandle);
    const candlesH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, instId + '_1H.json'), 'utf8')).map(normalizeCandle);
    const candlesM15 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, instId + '_15m.json'), 'utf8')).map(normalizeCandle);

    let h4Pointer = 0;
    let h1Pointer = 0;
    let activeTrade = null;
    let symbolTrades = [];

    let startIndex = candlesM15.findIndex(c => c.ts >= START_BACKTEST_TS);
    if (startIndex < 50) startIndex = 50;

    for (let i = startIndex; i < candlesM15.length; i++) {
      const currentM15 = candlesM15[i];
      const m15CloseTime = currentM15.ts + M15_MS;

      if (activeTrade) {
        const isLong = activeTrade.direction === 'LONG';
        const riskDist = Math.abs(activeTrade.entry - activeTrade.initialStopLoss);
        const favorablePrice = isLong ? currentM15.high : currentM15.low;
        const curMaxR = isLong ? (favorablePrice - activeTrade.entry) / riskDist : (activeTrade.entry - favorablePrice) / riskDist;

        if (!activeTrade.isProfitLocked && curMaxR >= beTriggerR) {
          activeTrade.isProfitLocked = true;
          activeTrade.stopLoss = isLong ? activeTrade.entry + (lockR * riskDist) : activeTrade.entry - (lockR * riskDist);
        }

        const isSLHit = isLong ? (currentM15.low <= activeTrade.stopLoss) : (currentM15.high >= activeTrade.stopLoss);
        const isTPHit = isLong ? (currentM15.high >= activeTrade.takeProfit) : (currentM15.low <= activeTrade.takeProfit);

        if (isSLHit) {
          const netR = activeTrade.isProfitLocked ? lockR : -1.0;
          symbolTrades.push({ outcome: activeTrade.isProfitLocked ? 'LOCK' : 'SL', netR, netUsd: netR * 10 - (activeTrade.sizing.notional * 0.0008) });
          activeTrade = null;
        } else if (isTPHit) {
          symbolTrades.push({ outcome: 'TP', netR: tpR, netUsd: tpR * 10 - (activeTrade.sizing.notional * 0.0008) });
          activeTrade = null;
        }
      }

      if (!activeTrade) {
        while (h4Pointer + 1 < candlesH4.length && candlesH4[h4Pointer + 1].ts + H4_MS <= m15CloseTime) h4Pointer++;
        while (h1Pointer + 1 < candlesH1.length && candlesH1[h1Pointer + 1].ts + H1_MS <= m15CloseTime) h1Pointer++;

        if (h4Pointer >= 90 && h1Pointer >= 15 && i >= 5) {
          const visibleH4 = candlesH4.slice(Math.max(0, h4Pointer - 150), h4Pointer + 1);
          const visibleH1 = candlesH1.slice(Math.max(0, h1Pointer - 40), h1Pointer + 1);
          const visibleM15 = candlesM15.slice(Math.max(0, i - 40), i + 1);

          const signal = evaluateMarket({
            symbol: instId.replace('-SWAP', ''),
            candlesH4: visibleH4,
            candlesH1: visibleH1,
            candlesM15: visibleM15,
            config: DEFAULT_CONFIG
          });

          if (signal && !signal.isBlocked) {
            if (requireVsa && (!signal.reason || !signal.reason.includes('VSA'))) {
              continue;
            }
            const riskDist = Math.abs(signal.entry - signal.stopLoss);
            const fixedTp = signal.direction === 'LONG' ? signal.entry + (tpR * riskDist) : signal.entry - (tpR * riskDist);
            activeTrade = {
              ...signal,
              takeProfit: fixedTp,
              initialStopLoss: signal.stopLoss,
              isProfitLocked: false
            };
          }
        }
      }
    }
    allTrades.push(...symbolTrades);
  }

  const m = calculateMetrics(allTrades);
  const tag = `beTrigger=${beTriggerR}R, lockR=${lockR}R, tp=${tpR}R, VSA=${requireVsa}`;
  console.log(tag.padEnd(45), `Trades: ${String(m.totalTrades).padEnd(5)} | WR: ${m.winRate.padEnd(7)} | TotalR: ${m.totalR.padEnd(9)} | NetUSD: ${m.netPnlUsd.padEnd(10)} | MaxDD: ${m.maxDrawdownR}`);
}

async function main() {
  console.log('--- PHÂN TÍCH QUẢN TRỊ RỦI RO (RISK MANAGEMENT MATRIX 1 NĂM) ---');
  await simulateBeRules(1.5, 1.0, 2.0, false); // Current default
  await simulateBeRules(1.0, 0.0, 2.0, false); // Move to BE (+0R) at +1.0R
  await simulateBeRules(1.0, 0.5, 2.0, false); // Move to +0.5R at +1.0R
  await simulateBeRules(1.0, 0.5, 1.5, false); // TP at 1.5R
  await simulateBeRules(1.2, 0.5, 2.0, false); // Move to +0.5R at +1.2R
  
  console.log('\n--- VỚI BỘ LỌC VOLUME ABSORPTION (VSA CLIMAX FILTER) ---');
  await simulateBeRules(1.5, 1.0, 2.0, true);
  await simulateBeRules(1.0, 0.0, 2.0, true);
  await simulateBeRules(1.0, 0.5, 2.0, true);
  await simulateBeRules(1.0, 0.5, 1.5, true);
  await simulateBeRules(1.2, 0.5, 2.0, true);
}

main().catch(console.error);

