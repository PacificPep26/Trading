/**
 * TEST_PULLBACK_RULE.MJS
 * Đánh giá tác động của Quy tắc Bắt buộc Có Nhịp Hồi (Pullback Rule):
 * - Chặn hoàn toàn các pha Short đuổi khi đã rớt mệt (Exhausted Short)
 * - Chặn hoàn toàn các pha Long đuổi khi đã tăng mệt (Exhausted Long)
 */

import fs from 'fs';
import path from 'path';
import { normalizeCandle } from '../src/indicators.js';
import { calculatePositionSize, DEFAULT_CONFIG } from '../src/engine.js';
import { evaluateMarket } from '../src/engine.js';

const CACHE_DIR = 'data/cache';
const SYMBOLS = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'LINK-USDT-SWAP', 'NEAR-USDT-SWAP'];
const START_OCTOBER_TS = new Date('2026-10-01T00:00:00Z').getTime();

const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const H4_MS = 4 * 60 * 60 * 1000;

function evaluateMarketWithPullback(params, enablePullbackRule = false) {
  const signal = evaluateMarket(params);
  if (!signal || !enablePullbackRule) return signal;

  const { candlesH4, candlesM15 } = params;
  const lastH4 = candlesH4[candlesH4.length - 1];
  const h4Mid = (lastH4.high + lastH4.low) / 2;
  const recentM15 = candlesM15.slice(-8);

  if (signal.direction === 'SHORT') {
    const recentHigh = Math.max(...recentM15.map(c => c.high));
    const hasPullback = signal.entry >= (h4Mid * 0.998) || recentHigh >= (h4Mid * 0.998);
    if (!hasPullback) {
      return null; // Chặn Short kiệt sức!
    }
  }

  if (signal.direction === 'LONG') {
    const recentLow = Math.min(...recentM15.map(c => c.low));
    const hasPullback = signal.entry <= (h4Mid * 1.002) || recentLow <= (h4Mid * 1.002);
    if (!hasPullback) {
      return null; // Chặn Long kiệt sức!
    }
  }

  return signal;
}

function runSim(enablePullbackRule = false) {
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

        const signal = evaluateMarketWithPullback({
          symbol: sym.replace('-SWAP', ''),
          candlesH4: visibleH4,
          candlesH1: visibleH1,
          candlesM15: visibleM15,
          btcH1Candles: visibleBtcH1,
          config: DEFAULT_CONFIG
        }, enablePullbackRule);

        if (signal && !signal.isBlocked) {
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

console.log('=== KẾT QUẢ SO SÁNH TRƯỚC VÀ SAU KHI SỬA LỖI SHORT ĐUỔI ===');
const before = runSim(false);
console.log(`1. Trước khi sửa (Dính lỗi Short khi đã rớt mệt):`);
console.log(`   - Tổng lệnh: ${before.total} | Thắng TP: ${before.wins} | Khóa +1R: ${before.locked} | Thua: ${before.sls}`);
console.log(`   - Tỷ lệ có lãi: ${before.winRate}%`);
console.log(`   - Tổng R: +${before.totalR.toFixed(2)}R | Lợi nhuận ròng: +$${before.totalUsd.toFixed(2)} USDT`);

const after = runSim(true);
console.log(`\n2. Sau khi sửa (BẮT BUỘC CÓ NHỊP HỒI PULLBACK MỚI VÀO):`);
console.log(`   - Tổng lệnh: ${after.total} | Thắng TP: ${after.wins} | Khóa +1R: ${after.locked} | Thua: ${after.sls}`);
console.log(`   - Tỷ lệ có lãi: ${after.winRate}%`);
console.log(`   - Tổng R: +${after.totalR.toFixed(2)}R | Lợi nhuận ròng: +$${after.totalUsd.toFixed(2)} USDT`);

