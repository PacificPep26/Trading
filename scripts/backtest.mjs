/**
 * BACKTEST.MJS
 * Khung kiểm thử Walk-Forward trên nến lịch sử thực tế từ OKX API.
 * Mô phỏng chính xác phí sàn Taker 0.08%, dời BE tại +1.5R, Time-Stop 16 nến.
 * Chạy lệnh: npm run backtest
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { evaluateMarket, DEFAULT_CONFIG } from '../src/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const BACKTEST_SYMBOLS = [
  'BTC-USDT-SWAP',
  'ETH-USDT-SWAP',
  'SOL-USDT-SWAP',
  'WLD-USDT-SWAP',
  'DOGE-USDT-SWAP',
  'SUI-USDT-SWAP'
];

const CONFIG = {
  ...DEFAULT_CONFIG,
  riskUsd: 10.0,
  leverage: 10,
  feeRate: 0.0008,          // Phí Taker khứ hồi 0.08%
  minRR: 2.0,
  beTriggerR: 1.5,
  beBufferRate: 0.0008,
  timeStopBars: 16
};

/**
 * Tải nến với cơ chế phân trang và Cache cục bộ
 * @param {string} instId 
 * @param {string} bar 
 * @param {number} pages 
 * @returns {Promise<Array>}
 */
