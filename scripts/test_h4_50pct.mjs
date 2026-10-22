/**
 * TEST_H4_50PCT.MJS
 * Thử nghiệm chiến thuật: Chờ giá hồi về 50% nến H4 vừa đóng (Consequent Encroachment / Equilibrium)
 * rồi mới kích hoạt M15 xác nhận vào lệnh.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';
import { evaluateMarket, DEFAULT_CONFIG } from '../src/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');

const SYMBOLS = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'LINK-USDT-SWAP', 'NEAR-USDT-SWAP'];
const START_OCTOBER_TS = new Date('2026-10-01T00:00:00Z').getTime();

const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const H4_MS = 4 * 60 * 60 * 1000;

const CONFIG = {
  ...DEFAULT_CONFIG,
  riskUsd: 10.0,
  leverage: 10,
  feeRate: 0.0008,
  minRR: 2.0,
  beTriggerR: 1.5,
  lockProfitR: 1.0,
  beBufferRate: 0.0008
};

function runSim(use50PctRetracement = false) {
  let totalTrades = 0;
  let totalR = 0;
  let totalUsd = 0;
  let wins = 0;
  let locked = 0;
  let losses = 0;

  const btcH1File = path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H_october.json');
  const btcH1 = fs.existsSync(btcH1File) ? JSON.parse(fs.readFileSync(btcH1File, 'utf8')).map(normalizeCandle) : [];

  for (const sym of SYMBOLS) {
    const fH4 = path.join(CACHE_DIR, `${sym}_4H_october.json`);
    const fH1 = path.join(CACHE_DIR, `${sym}_1H_october.json`);
    const fM15 = path.join(CACHE_DIR, `${sym}_15m_october.json`);

    if (!fs.existsSync(fH4) || !fs.existsSync(fH1) || !fs.existsSync(fM15)) continue;

    const candlesH4 = JSON.parse(fs.readFileSync(fH4, 'utf8')).map(normalizeCandle);
    const candlesH1 = JSON.parse(fs.readFileSync(fH1, 'utf8')).map(normalizeCandle);
    const candlesM15 = JSON.parse(fs.readFileSync(fM15, 'utf8')).map(normalizeCandle);

    let activeTrade = null;
    const startIndex = candlesM15.findIndex(c => c.ts >= START_OCTOBER_TS);
    const startFrom = startIndex >= 30 ? startIndex : 30;

    for (let i = startFrom; i < candlesM15.length; i++) {
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

        if (!activeTrade.isProfitLocked && curMaxR >= CONFIG.beTriggerR) {
          activeTrade.isProfitLocked = true;
          activeTrade.stopLoss = isLong ? activeTrade.entry + (CONFIG.lockProfitR * riskDist) : activeTrade.entry - (CONFIG.lockProfitR * riskDist);
        }

        const isSLHit = isLong ? (currentM15.low <= activeTrade.stopLoss) : (currentM15.high >= activeTrade.stopLoss);
        const isTPHit = isLong ? (currentM15.high >= activeTrade.takeProfit) : (currentM15.low <= activeTrade.takeProfit);

        if (isSLHit) {
          const grossPnl = isLong ? (activeTrade.stopLoss - activeTrade.entry) * activeTrade.sizing.size : (activeTrade.entry - activeTrade.stopLoss) * activeTrade.sizing.size;
          const fee = activeTrade.sizing.notional * CONFIG.feeRate;
          totalUsd += (grossPnl - fee);
          if (activeTrade.isProfitLocked) {
            totalR += CONFIG.lockProfitR;
            locked++;
          } else {
            totalR -= 1.0;
            losses++;
          }
          activeTrade = null;
          continue;
        }

        if (isTPHit) {
          const grossPnl = isLong ? (activeTrade.takeProfit - activeTrade.entry) * activeTrade.sizing.size : (activeTrade.entry - activeTrade.takeProfit) * activeTrade.sizing.size;
          const fee = activeTrade.sizing.notional * CONFIG.feeRate;
          totalUsd += (grossPnl - fee);
          totalR += (Math.abs(activeTrade.takeProfit - activeTrade.entry) / riskDist);
          wins++;
          activeTrade = null;
          continue;
        }

        if (activeTrade.barsHeld >= CONFIG.timeStopBars) {
          const grossPnl = isLong ? (currentM15.close - activeTrade.entry) * activeTrade.sizing.size : (activeTrade.entry - currentM15.close) * activeTrade.sizing.size;
          const fee = activeTrade.sizing.notional * CONFIG.feeRate;
          totalUsd += (grossPnl - fee);
          totalR += (grossPnl / (riskDist * activeTrade.sizing.size));
          if (grossPnl > 0) wins++; else losses++;
          activeTrade = null;
          continue;
        }
      }

      if (!activeTrade) {
        const closedH4 = candlesH4.filter(c => (c.ts + H4_MS) <= m15CloseTime);
        const closedH1 = candlesH1.filter(c => (c.ts + H1_MS) <= m15CloseTime);
        const m15Slice = candlesM15.slice(0, i + 1);

        if (closedH4.length < 90 || closedH1.length < 15 || m15Slice.length < 5) continue;

        const lastH4 = closedH4[closedH4.length - 1];
        const h4Mid = (lastH4.high + lastH4.low) / 2;
        const btcSlice = btcH1 ? btcH1.filter(c => (c.ts + H1_MS) <= m15CloseTime) : null;

        const signal = evaluateMarket({
          symbol: sym.replace('-SWAP', ''),
          candlesH4: closedH4,
          candlesH1: closedH1,
          candlesM15: m15Slice,
          btcH1Candles: btcSlice,
          config: CONFIG
        });

        if (signal && !signal.isBlocked) {
          if (use50PctRetracement) {
            // Cho Long: Chỉ vào khi giá đang ở vùng Discount của nến H4 (<= 50% nến H4)
            if (signal.direction === 'LONG' && currentM15.close > h4Mid) {
              continue;
            }
            // Cho Short: Chỉ vào khi giá đang ở vùng Premium của nến H4 (>= 50% nến H4)
            if (signal.direction === 'SHORT' && currentM15.close < h4Mid) {
              continue;
            }
          }

          totalTrades++;
          activeTrade = {
            direction: signal.direction,
            entry: signal.entry,
            stopLoss: signal.stopLoss,
            initialStopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            sizing: signal.sizing,
            isProfitLocked: false,
            barsHeld: 0
          };
        }
      }
    }
  }

  return { totalTrades, totalR, totalUsd, wins, locked, losses };
}

console.log('=== SO SÁNH HIỆU QUẢ CỦA NGUYÊN TẮC HỒI 50% NẾN H4 ===');
const base = runSim(false);
console.log(`1. Mặc định (Vào ngay khi M15 breakout):`);
console.log(`   - Tổng lệnh: ${base.totalTrades} | Win: ${base.wins} | Lock +1R: ${base.locked} | Thua: ${base.losses}`);
console.log(`   - Tổng R: ${base.totalR.toFixed(2)}R | Net PnL: $${base.totalUsd.toFixed(2)} USDT`);

const with50 = runSim(true);
console.log(`\n2. Khi Áp Dụng Chờ Hồi 50% Nến H4 (Equilibrium Entry):`);
console.log(`   - Tổng lệnh: ${with50.totalTrades} | Win: ${with50.wins} | Lock +1R: ${with50.locked} | Thua: ${with50.losses}`);
console.log(`   - Tổng R: ${with50.totalR.toFixed(2)}R | Net PnL: $${with50.totalUsd.toFixed(2)} USDT`);
