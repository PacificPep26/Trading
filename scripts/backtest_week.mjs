/**
 * BACKTEST_WEEK.MJS
 * Khung kiểm thử chuyên sâu cho TUẦN NÀY (Từ Thứ Hai 19/10/2026 00:00:00 -> Hôm nay 22/10/2026).
 * Đánh giá chi tiết từng lệnh:
 * - Tỷ lệ thắng (Win Rate)
 * - Tỷ số R mang về (Net R)
 * - Lợi nhuận thực nhận sau phí Taker (Net PnL USDT)
 * - Đánh giá hiệu quả của SMC Inducement & Kane Swing
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
  lockProfitR: 1.0,
  beBufferRate: 0.0008
};

const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const H4_MS = 4 * 60 * 60 * 1000;

// Đầu tuần này: Thứ Hai ngày 19/10/2026 lúc 00:00:00 GMT+7 = 18/10/2026 17:00:00 UTC
const START_WEEK_TS = new Date('2026-10-18T17:00:00Z').getTime();

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
  // Bắt đầu quét từ 01/10 để đảm bảo đủ dữ liệu chỉ báo, nhưng lọc trade trong tuần
  const startIndex = candlesM15.findIndex(c => c.ts >= START_WEEK_TS - (14 * 24 * 3600 * 1000));
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
          exitTime: currentM15.ts,
          exitPrice,
          outcome: activeTrade.isProfitLocked ? 'LOCK_1R' : 'SL',
          pnlR: netR,
          netPnl
        });
        activeTrade = null;
        continue;
      }

      if (isTPHit) {
        const exitPrice = activeTrade.takeProfit;
        const grossPnl = isLong
          ? (exitPrice - activeTrade.entry) * activeTrade.sizing.size
          : (activeTrade.entry - exitPrice) * activeTrade.sizing.size;
        const fee = activeTrade.sizing.notional * CONFIG.feeRate;
        const netPnl = grossPnl - fee;
        const netR = (Math.abs(exitPrice - activeTrade.entry)) / riskDist;

        closedTrades.push({
          ...activeTrade,
          exitTime: currentM15.ts,
          exitPrice,
          outcome: 'TP',
          pnlR: parseFloat(netR.toFixed(2)),
          netPnl
        });
        activeTrade = null;
        continue;
      }

      // Time-Stop: 16 nến M15 (4 tiếng) nếu lình xình thì tất toán
      if (activeTrade.barsHeld >= CONFIG.timeStopBars) {
        const exitPrice = currentM15.close;
        const grossPnl = isLong
          ? (exitPrice - activeTrade.entry) * activeTrade.sizing.size
          : (activeTrade.entry - exitPrice) * activeTrade.sizing.size;
        const fee = activeTrade.sizing.notional * CONFIG.feeRate;
        const netPnl = grossPnl - fee;
        const netR = grossPnl / (riskDist * activeTrade.sizing.size);

        closedTrades.push({
          ...activeTrade,
          exitTime: currentM15.ts,
          exitPrice,
          outcome: 'TIME_STOP',
          pnlR: parseFloat(netR.toFixed(2)),
          netPnl
        });
        activeTrade = null;
        continue;
      }
    }

    // 2. Tìm kiếm tín hiệu mới
    if (!activeTrade) {
      const closedH4 = candlesH4.filter(c => (c.ts + H4_MS) <= m15CloseTime);
      const closedH1 = candlesH1.filter(c => (c.ts + H1_MS) <= m15CloseTime);
      const m15Slice = candlesM15.slice(0, i + 1);

      if (closedH4.length < 90 || closedH1.length < 15 || m15Slice.length < 5) {
        continue;
      }

      const btcSlice = btcH1Candles ? btcH1Candles.filter(c => (c.ts + H1_MS) <= m15CloseTime) : null;

      const signal = evaluateMarket({
        symbol,
        candlesH4: closedH4,
        candlesH1: closedH1,
        candlesM15: m15Slice,
        btcH1Candles: btcSlice,
        config: CONFIG
      });

      if (signal && !signal.isBlocked) {
        activeTrade = {
          symbol,
          direction: signal.direction,
          strategy: signal.strategy,
          entry: signal.entry,
          stopLoss: signal.stopLoss,
          initialStopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          riskReward: signal.riskReward,
          sizing: signal.sizing,
          isProfitLocked: false,
          entryTime: currentM15.ts,
          barsHeld: 0
        };
      }
    }
  }

  // Lọc chỉ lấy các lệnh mở trong TUẦN NÀY (từ 19/10/2026 trở đi)
  return closedTrades.filter(t => t.entryTime >= START_WEEK_TS);
}

async function run() {
  console.log('================================================================');
  console.log('🏆 KẾT QUẢ KIỂM THỬ THỰC CHIẾN TUẦN NÀY (19/10/2026 - 22/10/2026)');
  console.log('Hệ thống: Kane Sonic R H4/M15 & SMC 2-Tier Liquidity Engine');
  console.log('================================================================\n');

  // Lấy BTC H1 làm khiên vĩ mô
  const btcH1File = path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H_october.json');
  const btcH1 = fs.existsSync(btcH1File)
    ? JSON.parse(fs.readFileSync(btcH1File, 'utf8')).map(normalizeCandle)
    : [];

  const allTrades = [];

  for (const sym of BACKTEST_SYMBOLS) {
    const trades = await backtestSymbol(sym, btcH1);
    allTrades.push(...trades);
  }

  // Sắp xếp theo thứ tự thời gian vào lệnh
  allTrades.sort((a, b) => a.entryTime - b.entryTime);

  console.log('📋 CHI TIẾT LỊCH SỬ TỪNG LỆNH KHỚP TRONG TUẦN NÀY:');
  console.log('---------------------------------------------------------------------------------------------------------');
  console.log('Thời gian Vào       Symbol    Chiến lược                  Hướng   Entry     Exit      Kết quả   PnL (R)   PnL ($)');
  console.log('---------------------------------------------------------------------------------------------------------');

  let totalR = 0;
  let totalUsd = 0;
  let winCount = 0;
  let beCount = 0;
  let slCount = 0;

  const coinStats = {};

  for (const t of allTrades) {
    const timeStr = new Date(t.entryTime).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    const isWin = t.outcome === 'TP';
    const isBE = t.outcome === 'LOCK_1R';
    const isSL = t.outcome === 'SL' || (t.outcome === 'TIME_STOP' && t.pnlR < 0);

    if (isWin) winCount++;
    else if (isBE) beCount++;
    else if (isSL) slCount++;

    totalR += t.pnlR;
    totalUsd += t.netPnl;

    const sym = t.symbol;
    if (!coinStats[sym]) {
      coinStats[sym] = { total: 0, win: 0, be: 0, sl: 0, r: 0, usd: 0 };
    }
    coinStats[sym].total++;
    if (isWin) coinStats[sym].win++;
    if (isBE) coinStats[sym].be++;
    if (isSL) coinStats[sym].sl++;
    coinStats[sym].r += t.pnlR;
    coinStats[sym].usd += t.netPnl;

    const outcomeIcon = isWin ? '🎯 TP' : (isBE ? '🔒 +1R' : (t.outcome === 'TIME_STOP' ? '⏱️ TS' : '🛑 SL'));
    const pnlRStr = `${t.pnlR >= 0 ? '+' : ''}${t.pnlR.toFixed(2)}R`.padEnd(9);
    const pnlUsdStr = `${t.netPnl >= 0 ? '+$' : '-$'}${Math.abs(t.netPnl).toFixed(2)}`;

    console.log(
      `${timeStr}  ` +
      `${t.symbol.padEnd(10)}` +
      `${t.strategy.padEnd(28)}` +
      `${t.direction.padEnd(8)}` +
      `${t.entry.toString().padEnd(10)}` +
      `${t.exitPrice.toFixed(t.exitPrice < 10 ? 4 : 2).padEnd(10)}` +
      `${outcomeIcon.padEnd(10)}` +
      `${pnlRStr} ` +
      `${pnlUsdStr}`
    );
  }

  console.log('---------------------------------------------------------------------------------------------------------\n');

  console.log('📊 BẢNG TỔNG HỢP THEO TỪNG CẶP COIN TUẦN NÀY:');
  console.log('-------------------------------------------------------------------------------------');
  console.log('Cặp Coin    Tổng Lệnh   Win (TP)  Khóa (+1R)  Thua (SL) Win Rate    Tổng R      Net PnL (USDT)');
  console.log('-------------------------------------------------------------------------------------');

  for (const [sym, st] of Object.entries(coinStats)) {
    const winRate = st.total > 0 ? (((st.win + st.be) / st.total) * 100).toFixed(1) : 0;
    console.log(
      `${sym.padEnd(12)}` +
      `${st.total.toString().padEnd(12)}` +
      `${st.win.toString().padEnd(10)}` +
      `${st.be.toString().padEnd(12)}` +
      `${st.sl.toString().padEnd(10)}` +
      `${(winRate + '%').padEnd(12)}` +
      `${(st.r >= 0 ? '+' : '') + st.r.toFixed(2)}R`.padEnd(12) +
      `${st.usd >= 0 ? '+$' : '-$'}${Math.abs(st.usd).toFixed(2)}`
    );
  }

  console.log('\n================================================================');
  console.log('🏆 TỔNG KẾT TUẦN NÀY (19/10 - 22/10/2026):');
  console.log('================================================================');
  console.log(`• Tổng số lệnh:           ${allTrades.length} lệnh`);
  console.log(`• Lệnh thắng trọn (TP):   ${winCount} lệnh`);
  console.log(`• Lệnh Khóa Lãi (+1.0R):  ${beCount} lệnh`);
  console.log(`• Lệnh dừng lỗ (SL):      ${slCount} lệnh`);
  const effectiveWinRate = allTrades.length > 0 ? (((winCount + beCount) / allTrades.length) * 100).toFixed(1) : 0;
  console.log(`• Tỷ lệ Lệnh Có Lãi:      ${effectiveWinRate}%`);
  console.log(`• Tổng số R mang về:      ${totalR >= 0 ? '+' : ''}${totalR.toFixed(2)}R`);
  console.log(`• Tổng Lợi Nhuận Ròng:    ${totalUsd >= 0 ? '+$' : '-$'}${Math.abs(totalUsd).toFixed(2)} USDT (Đã trừ phí Taker 0.08%)`);
  console.log('================================================================\n');
}

run().catch(console.error);

