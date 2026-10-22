/**
 * TEST_LIMIT_50PCT.MJS
 * Mô phỏng: Đặt Limit Order tại 50% nến H4 (Equilibrium / Consequent Encroachment)
 * So sánh: Vào lệnh Market Breakout M15 vs Vào lệnh Limit 50% nến H4
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';
import { evaluateMarket, DEFAULT_CONFIG, calculatePositionSize } from '../src/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');
const SYMBOLS = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'LINK-USDT-SWAP', 'NEAR-USDT-SWAP'];
const START_OCTOBER_TS = new Date('2026-10-01T00:00:00Z').getTime();

const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const H4_MS = 4 * 60 * 60 * 1000;

function runLimitTest() {
  const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H_october.json'), 'utf8')).map(normalizeCandle);
  const trades = [];

  for (const sym of SYMBOLS) {
    const candlesH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${sym}_4H_october.json`), 'utf8')).map(normalizeCandle);
    const candlesH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${sym}_1H_october.json`), 'utf8')).map(normalizeCandle);
    const candlesM15 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${sym}_15m_october.json`), 'utf8')).map(normalizeCandle);

    let activeTrade = null;
    let pendingLimit = null; // Lệnh chờ khớp tại 50% nến H4
    const startIndex = candlesM15.findIndex(c => c.ts >= START_OCTOBER_TS);
    const startFrom = startIndex >= 30 ? startIndex : 30;

    for (let i = startFrom; i < candlesM15.length; i++) {
      const currentM15 = candlesM15[i];
      const m15CloseTime = currentM15.ts + M15_MS;

      // 1. Kiểm tra khớp lệnh Limit 50%
      if (pendingLimit && !activeTrade) {
        pendingLimit.barsWaiting++;
        const isLong = pendingLimit.direction === 'LONG';
        // Long khớp khi giá thấp nhất nến M15 chạm mức 50%
        const isFilled = isLong ? (currentM15.low <= pendingLimit.entry) : (currentM15.high >= pendingLimit.entry);

        if (isFilled) {
          activeTrade = {
            ...pendingLimit,
            barsHeld: 0
          };
          pendingLimit = null;
        } else if (pendingLimit.barsWaiting > 8) {
          // Hết hạn sau 8 nến M15 (2 tiếng) nếu không hồi về 50%
          pendingLimit = null;
        }
      }

      // 2. Quản lý vị thế đang mở
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
            symbol: sym,
            outcome: activeTrade.isProfitLocked ? 'LOCK_1R' : 'SL',
            netR: activeTrade.isProfitLocked ? 1.0 : -1.0,
            netPnl: grossPnl - fee,
            entry: activeTrade.entry,
            exit: activeTrade.stopLoss
          });
          activeTrade = null;
          continue;
        }

        if (isTPHit) {
          const grossPnl = isLong ? (activeTrade.takeProfit - activeTrade.entry) * activeTrade.sizing.size : (activeTrade.entry - activeTrade.takeProfit) * activeTrade.sizing.size;
          const fee = activeTrade.sizing.notional * 0.0008;
          const achievedR = (Math.abs(activeTrade.takeProfit - activeTrade.entry) / riskDist);
          trades.push({
            symbol: sym,
            outcome: 'TP',
            netR: achievedR,
            netPnl: grossPnl - fee,
            entry: activeTrade.entry,
            exit: activeTrade.takeProfit
          });
          activeTrade = null;
          continue;
        }
      }

      // 3. Quét tín hiệu tạo Limit 50%
      if (!activeTrade && !pendingLimit) {
        const visibleH4 = candlesH4.filter(c => c.ts + H4_MS <= m15CloseTime);
        const visibleH1 = candlesH1.filter(c => c.ts + H1_MS <= m15CloseTime);
        const visibleM15 = candlesM15.slice(0, i + 1);
        const visibleBtcH1 = btcH1.filter(c => c.ts + H1_MS <= m15CloseTime);

        if (visibleH4.length < 90 || visibleH1.length < 15 || visibleM15.length < 5) continue;

        const lastH4 = visibleH4[visibleH4.length - 1];

        const signal = evaluateMarket({
          symbol: sym.replace('-SWAP', ''),
          candlesH4: visibleH4,
          candlesH1: visibleH1,
          candlesM15: visibleM15,
          btcH1Candles: visibleBtcH1,
          config: DEFAULT_CONFIG
        });

        if (signal && !signal.isBlocked) {
          // Tính mốc 50% của nến H4
          const h4Mid = (lastH4.high + lastH4.low) / 2;
          const isLong = signal.direction === 'LONG';

          // Entry tối ưu tại 50% nến H4
          const limitEntry = h4Mid;
          const stopLoss = signal.stopLoss;
          const takeProfit = signal.takeProfit;

          // Kiểm tra R:R khi vào tại mốc 50%
          const riskDist = Math.abs(limitEntry - stopLoss);
          const rewardDist = Math.abs(takeProfit - limitEntry);
          const optimalRR = rewardDist / riskDist;

          if (optimalRR >= 2.0) {
            const sizing = calculatePositionSize(limitEntry, stopLoss, DEFAULT_CONFIG.riskUsd, DEFAULT_CONFIG.leverage);
            pendingLimit = {
              symbol: sym,
              direction: signal.direction,
              strategy: `50PCT_LIMIT_${signal.strategy}`,
              entry: limitEntry,
              stopLoss,
              initialStopLoss: stopLoss,
              takeProfit,
              riskReward: parseFloat(optimalRR.toFixed(2)),
              sizing,
              isProfitLocked: false,
              barsWaiting: 0
            };
          }
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

  return { total: trades.length, wins, locked, sls, winRate, totalR, totalUsd, trades };
}

const res = runLimitTest();
console.log('=== KẾT QUẢ ĐẶT LIMIT TẠI 50% NẾN H4 ===');
console.log(`- Tổng lệnh khớp: ${res.total}`);
console.log(`- Thắng trọn TP: ${res.wins} (${((res.wins / res.total) * 100).toFixed(1)}%)`);
console.log(`- Khóa lãi +1R: ${res.locked}`);
console.log(`- Dừng lỗ: ${res.sls}`);
console.log(`- Win Rate thực tế: ${res.winRate}%`);
console.log(`- Tổng R mang về: +${res.totalR.toFixed(2)}R`);
console.log(`- Net PnL (USDT): +$${res.totalUsd.toFixed(2)} USDT`);

if (res.trades.length > 0) {
  console.log('\nTop 5 lệnh TP tiêu biểu khi khớp tại 50% nến H4:');
  res.trades.filter(t => t.outcome === 'TP').slice(0, 5).forEach(t => {
    console.log(`  🎯 ${t.symbol} Entry: ${t.entry.toFixed(2)} -> TP: ${t.exit.toFixed(2)} | +${t.netR.toFixed(2)}R (+$${t.netPnl.toFixed(2)})`);
  });
}

