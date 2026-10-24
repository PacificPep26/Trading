/**
 * BACKTEST_1YEAR.MJS
 * Khung kiểm thử Walk-Forward toàn diện 1 năm (01/10/2025 -> 22/10/2026).
 * 
 * Chuẩn hóa 100% theo phương pháp Smart Money / Demand-Supply Dr. Kane (EMA 34 & 89):
 * - Khử hoàn toàn Look-Ahead Bias: Chỉ dùng nến H4/H1 đã đóng nến trước thời điểm M15 hiện tại.
 * - Trailing Break-Even / Lock Profit tại +1.5R (khóa +1.0R lợi nhuận, gồng tới +2.0R).
 * - Giả định SL trước nếu giật cả 2 đầu trong cùng 1 nến M15.
 * - Phí Taker 0.08% khứ hồi, rủi ro cố định 1R = $10 / lệnh.
 * - Báo cáo chi tiết từng tháng (10/2025 -> 10/2026) và toàn bộ danh mục.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';
import { evaluateMarket, calculateSetupQualityScore } from '../src/engine.js';
import { BOT_CONFIG, UNIVERSE_CONFIG } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache_1year');

// Lấy trực tiếp danh mục từ UNIVERSE_CONFIG (Đã loại bỏ SOL theo khuyến nghị của Chuyên gia)
const BACKTEST_SYMBOLS = UNIVERSE_CONFIG.premierWatchlist.map(s => s.endsWith('-SWAP') ? s : s + '-SWAP');

const CONFIG = BOT_CONFIG;

const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const H4_MS = 4 * 60 * 60 * 1000;

// Bắt đầu backtest chính thức từ 01/10/2025 (dữ liệu tháng 09/2025 dùng để warmup EMA 89 và Pivots)
const START_BACKTEST_TS = new Date('2025-10-01T00:00:00Z').getTime();

export async function backtestSymbol(instId, btcH1Candles, btcH4Candles = null, customConfig = null) {
  const cfg = customConfig || CONFIG;
  const symbol = instId.replace('-SWAP', '');
  const fH4 = path.join(CACHE_DIR, `${instId}_4H.json`);
  const fH1 = path.join(CACHE_DIR, `${instId}_1H.json`);
  const fM15 = path.join(CACHE_DIR, `${instId}_15m.json`);

  if (!fs.existsSync(fH4) || !fs.existsSync(fH1) || !fs.existsSync(fM15)) {
    console.warn(`[WARN] Thiếu dữ liệu cache 1 năm cho ${instId}`);
    return [];
  }

  const candlesH4 = JSON.parse(fs.readFileSync(fH4, 'utf8')).map(normalizeCandle);
  const candlesH1 = JSON.parse(fs.readFileSync(fH1, 'utf8')).map(normalizeCandle);
  const candlesM15 = JSON.parse(fs.readFileSync(fM15, 'utf8')).map(normalizeCandle);

  const closedTrades = [];
  let activeTrade = null;

  // Tìm index M15 bắt đầu từ 01/10/2025
  let startIndex = candlesM15.findIndex(c => c.ts >= START_BACKTEST_TS);
  if (startIndex < 50) startIndex = 50;

  // Pointers tối ưu hiệu năng O(1)
  let h4Pointer = 0;
  let h1Pointer = 0;
  let btcH1Pointer = 0;
  let btcH4Pointer = 0;

  for (let i = startIndex; i < candlesM15.length; i++) {
    const currentM15 = candlesM15[i];
    const m15CloseTime = currentM15.ts + M15_MS;

    // 1. Quản lý vị thế đang mở
    if (activeTrade) {
      activeTrade.barsHeld++;
      const isLong = activeTrade.direction === 'LONG';
      const riskDist = Math.abs(activeTrade.entry - activeTrade.initialStopLoss);

      // Trailing Lock Profit: Khi chạm +1.5R -> Kéo SL lên dương +1.0R (khóa 1R, gồng tới 2R)
      const favorablePrice = isLong ? currentM15.high : currentM15.low;
      const curMaxR = isLong
        ? (favorablePrice - activeTrade.entry) / riskDist
        : (activeTrade.entry - favorablePrice) / riskDist;

      if (!activeTrade.isProfitLocked && curMaxR >= cfg.beTriggerR) {
        activeTrade.isProfitLocked = true;
        activeTrade.stopLoss = isLong
          ? activeTrade.entry + (cfg.lockProfitR * riskDist)
          : activeTrade.entry - (cfg.lockProfitR * riskDist);
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
        const fee = activeTrade.sizing.notional * cfg.feeRate;
        const netPnl = grossPnl - fee;
        const netR = activeTrade.isProfitLocked ? cfg.lockProfitR : -1.0;

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
        const fee = activeTrade.sizing.notional * cfg.feeRate;
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

    // 2. Quét tín hiệu vào lệnh mới nếu chưa có vị thế
    if (!activeTrade) {
      // Cập nhật pointers để lọc hoàn toàn Look-Ahead Bias cực nhanh
      while (h4Pointer + 1 < candlesH4.length && candlesH4[h4Pointer + 1].ts + H4_MS <= m15CloseTime) {
        h4Pointer++;
      }
      while (h1Pointer + 1 < candlesH1.length && candlesH1[h1Pointer + 1].ts + H1_MS <= m15CloseTime) {
        h1Pointer++;
      }
      if (btcH1Candles && btcH1Candles.length > 0) {
        while (btcH1Pointer + 1 < btcH1Candles.length && btcH1Candles[btcH1Pointer + 1].ts + H1_MS <= m15CloseTime) {
          btcH1Pointer++;
        }
      }
      if (btcH4Candles && btcH4Candles.length > 0) {
        while (btcH4Pointer + 1 < btcH4Candles.length && btcH4Candles[btcH4Pointer + 1].ts + H4_MS <= m15CloseTime) {
          btcH4Pointer++;
        }
      }

      // Đảm bảo đủ nến làm ấm (EMA 89 cần ~90 nến H4)
      if (h4Pointer >= 90 && h1Pointer >= 15 && i >= 5) {
        const h4Start = Math.max(0, h4Pointer - 150);
        const visibleH4 = candlesH4.slice(h4Start, h4Pointer + 1);

        const h1Start = Math.max(0, h1Pointer - 40);
        const visibleH1 = candlesH1.slice(h1Start, h1Pointer + 1);

        const m15Start = Math.max(0, i - 40);
        const visibleM15 = candlesM15.slice(m15Start, i + 1);

        let visibleBtcH1 = null;
        if (btcH1Candles && btcH1Candles.length > 0 && btcH1Pointer >= 15) {
          const btcStart = Math.max(0, btcH1Pointer - 40);
          visibleBtcH1 = btcH1Candles.slice(btcStart, btcH1Pointer + 1);
        }

        let visibleBtcH4 = null;
        if (btcH4Candles && btcH4Candles.length > 0 && btcH4Pointer >= 35) {
          const btcH4Start = Math.max(0, btcH4Pointer - 100);
          visibleBtcH4 = btcH4Candles.slice(btcH4Start, btcH4Pointer + 1);
        }

        const signal = evaluateMarket({
          symbol,
          candlesH4: visibleH4,
          candlesH1: visibleH1,
          candlesM15: visibleM15,
          btcH1Candles: visibleBtcH1,
          btcH4Candles: visibleBtcH4,
          config: cfg
        });

        // Áp đúng cổng chấm điểm chất lượng Setup như server.js live để backtest
        // phản ánh trung thực điều kiện vào lệnh thực tế (không nhận tín hiệu thô).
        if (signal && !signal.isBlocked) {
          const quality = calculateSetupQualityScore({
            signal,
            candlesH4: visibleH4,
            candlesH1: visibleH1,
            candlesM15: visibleM15,
            btcH1Candles: visibleBtcH1
          });
          const minScore = cfg.minSetupQualityScore || 75;
          if (quality.score >= minScore) {
            activeTrade = {
              ...signal,
              qualityScore: quality.score,
              entryTime: currentM15.ts,
              initialStopLoss: signal.stopLoss,
              isProfitLocked: false,
              barsHeld: 0
            };
          }
        }
      }
    }
  }

  return closedTrades;
}

export function calculateMetrics(trades) {
  if (!trades || trades.length === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      locks: 0,
      losses: 0,
      winRate: '0.0%',
      profitFactor: '0.00',
      totalR: '0.00R',
      netPnlUsd: '$0.00',
      maxDrawdownR: '0.00R',
      maxDrawdownUsd: '$0.00'
    };
  }

  const wins = trades.filter(t => t.outcome === 'TP');
  const locks = trades.filter(t => t.outcome === 'LOCK_+1R');
  const losses = trades.filter(t => t.outcome === 'SL');

  const winRate = (((wins.length + locks.length) / trades.length) * 100).toFixed(1) + '%';
  const grossProfit = trades.filter(t => t.netUsd > 0).reduce((acc, t) => acc + t.netUsd, 0);
  const grossLoss = Math.abs(trades.filter(t => t.netUsd < 0).reduce((acc, t) => acc + t.netUsd, 0));
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? 'INF' : '0.00');

  const totalR = trades.reduce((acc, t) => acc + t.netR, 0);
  const netPnlUsd = trades.reduce((acc, t) => acc + t.netUsd, 0);

  // Tính Max Drawdown (R & USD)
  let peakR = 0;
  let curCumR = 0;
  let maxDdR = 0;

  let peakUsd = 0;
  let curCumUsd = 0;
  let maxDdUsd = 0;

  trades.forEach(t => {
    curCumR += t.netR;
    if (curCumR > peakR) peakR = curCumR;
    const ddR = peakR - curCumR;
    if (ddR > maxDdR) maxDdR = ddR;

    curCumUsd += t.netUsd;
    if (curCumUsd > peakUsd) peakUsd = curCumUsd;
    const ddUsd = peakUsd - curCumUsd;
    if (ddUsd > maxDdUsd) maxDdUsd = ddUsd;
  });

  return {
    totalTrades: trades.length,
    wins: wins.length,
    locks: locks.length,
    losses: losses.length,
    winRate,
    profitFactor,
    totalR: `${totalR >= 0 ? '+' : ''}${totalR.toFixed(2)}R`,
    netPnlUsd: `${netPnlUsd >= 0 ? '+' : ''}$${netPnlUsd.toFixed(2)}`,
    maxDrawdownR: `-${maxDdR.toFixed(2)}R`,
    maxDrawdownUsd: `-$${maxDdUsd.toFixed(2)}`,
    rawTotalR: totalR,
    rawNetUsd: netPnlUsd
  };
}

export function groupTradesByMonth(trades) {
  const monthsMap = new Map();

  trades.forEach(t => {
    const d = new Date(t.entryTime);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!monthsMap.has(key)) {
      monthsMap.set(key, []);
    }
    monthsMap.get(key).push(t);
  });

  const sortedMonths = Array.from(monthsMap.keys()).sort();
  const result = [];

  for (const m of sortedMonths) {
    const mTrades = monthsMap.get(m);
    const metrics = calculateMetrics(mTrades);
    result.push({
      month: m,
      ...metrics
    });
  }

  return result;
}

async function run1YearBacktest() {
  console.log('================================================================');
  console.log('🏆 KẾT QUẢ KIỂM THỬ THỰC CHIẾN 1 NĂM (10/2025 -> 10/2026)');
  console.log(`Quy tắc: 100% Chống Look-Ahead Bias | Trailing +${CONFIG.beTriggerR}R Lock +${CONFIG.lockProfitR}R | Phí ${CONFIG.feeRate * 100}%`);
  console.log('================================================================\n');

  // Đọc BTC H1 và H4 làm khiên Macro Shield & Đầu Tàu
  const btcH1File = path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json');
  const btcH4File = path.join(CACHE_DIR, 'BTC-USDT-SWAP_4H.json');
  let btcH1 = [];
  let btcH4 = [];
  if (fs.existsSync(btcH1File)) {
    btcH1 = JSON.parse(fs.readFileSync(btcH1File, 'utf8')).map(normalizeCandle);
  }
  if (fs.existsSync(btcH4File)) {
    btcH4 = JSON.parse(fs.readFileSync(btcH4File, 'utf8')).map(normalizeCandle);
  }

  const allTrades = [];
  const symbolStats = [];

  const symbolsToRun = process.argv[2] ? [process.argv[2]] : BACKTEST_SYMBOLS;

  for (const instId of symbolsToRun) {
    const trades = await backtestSymbol(instId, btcH1, btcH4);
    allTrades.push(...trades);
    const m = calculateMetrics(trades);
    symbolStats.push({
      symbol: instId.replace('-SWAP', ''),
      ...m
    });
  }

  allTrades.sort((a, b) => a.entryTime - b.entryTime);

  // 1. Thống kê theo từng Cặp Coin
  console.log('📊 HIỆU SUẤT THEO TỪNG CẶP COIN (1 NĂM):');
  console.log('-'.repeat(80));
  console.log(
    'Symbol'.padEnd(12) +
    'Số Lệnh'.padEnd(10) +
    'Thắng (TP)'.padEnd(12) +
    'Khóa Lãi'.padEnd(12) +
    'Thua (SL)'.padEnd(12) +
    'Win Rate'.padEnd(12) +
    'Total R'.padEnd(12) +
    'Net USD'
  );
  console.log('-'.repeat(80));
  symbolStats.forEach(s => {
    console.log(
      s.symbol.padEnd(12) +
      s.totalTrades.toString().padEnd(10) +
      s.wins.toString().padEnd(12) +
      s.locks.toString().padEnd(12) +
      s.losses.toString().padEnd(12) +
      s.winRate.padEnd(12) +
      s.totalR.padEnd(12) +
      s.netPnlUsd
    );
  });
  console.log('-'.repeat(80));

  // 2. Thống kê theo từng Tháng (Month-by-Month breakdown)
  const monthlyStats = groupTradesByMonth(allTrades);
  console.log('\n📅 BẢNG THỐNG KÊ CHI TIẾT TỪNG THÁNG (10/2025 -> 10/2026):');
  console.log('-'.repeat(90));
  console.log(
    'Tháng'.padEnd(12) +
    'Số Lệnh'.padEnd(10) +
    'Thắng (TP)'.padEnd(12) +
    'Khóa Lãi'.padEnd(12) +
    'Thua (SL)'.padEnd(12) +
    'Win Rate'.padEnd(12) +
    'Lợi Nhuận (R)'.padEnd(16) +
    'Net USD'.padEnd(12) +
    'Max Drawdown'
  );
  console.log('-'.repeat(90));
  monthlyStats.forEach(m => {
    console.log(
      m.month.padEnd(12) +
      m.totalTrades.toString().padEnd(10) +
      m.wins.toString().padEnd(12) +
      m.locks.toString().padEnd(12) +
      m.losses.toString().padEnd(12) +
      m.winRate.padEnd(12) +
      m.totalR.padEnd(16) +
      m.netPnlUsd.padEnd(12) +
      m.maxDrawdownR
    );
  });
  console.log('-'.repeat(90));

  // 3. Tổng kết toàn diện Danh mục
  const totalSummary = calculateMetrics(allTrades);
  console.log('\n================================================================');
  console.log('🎯 TỔNG KẾT TOÀN DIỆN CHIẾN LƯỢC (1 NĂM QUA):');
  console.log(`• Tổng số lệnh đã đi: ${totalSummary.totalTrades} lệnh`);
  console.log(`• Số lệnh chốt Target 🎯 TP (+2R): ${totalSummary.wins}`);
  console.log(`• Số lệnh Trailing khóa lãi 🔒 (+${CONFIG.lockProfitR}R): ${totalSummary.locks}`);
  console.log(`• Số lệnh chạm cắt lỗ 🛑 SL (-1R): ${totalSummary.losses}`);
  console.log(`• Tỷ Lệ Thắng (Win Rate): ${totalSummary.winRate}`);
  console.log(`• Hệ số Lợi Nhuận (Profit Factor): ${totalSummary.profitFactor}`);
  console.log(`• Tổng Số R Kiếm Được: ${totalSummary.totalR}`);
  console.log(`• Lợi Nhuận Ròng ($10 risk/lệnh): ${totalSummary.netPnlUsd}`);
  console.log(`• Max Drawdown Sụt Giảm Tối Đa: ${totalSummary.maxDrawdownR} (${totalSummary.maxDrawdownUsd})`);
  console.log('================================================================\n');
}

if (process.argv[1] && process.argv[1].endsWith('backtest_1year.mjs')) {
  run1YearBacktest().catch(console.error);
}

