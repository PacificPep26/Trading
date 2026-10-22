/**
 * TEST_50PCT_DEEP.MJS
 * Khảo sát chi tiết nguyên lý "Hồi 50% Nến H4 mới Long/Short":
 * - So sánh giá Entry khi vào đỉnh nến vs chờ hồi 50% nến H4
 * - Phân tích tác động lên R:R, Win Rate và Tổng lợi nhuận
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

function runTest(require50Retrace = false) {
  const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H_october.json'), 'utf8')).map(normalizeCandle);
  const trades = [];

  for (const sym of SYMBOLS) {
    const candlesH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${sym}_4H_october.json`), 'utf8')).map(normalizeCandle);
    const candlesH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${sym}_1H_october.json`), 'utf8')).map(normalizeCandle);
    const candlesM15 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${sym}_15m_october.json`), 'utf8')).map(normalizeCandle);

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

        if (!activeTrade.isProfitLocked && curMaxR >= 1.5) {
          activeTrade.isProfitLocked = true;
          activeTrade.stopLoss = isLong ? activeTrade.entry + (1.0 * riskDist) : activeTrade.entry - (1.0 * riskDist);
        }

        const isSLHit = isLong ? (currentM15.low <= activeTrade.stopLoss) : (currentM15.high >= activeTrade.stopLoss);
        const isTPHit = isLong ? (currentM15.high >= activeTrade.takeProfit) : (currentM15.low <= activeTrade.takeProfit);

        if (isSLHit) {
          const grossPnl = isLong ? (activeTrade.stopLoss - activeTrade.entry) * activeTrade.sizing.size : (activeTrade.entry - activeTrade.stopLoss) * activeTrade.sizing.size;
          const fee = activeTrade.sizing.notional * 0.0008;
          trades.push({
            outcome: activeTrade.isProfitLocked ? 'LOCK_1R' : 'SL',
            netR: activeTrade.isProfitLocked ? 1.0 : -1.0,
            netPnl: grossPnl - fee
          });
          activeTrade = null;
          continue;
        }

        if (isTPHit) {
          const grossPnl = isLong ? (activeTrade.takeProfit - activeTrade.entry) * activeTrade.sizing.size : (activeTrade.entry - activeTrade.takeProfit) * activeTrade.sizing.size;
          const fee = activeTrade.sizing.notional * 0.0008;
          trades.push({
            outcome: 'TP',
            netR: activeTrade.riskReward,
            netPnl: grossPnl - fee
          });
          activeTrade = null;
          continue;
        }
      }

      if (!activeTrade) {
        const visibleH4 = candlesH4.filter(c => c.ts + H4_MS <= m15CloseTime);
        const visibleH1 = candlesH1.filter(c => c.ts + H1_MS <= m15CloseTime);
        const visibleM15 = candlesM15.slice(0, i + 1);
        const visibleBtcH1 = btcH1.filter(c => c.ts + H1_MS <= m15CloseTime);

        if (visibleH4.length < 90 || visibleH1.length < 15 || visibleM15.length < 5) continue;

        const lastH4 = visibleH4[visibleH4.length - 1];
        const h4Mid = (lastH4.high + lastH4.low) / 2;

        const signal = evaluateMarket({
          symbol: sym.replace('-SWAP', ''),
          candlesH4: visibleH4,
          candlesH1: visibleH1,
          candlesM15: visibleM15,
          btcH1Candles: visibleBtcH1,
          config: DEFAULT_CONFIG
        });

        if (signal && !signal.isBlocked) {
          // Điều kiện 50% H4 Retracement:
          if (require50Retrace) {
            // Long: Chỉ kích hoạt khi giá đã hồi về vùng 50% của nến H4 (Discount)
            if (signal.direction === 'LONG' && currentM15.close > (h4Mid * 1.002)) {
              continue;
            }
            // Short: Chỉ kích hoạt khi giá đã hồi lên vùng 50% của nến H4 (Premium)
            if (signal.direction === 'SHORT' && currentM15.close < (h4Mid * 0.998)) {
              continue;
            }
          }

          activeTrade = {
            ...signal,
            initialStopLoss: signal.stopLoss,
            isProfitLocked: false,
            barsHeld: 0
          };
        }
      }
    }
  }

  const wins = trades.filter(t => t.outcome === 'TP').length;
  const locked = trades.filter(t => t.outcome === 'LOCK_1R').length;
  const sls = trades.filter(t => t.outcome === 'SL').length;
  const totalR = trades.reduce((acc, t) => acc + t.netR, 0);
  const totalUsd = trades.reduce((acc, t) => acc + t.netPnl, 0);
  const winRate = trades.length > 0 ? (((wins + locked) / trades.length) * 100).toFixed(1) : 0;

  return { total: trades.length, wins, locked, sls, winRate, totalR, totalUsd };
}

console.log('--- KHẢO SÁT CHI TIẾT ---');
const normal = runTest(false);
console.log(`1. Khi vào lệnh M15 thông thường (không chờ 50% H4):`);
console.log(`   - Tổng lệnh: ${normal.total} (Win: ${normal.wins}, Lock 1R: ${normal.locked}, SL: ${normal.sls})`);
console.log(`   - Win Rate thực tế: ${normal.winRate}%`);
console.log(`   - Tổng R: +${normal.totalR.toFixed(2)}R | Net PnL: +$${normal.totalUsd.toFixed(2)} USDT`);

const retrace50 = runTest(true);
console.log(`\n2. Khi ÁP DỤNG "HỒI VỀ 50% NẾN H4 MỚI VÀO" (Equilibrium / Discount Entry):`);
console.log(`   - Tổng lệnh: ${retrace50.total} (Win: ${retrace50.wins}, Lock 1R: ${retrace50.locked}, SL: ${retrace50.sls})`);
console.log(`   - Win Rate thực tế: ${retrace50.winRate}%`);
console.log(`   - Tổng R: +${retrace50.totalR.toFixed(2)}R | Net PnL: +$${retrace50.totalUsd.toFixed(2)} USDT`);