async function fetchCandlesWithCache(instId, bar, pages = 3) {
  const cacheFile = path.join(CACHE_DIR, `${instId}_${bar}.json`);
  const now = Date.now();

  // Dùng cache nếu chưa quá 60 phút
  if (fs.existsSync(cacheFile)) {
    try {
      const stat = fs.statSync(cacheFile);
      if (now - stat.mtimeMs < 60 * 60 * 1000) {
        const raw = fs.readFileSync(cacheFile, 'utf8');
        return JSON.parse(raw);
      }
    } catch {
      // Bỏ qua lỗi đọc cache
    }
  }

  let allRaw = [];
  let after = '';

  for (let p = 0; p < pages; p++) {
    const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=100${after ? '&after=' + after : ''}`;
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (!json.data || json.data.length === 0) break;
      allRaw.push(...json.data);
      after = json.data[json.data.length - 1][0];
    } catch (err) {
      console.error(`Lỗi tải ${instId} ${bar}:`, err.message);
      break;
    }
  }

  // Khử trùng lặp và sắp xếp theo thời gian tăng dần
  const seen = new Set();
  const candles = [];
  for (const c of allRaw) {
    const ts = parseInt(c[0], 10);
    if (!seen.has(ts)) {
      seen.add(ts);
      candles.push({
        ts,
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        vol: parseFloat(c[5])
      });
    }
  }

  candles.sort((a, b) => a.ts - b.ts);

  try {
    fs.writeFileSync(cacheFile, JSON.stringify(candles), 'utf8');
  } catch (err) {
    console.error('Lỗi ghi cache:', err.message);
  }

  return candles;
}

/**
 * Chạy mô phỏng Backtest cho 1 cặp coin
 * @param {string} instId 
 * @param {Array} btcH1Candles 
 * @returns {Promise<Array>} Danh sách các lệnh đã đóng
 */
async function backtestSymbol(instId, btcH1Candles) {
  const symbol = instId.replace('-SWAP', '');
  console.log(`[BACKTEST] Đang tải dữ liệu cho ${symbol}...`);

  // Tải nến H4 (3 trang ~ 300 nến), H1 (3 trang ~ 300 nến), M15 (5 trang ~ 500 nến)
  const [candlesH4, candlesH1, candlesM15] = await Promise.all([
    fetchCandlesWithCache(instId, '4H', 3),
    fetchCandlesWithCache(instId, '1H', 3),
    fetchCandlesWithCache(instId, '15m', 5)
  ]);

  if (candlesH4.length < 25 || candlesH1.length < 20 || candlesM15.length < 50) {
    console.warn(`[CẢNH BÁO] Không đủ nến cho ${symbol}. H4: ${candlesH4.length}, H1: ${candlesH1.length}, M15: ${candlesM15.length}`);
    return [];
  }

  console.log(`[BACKTEST] Bắt đầu mô phỏng ${symbol}: ${candlesM15.length} nến M15 (${new Date(candlesM15[0].ts).toLocaleDateString('vi-VN')} -> ${new Date(candlesM15[candlesM15.length - 1].ts).toLocaleDateString('vi-VN')})`);

  const closedTrades = [];
  let activeTrade = null;

  // Trượt từng nến M15 (Walk-Forward)
  for (let i = 30; i < candlesM15.length; i++) {
    const currentM15 = candlesM15[i];
    const currentTs = currentM15.ts;

    // 1. Quản lý vị thế đang mở nếu có
    if (activeTrade) {
      activeTrade.barsHeld++;
      const isLong = activeTrade.direction === 'LONG';
      const riskDist = Math.abs(activeTrade.entry - activeTrade.initialStopLoss);

      // Kiểm tra giá đỉnh/đáy trong nến M15
      const favorablePrice = isLong ? currentM15.high : currentM15.low;
      const unfavorablePrice = isLong ? currentM15.low : currentM15.high;

      // Tính khoảng cách lợi nhuận tối đa đạt được trong nến
      const maxFavorableR = isLong
        ? (favorablePrice - activeTrade.entry) / riskDist
        : (activeTrade.entry - favorablePrice) / riskDist;

      // Kích hoạt Dời Stop Loss về Hòa vốn (+1.5R)
      if (!activeTrade.isBreakevenMoved && maxFavorableR >= CONFIG.beTriggerR) {
        activeTrade.isBreakevenMoved = true;
        activeTrade.stopLoss = isLong
          ? activeTrade.entry * (1 + CONFIG.beBufferRate)
          : activeTrade.entry * (1 - CONFIG.beBufferRate);
      }

      // Kiểm tra Chốt lời (Take Profit)
      const isTPHit = isLong ? (currentM15.high >= activeTrade.takeProfit) : (currentM15.low <= activeTrade.takeProfit);
      if (isTPHit) {
        const exitPrice = activeTrade.takeProfit;
        const grossPnl = isLong
          ? (exitPrice - activeTrade.entry) * activeTrade.sizing.size
          : (activeTrade.entry - exitPrice) * activeTrade.sizing.size;
        const fee = activeTrade.sizing.notional * CONFIG.feeRate;
        const netPnl = grossPnl - fee;
        const netR = riskDist > 0 ? (grossPnl / CONFIG.riskUsd) : 0;

        closedTrades.push({
          ...activeTrade,
          exitTime: currentTs,
          exitPrice,
          outcome: 'TP',
          netR: parseFloat(netR.toFixed(2)),
          netUsd: parseFloat(netPnl.toFixed(2))
        });

        activeTrade = null;
        continue;
      }

      // Kiểm tra Dừng lỗ (Stop Loss / Breakeven)
      const isSLHit = isLong ? (currentM15.low <= activeTrade.stopLoss) : (currentM15.high >= activeTrade.stopLoss);
      if (isSLHit) {
        const exitPrice = activeTrade.stopLoss;
        const grossPnl = isLong
          ? (exitPrice - activeTrade.entry) * activeTrade.sizing.size
          : (activeTrade.entry - exitPrice) * activeTrade.sizing.size;
        const fee = activeTrade.sizing.notional * CONFIG.feeRate;
        const netPnl = grossPnl - fee;
        const netR = riskDist > 0 ? (grossPnl / CONFIG.riskUsd) : -1;

        closedTrades.push({
          ...activeTrade,
          exitTime: currentTs,
          exitPrice,
          outcome: activeTrade.isBreakevenMoved ? 'BE' : 'SL',
          netR: parseFloat(netR.toFixed(2)),
          netUsd: parseFloat(netPnl.toFixed(2))
        });

        activeTrade = null;
        continue;
      }

      // Kiểm tra Time-Stop (16 nến M15 lình xình)
      if (activeTrade.barsHeld >= CONFIG.timeStopBars) {
        const curR = isLong
          ? (currentM15.close - activeTrade.entry) / riskDist
          : (activeTrade.entry - currentM15.close) / riskDist;

        if (Math.abs(curR) <= 0.3) {
          const exitPrice = currentM15.close;
          const grossPnl = isLong
            ? (exitPrice - activeTrade.entry) * activeTrade.sizing.size
            : (activeTrade.entry - exitPrice) * activeTrade.sizing.size;
          const fee = activeTrade.sizing.notional * CONFIG.feeRate;
          const netPnl = grossPnl - fee;
          const netR = riskDist > 0 ? (grossPnl / CONFIG.riskUsd) : 0;

          closedTrades.push({
            ...activeTrade,
            exitTime: currentTs,
            exitPrice,
            outcome: 'TIME_STOP',
            netR: parseFloat(netR.toFixed(2)),
            netUsd: parseFloat(netPnl.toFixed(2))
          });

          activeTrade = null;
          continue;
        }
      }
    }

    // 2. Nếu chưa có lệnh mở, tìm kiếm tín hiệu mới
    if (!activeTrade) {
      // Chỉ lấy nến H4 và H1 đã đóng trước thời điểm nến M15 hiện tại
      const h4Slice = candlesH4.filter(c => c.ts <= currentTs);
      const h1Slice = candlesH1.filter(c => c.ts <= currentTs);
      const m15Slice = candlesM15.slice(0, i + 1);
      const btcSlice = btcH1Candles ? btcH1Candles.filter(c => c.ts <= currentTs) : null;

      if (h4Slice.length < 20 || h1Slice.length < 15) continue;

      const signal = evaluateMarket({
        symbol,
        candlesH4: h4Slice,
        candlesH1: h1Slice,
        candlesM15: m15Slice,
        btcH1Candles: btcSlice,
        config: CONFIG
      });

      if (signal && !signal.isBlocked) {
        activeTrade = {
          symbol,
          strategy: signal.strategy,
          direction: signal.direction,
          entryTime: currentTs,
          entry: signal.entry,
          stopLoss: signal.stopLoss,
          initialStopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          riskReward: signal.riskReward,
          sizing: signal.sizing,
          isBreakevenMoved: false,
          barsHeld: 0
        };
      }
    }
  }

  return closedTrades;
}

/**
 * Tính toán các chỉ số thống kê hiệu suất
 * @param {Array} trades 
 */
function calculateMetrics(trades) {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      be: 0,
      losses: 0,
      timeStops: 0,
      winRate: '0.00%',
      profitFactor: '0.00',
      totalR: '0.00R',
      netPnlUsd: '$0.00',
      maxDrawdownUsd: '$0.00',
      maxDrawdownR: '0.00R'
    };
  }

  const wins = trades.filter(t => t.outcome === 'TP');
  const be = trades.filter(t => t.outcome === 'BE');
  const losses = trades.filter(t => t.outcome === 'SL');
  const timeStops = trades.filter(t => t.outcome === 'TIME_STOP');

  const winRate = ((wins.length / trades.length) * 100).toFixed(1) + '%';

  const grossProfit = trades.filter(t => t.netUsd > 0).reduce((acc, t) => acc + t.netUsd, 0);
  const grossLoss = Math.abs(trades.filter(t => t.netUsd < 0).reduce((acc, t) => acc + t.netUsd, 0));
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? 'INF' : '0.00');

  const totalR = trades.reduce((acc, t) => acc + t.netR, 0);
  const netPnlUsd = trades.reduce((acc, t) => acc + t.netUsd, 0);

  // Tính Max Drawdown
  let peak = 0;
  let maxDdUsd = 0;
  let peakR = 0;
  let maxDdR = 0;
  let runningPnl = 0;
  let runningR = 0;

  for (const t of trades) {
    runningPnl += t.netUsd;
    runningR += t.netR;

    if (runningPnl > peak) peak = runningPnl;
    const ddUsd = peak - runningPnl;
    if (ddUsd > maxDdUsd) maxDdUsd = ddUsd;

    if (runningR > peakR) peakR = runningR;
    const ddR = peakR - runningR;
    if (ddR > maxDdR) maxDdR = ddR;
  }

  return {
    totalTrades: trades.length,
    wins: wins.length,
    be: be.length,
    losses: losses.length,
    timeStops: timeStops.length,
    winRate,
    profitFactor,
    totalR: `${totalR >= 0 ? '+' : ''}${totalR.toFixed(2)}R`,
    netPnlUsd: `${netPnlUsd >= 0 ? '+' : ''}$${netPnlUsd.toFixed(2)}`,
    maxDrawdownUsd: `-$${maxDdUsd.toFixed(2)}`,
    maxDrawdownR: `-${maxDdR.toFixed(2)}R`
  };
}

/**
 * Hàm Backtest toàn diện đa cặp Altcoin
 */
async function runAllBacktests() {
  console.log('================================================================');
  console.log('🚀 BẮT ĐẦU BACKTEST ĐA CẶP CRYPTO FUTURES (H4/M15 SWING & LIQUIDITY)');
  console.log(`⚙️ Rủi ro 1R: $${CONFIG.riskUsd} | Đòn bẩy: ${CONFIG.leverage}X | Phí Taker: ${(CONFIG.feeRate * 100).toFixed(2)}% | R:R >= ${CONFIG.minRR}`);
  console.log('================================================================\n');

  // Tải trước nến BTC 1H làm khiên bảo vệ
  const btcH1 = await fetchCandlesWithCache('BTC-USDT-SWAP', '1H', 3);

  const allTrades = [];
  const symbolStats = [];

  for (const instId of BACKTEST_SYMBOLS) {
    const trades = await backtestSymbol(instId, btcH1);
    allTrades.push(...trades);
    const metrics = calculateMetrics(trades);
    symbolStats.push({
      symbol: instId.replace('-SWAP', ''),
      trades: trades.length,
      ...metrics
    });
  }

  // Sắp xếp các lệnh theo thứ tự thời gian vào lệnh
  allTrades.sort((a, b) => a.entryTime - b.entryTime);

  // In danh sách chi tiết các lệnh gần nhất
  console.log('\n================================================================');
  console.log('📋 LỊCH SỬ KHỚP LỆNH MÔ PHỎNG (GẦN NHẤT):');
  console.log('================================================================');
  if (allTrades.length === 0) {
    console.log('Không có lệnh nào được kích hoạt trong khung thời gian này.');
  } else {
    console.log(
      'Thời gian'.padEnd(18) +
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

    allTrades.slice(-20).forEach(t => {
      const timeStr = new Date(t.entryTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 16);
      const stratShort = t.strategy.replace('STRATEGY_', 'S_');
      const resIcon = t.outcome === 'TP' ? '🎯 TP' : (t.outcome === 'BE' ? '🛡️ BE' : (t.outcome === 'TIME_STOP' ? '⏱️ TIME' : '🛑 SL'));
      console.log(
        timeStr.padEnd(18) +
        t.symbol.padEnd(10) +
        stratShort.padEnd(28) +
        t.direction.padEnd(8) +
        t.entry.toString().padEnd(10) +
        t.exitPrice.toString().padEnd(10) +
        resIcon.padEnd(10) +
        `${t.netR >= 0 ? '+' : ''}${t.netR}R`.padEnd(10) +
        `${t.netUsd >= 0 ? '+' : ''}$${t.netUsd}`
      );
    });
  }

  // Bảng tổng hợp theo từng cặp Coin
  console.log('\n================================================================');
  console.log('📊 BẢNG TỔNG HỢP HIỆU SUẤT THEO TỪNG CẶP COIN:');
  console.log('================================================================');
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
  console.log('-'.repeat(95));

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

  // Bảng phân tích theo Chiến lược
  const strat1Trades = allTrades.filter(t => t.strategy === 'STRATEGY_1_LIQUIDITY_SWEEP');
  const strat2Trades = allTrades.filter(t => t.strategy === 'STRATEGY_2_TREND_PULLBACK_SHORT');
  const strat3Trades = allTrades.filter(t => t.strategy === 'STRATEGY_3_PRE_BREAKOUT_SQUEEZE');

  console.log('\n================================================================');
  console.log('🎯 HIỆU SUẤT PHÂN LOẠI THEO CHIẾN LƯỢC:');
  console.log('================================================================');
  [
    { name: '1. Liquidity Sweep H4', trades: strat1Trades },
    { name: '2. Trend Pullback Short H4', trades: strat2Trades },
    { name: '3. Pre-Breakout Squeeze H4', trades: strat3Trades }
  ].forEach(st => {
    const m = calculateMetrics(st.trades);
    console.log(`• ${st.name}: ${st.trades.length} lệnh | TP: ${m.wins} | BE: ${m.be} | SL: ${m.losses} | Win Rate: ${m.winRate} | Net R: ${m.totalR} | Net PnL: ${m.netPnlUsd}`);
  });

  // Tổng kết danh mục chung
  const totalMetrics = calculateMetrics(allTrades);
  console.log('\n================================================================');
  console.log('🏆 TỔNG KẾT DANH MỤC TOÀN DIỆN (PORTFOLIO TOTAL):');
  console.log('================================================================');
  console.log(`• Tổng số lệnh đã đóng:    ${totalMetrics.totalTrades} lệnh`);
  console.log(`• Lệnh thắng trọn (TP):    ${totalMetrics.wins} lệnh (${totalMetrics.winRate})`);
  console.log(`• Lệnh hòa vốn (BE):       ${totalMetrics.be} lệnh (Bảo toàn vốn thành công)`);
  console.log(`• Lệnh cắt lỗ (SL):        ${totalMetrics.losses} lệnh`);
  console.log(`• Lệnh Time-Stop:          ${totalMetrics.timeStops} lệnh`);
  console.log(`• Tỷ số Lãi/Lỗ (PF):       ${totalMetrics.profitFactor}`);
  console.log(`• Tổng số R mang về:       ${totalMetrics.totalR}`);
  console.log(`• Tổng lợi nhuận ròng:     ${totalMetrics.netPnlUsd} (Đã trừ phí Taker 0.08%)`);
  console.log(`• Max Drawdown (USDT):     ${totalMetrics.maxDrawdownUsd}`);
  console.log(`• Max Drawdown (R):        ${totalMetrics.maxDrawdownR}`);
  console.log('================================================================\n');
}

runAllBacktests();

