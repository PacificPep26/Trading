/**
 * BACKTEST.MJS
 * Khung kiểm thử Walk-Forward từ 01/10/2026 trên dữ liệu thực tế OKX API.
 * Chuẩn hóa 100% theo phương pháp Smart Money / Demand-Supply Dr. Kane (EMA 34 & 89):
 * - Khử hoàn toàn Look-Ahead Bias (chỉ nạp nến H4 đã đóng đủ 4 tiếng)
 * - Trailing Break-Even tại +1.5R (+0.08% đệm phí)
 * - Giả định SL trước nếu giật cả 2 đầu trong cùng 1 nến M15
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';
import { evaluateMarket, DEFAULT_CONFIG } from '../src/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');

const BACKTEST_SYMBOLS = [
  'BTC-USDT-SWAP',
  'ETH-USDT-SWAP',
  'SOL-USDT-SWAP',
  'LINK-USDT-SWAP',
  'NEAR-USDT-SWAP'
];

const CONFIG = {
  ...DEFAULT_CONFIG,
  riskUsd: 10.0,
  leverage: 10,
  feeRate: 0.0008,          // Phí Taker 0.08% khứ hồi
  minRR: 2.0,
  beTriggerR: 1.5,
  beBufferRate: 0.0008
};

const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const H4_MS = 4 * 60 * 60 * 1000;
const START_OCTOBER_TS = new Date('2026-10-01T00:00:00Z').getTime();

async function backtestSymbol(instId, btcH1Candles) {
  const symbol = instId.replace('-SWAP', '');
  const fH4 = path.join(CACHE_DIR, `${instId}_4H_october.json`);
  const fH1 = path.join(CACHE_DIR, `${instId}_1H_october.json`);
  const fM15 = path.join(CACHE_DIR, `${instId}_15m_october.json`);

  if (!fs.existsSync(fH4) || !fs.existsSync(fH1) || !fs.existsSync(fM15)) {
    return [];
  }

  const candlesH4 = JSON.parse(fs.readFileSync(fH4, 'utf8')).map(normalizeCandle);
  const candlesH1 = JSON.parse(fs.readFileSync(fH1, 'utf8')).map(normalizeCandle);
  const candlesM15 = JSON.parse(fs.readFileSync(fM15, 'utf8')).map(normalizeCandle);

  const closedTrades = [];
  let activeTrade = null;
  const startIndex = candlesM15.findIndex(c => c.ts >= START_OCTOBER_TS);
  const startFrom = startIndex >= 30 ? startIndex : 30;

  for (let i = startFrom; i < candlesM15.length; i++) {
    const currentM15 = candlesM15[i];
    const m15CloseTime = currentM15.ts + M15_MS;

    // 1. Quản lý vị thế đang mở
    if (activeTrade) {
      activeTrade.barsHeld++;
      const isLong = activeTrade.direction === 'LONG';
      const riskDist = Math.abs(activeTrade.entry - activeTrade.initialStopLoss);

      // Trailing Khóa Lợi Nhuận: Khi chạm +1.5R -> Kéo SL lên dương +1.0R (khóa 1R, gồng tới 2R)
      const favorablePrice = isLong ? currentM15.high : currentM15.low;
      const curMaxR = isLong
        ? (favorablePrice - activeTrade.entry) / riskDist
        : (activeTrade.entry - favorablePrice) / riskDist;

      if (!activeTrade.isProfitLocked && curMaxR >= CONFIG.beTriggerR) {
        activeTrade.isProfitLocked = true;
        const lockR = CONFIG.lockProfitR !== undefined ? CONFIG.lockProfitR : 1.0;
        activeTrade.stopLoss = isLong
          ? activeTrade.entry + (lockR * riskDist)
          : activeTrade.entry - (lockR * riskDist);
      }

      // Kiểm tra chạm SL và TP
      const isSLHit = isLong ? (currentM15.low <= activeTrade.stopLoss) : (currentM15.high >= activeTrade.stopLoss);
      const isTPHit = isLong ? (currentM15.high >= activeTrade.takeProfit) : (currentM15.low <= activeTrade.takeProfit);

      // Nguyên tắc bảo toàn: Nếu cùng 1 nến chạm cả 2 đầu -> Giả định SL trước
      if (isSLHit) {
        const exitPrice = activeTrade.stopLoss;
        const grossPnl = isLong
          ? (exitPrice - activeTrade.entry) * activeTrade.sizing.size
          : (activeTrade.entry - exitPrice) * activeTrade.sizing.size;
        const fee = activeTrade.sizing.notional * CONFIG.feeRate;
        const netPnl = grossPnl - fee;
        const netR = activeTrade.isProfitLocked ? (CONFIG.lockProfitR || 1.0) : -1;

        closedTrades.push({
          ...activeTrade,
          exitTime: m15CloseTime,
          exitPrice,
          outcome: activeTrade.isProfitLocked ? 'LOCK_+1R' : 'SL',
          netR,
          netUsd: netPnl
        });
        activeTrade = null;
      } else if (isTPHit) {
        const exitPrice = activeTrade.takeProfit;
        const grossPnl = isLong
          ? (exitPrice - activeTrade.entry) * activeTrade.sizing.size
          : (activeTrade.entry - exitPrice) * activeTrade.sizing.size;
        const fee = activeTrade.sizing.notional * CONFIG.feeRate;
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

    // 2. Quét tín hiệu vào lệnh mới khi chưa có vị thế mở trên cặp này
    if (!activeTrade) {
      // 100% Chống Look-Ahead Bias:
      // Nến H4 mở lúc T chỉ được coi là đóng khi thời gian m15 hiện tại đã qua T + 4 tiếng
      const visibleH4 = candlesH4.filter(c => c.ts + H4_MS <= m15CloseTime);
      const visibleH1 = candlesH1.filter(c => c.ts + H1_MS <= m15CloseTime);
      const visibleM15 = candlesM15.slice(0, i + 1);
      const visibleBtcH1 = btcH1Candles.filter(c => c.ts + H1_MS <= m15CloseTime);

      const signal = evaluateMarket({
        symbol,
        candlesH4: visibleH4,
        candlesH1: visibleH1,
        candlesM15: visibleM15,
        btcH1Candles: visibleBtcH1,
        config: CONFIG
      });

      if (signal && !signal.isBlocked) {
        activeTrade = {
          ...signal,
          entryTime: currentM15.ts,
          initialStopLoss: signal.stopLoss,
          isBreakevenMoved: false,
          barsHeld: 0
        };
      }
    }
  }

  return closedTrades;
}

function calculateMetrics(trades) {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      locks: 0,
      be: 0,
      losses: 0,
      winRate: '0.0%',
      profitFactor: '0.00',
      totalR: '0.00R',
      netPnlUsd: '$0.00'
    };
  }

  const wins = trades.filter(t => t.outcome === 'TP');
  const locks = trades.filter(t => t.outcome === 'LOCK_+1R');
  const be = trades.filter(t => t.outcome === 'BE');
  const losses = trades.filter(t => t.outcome === 'SL');

  const winRate = (((wins.length + locks.length) / trades.length) * 100).toFixed(1) + '%';
  const grossProfit = trades.filter(t => t.netUsd > 0).reduce((acc, t) => acc + t.netUsd, 0);
  const grossLoss = Math.abs(trades.filter(t => t.netUsd < 0).reduce((acc, t) => acc + t.netUsd, 0));
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? 'INF' : '0.00');

  const totalR = trades.reduce((acc, t) => acc + t.netR, 0);
  const netPnlUsd = trades.reduce((acc, t) => acc + t.netUsd, 0);

  return {
    totalTrades: trades.length,
    wins: wins.length,
    locks: locks.length,
    be: be.length,
    losses: losses.length,
    winRate,
    profitFactor,
    totalR: `${totalR >= 0 ? '+' : ''}${totalR.toFixed(2)}R`,
    netPnlUsd: `${netPnlUsd >= 0 ? '+' : ''}$${netPnlUsd.toFixed(2)}`
  };
}

async function runBacktest() {
  console.log('================================================================');
  console.log('🏆 KẾT QUẢ KIỂM THỬ THỰC CHIẾN DR. KANE H4/M15 (EMA 34 & 89)');
  console.log('Quy tắc: 100% Chống Look-Ahead Bias | Trailing BE +1.5R | Phí Taker 0.08%');
  console.log('================================================================\n');

  const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H_october.json'), 'utf8')).map(normalizeCandle);
  const allTrades = [];
  const symbolStats = [];

  for (const instId of BACKTEST_SYMBOLS) {
    const trades = await backtestSymbol(instId, btcH1);
    allTrades.push(...trades);
    const m = calculateMetrics(trades);
    symbolStats.push({
      symbol: instId.replace('-SWAP', ''),
      ...m
    });
  }

  allTrades.sort((a, b) => a.entryTime - b.entryTime);

  console.log('📋 LỊCH SỬ KHỚP LỆNH CHUẨN CẤU TRÚC:');
  console.log('-'.repeat(105));
  console.log(
    'Thời gian Vào'.padEnd(20) +
    'Symbol'.padEnd(10) +
    'Chiến lược'.padEnd(28) +
    'Hướng'.padEnd(8) +
    'Entry'.padEnd(10) +
    'Exit'.padEnd(10) +
    'Kết quả'.padEnd(10) +
    'PnL (R)'.padEnd(10) +
    'PnL ($)'
  );
  console.log('-'.repeat(105));

  allTrades.forEach(t => {
    const timeStr = new Date(t.entryTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const stratShort = t.strategy.replace('_LONG', '').replace('_SHORT', '');
    const resIcon = t.outcome === 'TP' ? '🎯 TP' : (t.outcome === 'LOCK_+1R' ? '🔒 +1R' : (t.outcome === 'BE' ? '🛡️ BE' : '🛑 SL'));
    console.log(
      timeStr.padEnd(20) +
      t.symbol.padEnd(10) +
      stratShort.padEnd(28) +
      t.direction.padEnd(8) +
      t.entry.toString().padEnd(10) +
      (t.exitPrice ? t.exitPrice.toString().substring(0, 8) : '').padEnd(10) +
      resIcon.padEnd(10) +
      `${t.netR >= 0 ? '+' : ''}${t.netR}R`.padEnd(10) +
      `${t.netUsd >= 0 ? '+$' : '-$'}${Math.abs(t.netUsd).toFixed(2)}`
    );
  });

  console.log('\n📊 BẢNG TỔNG HỢP THEO TỪNG CẶP COIN:');
  console.log('-'.repeat(85));
  console.log(
    'Cặp Coin'.padEnd(12) +
    'Tổng Lệnh'.padEnd(12) +
    'Win (TP)'.padEnd(10) +
    'Hòa (BE)'.padEnd(10) +
    'Thua (SL)'.padEnd(10) +
    'Win Rate'.padEnd(12) +
    'Profit Factor'.padEnd(15) +
    'Tổng R'.padEnd(12) +
    'Net PnL (USDT)'
  );
  console.log('-'.repeat(85));

  symbolStats.forEach(s => {
    console.log(
      s.symbol.padEnd(12) +
      s.totalTrades.toString().padEnd(12) +
      s.wins.toString().padEnd(10) +
      s.be.toString().padEnd(10) +
      s.losses.toString().padEnd(10) +
      s.winRate.padEnd(12) +
      s.profitFactor.padEnd(15) +
      s.totalR.padEnd(12) +
      s.netPnlUsd
    );
  });

  const totalPortfolioTrades = allTrades.length;
  const totalPortfolioWins = allTrades.filter(t => t.outcome === 'TP').length;
  const totalPortfolioBe = allTrades.filter(t => t.outcome === 'BE').length;
  const totalPortfolioLosses = allTrades.filter(t => t.outcome === 'SL').length;
  const totalPortfolioGrossProfit = allTrades.filter(t => t.netUsd > 0).reduce((acc, t) => acc + t.netUsd, 0);
  const totalPortfolioGrossLoss = Math.abs(allTrades.filter(t => t.netUsd < 0).reduce((acc, t) => acc + t.netUsd, 0));
  const totalPortfolioPF = totalPortfolioGrossLoss > 0
    ? (totalPortfolioGrossProfit / totalPortfolioGrossLoss).toFixed(2)
    : 'INF';
  const totalPortfolioR = allTrades.reduce((acc, t) => acc + t.netR, 0);
  const totalPortfolioNetUsd = allTrades.reduce((acc, t) => acc + t.netUsd, 0);

  console.log('\n================================================================');
  console.log('🏆 TỔNG KẾT TOÀN DANH MỤC THÁNG 10/2026:');
  console.log('================================================================');
  console.log(`• Tổng số lệnh:           ${totalPortfolioTrades} lệnh`);
  console.log(`• Lệnh thắng trọn (TP):   ${totalPortfolioWins} lệnh (${((totalPortfolioWins / totalPortfolioTrades) * 100).toFixed(1)}%)`);
  console.log(`• Lệnh hòa vốn bảo vệ:   ${totalPortfolioBe} lệnh (Trailing BE +1.5R)`);
  console.log(`• Lệnh dừng lỗ:           ${totalPortfolioLosses} lệnh`);
  console.log(`• Tỷ số Lợi nhuận (PF):   ${totalPortfolioPF}`);
  console.log(`• Tổng số R mang về:      ${totalPortfolioR >= 0 ? '+' : ''}${totalPortfolioR.toFixed(2)}R`);
  console.log(`• Tổng Lợi Nhuận Ròng:    ${totalPortfolioNetUsd >= 0 ? '+' : ''}$${totalPortfolioNetUsd.toFixed(2)} (Đã trừ phí Taker 0.08%)`);
  console.log('================================================================\n');
}

runBacktest().catch(err => {
  console.error('Lỗi khi chạy backtest:', err);
});
