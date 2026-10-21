/**
 * SERVER.JS
 * Runtime quét dữ liệu trực tiếp từ OKX Public REST API.
 * Quản lý vị thế Paper Trading thời gian thực, dời Stop Loss +1.5R và gửi Telegram.
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { evaluateMarket, DEFAULT_CONFIG } from './engine.js';
import {
  notifyNewSignal,
  notifyBreakevenTriggered,
  notifyTakeProfit,
  notifyStopLoss,
  notifyTimeStop
} from './telegram.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSITIONS_FILE = process.env.STATE_FILE || path.join(__dirname, '../positions.json');

const CONFIG = {
  ...DEFAULT_CONFIG,
  riskUsd: parseFloat(process.env.RISK_USD_PER_TRADE || '10.0'),
  leverage: parseInt(process.env.LEVERAGE || '10', 10),
  feeRate: parseFloat(process.env.FEE_RATE || '0.0008'),
  minRR: parseFloat(process.env.MIN_RR_RATIO || '2.0'),
  beTriggerR: parseFloat(process.env.BE_TRIGGER_R || '1.5'),
  timeStopBars: parseInt(process.env.TIME_STOP_BARS || '16', 10),
  maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || '2', 10),
  scanMode: process.env.SCAN_MODE || 'DYNAMIC_TOP',
  topLimit: parseInt(process.env.TOP_COINS_LIMIT || '20', 10),
  pollIntervalSec: parseInt(process.env.POLL_INTERVAL_SEC || '60', 10),
  okxBaseUrl: process.env.OKX_BASE_URL || 'https://www.okx.com',
  watchlist: (process.env.WATCHLIST || 'BTC-USDT,ETH-USDT,LINK-USDT,SOL-USDT')
    .split(',')
    .map(s => s.trim().toUpperCase())
};

// Danh sách Memecoin / Coin rác cấm giao dịch vì râu nến giật ảo
const MEMECOIN_BLACKLIST = new Set([
  'FLOKI-USDT', 'BONK-USDT', 'SHIB-USDT', 'PEPE-USDT', 'MEME-USDT',
  'BOME-USDT', 'NEIRO-USDT', 'PENGU-USDT', 'APR-USDT', 'HMSTR-USDT',
  'TURBO-USDT', 'DOGS-USDT', '1000SATS-USDT', 'SATS-USDT', 'BABYDOGE-USDT',
  'BILL-USDT', 'AKE-USDT', 'DOOD-USDT', 'PUMP-USDT', 'DOGE-USDT'
]);

// Danh sách Altcoin Top & Nền tảng cấu trúc chuẩn được ưu tiên quét
const QUALITY_UNIVERSE = [
  'BTC-USDT', 'ETH-USDT', 'LINK-USDT', 'SOL-USDT', 'WLD-USDT', 'SUI-USDT',
  'NEAR-USDT', 'AVAX-USDT', 'ARB-USDT', 'OP-USDT', 'APT-USDT', 'TIA-USDT',
  'INJ-USDT', 'RENDER-USDT'
];

/**
 * Tải danh sách vị thế từ file lưu trữ
 */
// State quản lý vị thế đang mở
let activePositions = [];

function loadPositions() {
  if (process.env.RESET_STATE === 'true') {
    console.log('[POSITIONS] Nhận cờ RESET_STATE=true -> Xóa sạch các vị thế cũ.');
    activePositions = [];
    savePositions();
    return;
  }
  if (fs.existsSync(POSITIONS_FILE)) {
    try {
      const data = fs.readFileSync(POSITIONS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        activePositions = parsed;
      } else if (parsed && Array.isArray(parsed.positions)) {
        activePositions = parsed.positions;
      } else {
        console.warn(`[POSITIONS] Dữ liệu từ ${POSITIONS_FILE} không phải mảng, khởi tạo danh sách rỗng.`);
        activePositions = [];
      }
      console.log(`[POSITIONS] Đã nạp ${activePositions.length} vị thế từ ${POSITIONS_FILE}`);

      // Tự động giải phóng các coin rác / memecoin cũ bị cấm (như FLOKI, APR) để trả lại slot cho coin chất lượng
      const prevCount = activePositions.length;
      activePositions = activePositions.filter(p => {
        const sym = p.symbol || p.instId.replace('-SWAP', '');
        const isBanned = MEMECOIN_BLACKLIST.has(sym);
        if (isBanned) {
          console.log(`[PURGE STALE] Đã giải phóng vị thế cũ của coin rác: ${sym}`);
        }
        return !isBanned;
      });
      if (activePositions.length !== prevCount) {
        savePositions();
        console.log(`[POSITIONS] Số vị thế hợp lệ sau khi dọn dẹp coin rác: ${activePositions.length}`);
      }
    } catch (err) {
      console.error(`[POSITIONS] Lỗi đọc ${POSITIONS_FILE}:`, err.message);
      activePositions = [];
    }
  } else {
    activePositions = [];
  }
}

/**
 * Lưu danh sách vị thế ra file
 */
function savePositions() {
  try {
    fs.writeFileSync(POSITIONS_FILE, JSON.stringify(activePositions, null, 2), 'utf8');
  } catch (err) {
    console.error('[POSITIONS] Lỗi ghi positions.json:', err.message);
  }
}

/**
 * Lấy dữ liệu nến từ OKX Public API
 * @param {string} instId - Ví dụ: BTC-USDT-SWAP
 * @param {string} bar - '4H', '1H', '15m'
 * @param {number} limit - Số nến
 * @returns {Promise<Array>}
 */
export async function fetchOkxCandles(instId, bar = '4H', limit = 100) {
  const url = `${CONFIG.okxBaseUrl}/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (!json.data || !Array.isArray(json.data)) return [];

    return json.data.map(c => ({
      ts: parseInt(c[0], 10),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      vol: parseFloat(c[5])
    })).reverse(); // Đảo lại theo thứ tự thời gian tăng dần (cũ -> mới)
  } catch (err) {
    console.error(`[API] Lỗi fetch nến ${instId} (${bar}):`, err.message);
    return [];
  }
}

/**
 * Lấy Top coin có khối lượng giao dịch USDT-M Futures lớn nhất
 * @param {number} limit 
 * @returns {Promise<string[]>}
 */
export async function fetchTopVolumeCoins(limit = 30) {
  const url = `${CONFIG.okxBaseUrl}/api/v5/market/tickers?instType=SWAP`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (!json.data) return [];

    return json.data
      .filter(t => t.instId.endsWith('-USDT-SWAP'))
      .map(t => ({
        instId: t.instId,
        volUsdt: parseFloat(t.volCcy24h || 0)
      }))
      .sort((a, b) => b.volUsdt - a.volUsdt)
      .slice(0, limit)
      .map(t => t.instId);
  } catch (err) {
    console.error('[API] Lỗi fetch top volume tickers:', err.message);
    return [];
  }
}

/**
 * Quản lý và cập nhật các vị thế đang mở
 * @param {string} instId 
 * @param {number} currentPrice 
 */
async function updateOpenPositions(instId, currentPrice) {
  const posIndex = activePositions.findIndex(p => p.instId === instId);
  if (posIndex === -1) return;

  const pos = activePositions[posIndex];
  const isLong = pos.direction === 'LONG';
  const riskDist = Math.abs(pos.entry - pos.initialStopLoss);

  // Tính P&L hiện tại theo R
  const rawPnlPrice = isLong ? (currentPrice - pos.entry) : (pos.entry - currentPrice);
  const currentR = riskDist > 0 ? (rawPnlPrice / riskDist) : 0;
  pos.currentBarsM15 = (pos.currentBarsM15 || 0) + 1;

  // 1. Kiểm tra kích hoạt Dời Stop Loss về Hòa vốn (+1.5R)
  if (!pos.isBreakevenMoved && currentR >= CONFIG.beTriggerR) {
    pos.isBreakevenMoved = true;
    const newSL = isLong
      ? pos.entry * (1 + CONFIG.beBufferRate)
      : pos.entry * (1 - CONFIG.beBufferRate);
    pos.stopLoss = parseFloat(newSL.toFixed(4));
    console.log(`[PROTECTION] ${pos.symbol} đạt +${currentR.toFixed(2)}R -> Dời SL về Hòa vốn: ${pos.stopLoss}`);
    await notifyBreakevenTriggered(pos, pos.stopLoss);
    savePositions();
  }

  // 2. Kiểm tra Chốt lời (Take Profit 100%)
  const isTakeProfitHit = isLong ? (currentPrice >= pos.takeProfit) : (currentPrice <= pos.takeProfit);
  if (isTakeProfitHit) {
    const pnlPrice = isLong ? (pos.takeProfit - pos.entry) : (pos.entry - pos.takeProfit);
    const grossPnl = pnlPrice * pos.sizing.size;
    const fee = pos.sizing.notional * CONFIG.feeRate;
    const netPnl = grossPnl - fee;
    const finalR = riskDist > 0 ? (pnlPrice / riskDist) : 0;

    console.log(`[TAKE PROFIT] ${pos.symbol} 100% closed at ${pos.takeProfit} (+${finalR.toFixed(2)}R, Net: $${netPnl.toFixed(2)})`);
    await notifyTakeProfit(pos, pos.takeProfit, finalR, netPnl);
    activePositions.splice(posIndex, 1);
    savePositions();
    return;
  }

  // 3. Kiểm tra Dừng lỗ hoặc chạm Hòa vốn (Stop Loss Hit)
  const isStopLossHit = isLong ? (currentPrice <= pos.stopLoss) : (currentPrice >= pos.stopLoss);
  if (isStopLossHit) {
    const pnlPrice = isLong ? (pos.stopLoss - pos.entry) : (pos.entry - pos.stopLoss);
    const grossPnl = pnlPrice * pos.sizing.size;
    const fee = pos.sizing.notional * CONFIG.feeRate;
    const netPnl = grossPnl - fee;
    const finalR = riskDist > 0 ? (pnlPrice / riskDist) : 0;

    console.log(`[STOP LOSS] ${pos.symbol} closed at ${pos.stopLoss} (${finalR.toFixed(2)}R, Net: $${netPnl.toFixed(2)})`);
    await notifyStopLoss(pos, pos.stopLoss, finalR, netPnl, pos.isBreakevenMoved);
    activePositions.splice(posIndex, 1);
    savePositions();
    return;
  }

  // 4. Kiểm tra Time-Stop (16 nến M15 = 4 tiếng lình xình)
  if (pos.currentBarsM15 >= CONFIG.timeStopBars && Math.abs(currentR) <= 0.3) {
    const pnlPrice = isLong ? (currentPrice - pos.entry) : (pos.entry - currentPrice);
    const grossPnl = pnlPrice * pos.sizing.size;
    const fee = pos.sizing.notional * CONFIG.feeRate;
    const netPnl = grossPnl - fee;

    console.log(`[TIME-STOP] ${pos.symbol} lình xình sau 16 nến -> Đóng tại ${currentPrice}`);
    await notifyTimeStop(pos, currentPrice, netPnl);
    activePositions.splice(posIndex, 1);
    savePositions();
  }
}

/**
 * Chu kỳ quét thị trường chính
 */
export async function runScanCycle() {
  const timeStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  console.log(`\n======================================================`);
  console.log(`[SCAN CYCLE] Bắt đầu quét thị trường lúc: ${timeStr}`);
  console.log(`[MODE] ${CONFIG.scanMode} | Đang mở: ${activePositions.length} vị thế`);

  // 1. Tải nến BTC 1H để kích hoạt Khiên Macro (Chỉ lấy nến đã đóng confirm=1)
  const rawBtcH1 = await fetchOkxCandles('BTC-USDT-SWAP', '1H', 30);
  const btcH1 = rawBtcH1.filter(c => c.confirm === 1);

  // 1.1. Luôn cập nhật giá thời gian thực cho TẤT CẢ các vị thế đang mở
  if (activePositions.length > 0) {
    console.log(`[POSITIONS ACTIVE] Danh sách vị thế đang mở:`);
    for (const pos of [...activePositions]) {
      try {
        const candles = await fetchOkxCandles(pos.instId, '15m', 5);
        if (candles && candles.length > 0) {
          const curPrice = candles[candles.length - 1].close;
          const pnlR = (pos.direction === 'LONG' ? (curPrice - pos.entry) : (pos.entry - curPrice)) / Math.abs(pos.entry - pos.initialStopLoss);
          console.log(`  • ${pos.symbol} ${pos.direction} (Entry: ${pos.entry}, Hiện tại: ${curPrice}, PnL: ${pnlR.toFixed(2)}R, SL: ${pos.stopLoss}, TP: ${pos.takeProfit})`);
          await updateOpenPositions(pos.instId, curPrice);
        }
      } catch (err) {
        console.error(`[UPDATE POS] Lỗi cập nhật ${pos.symbol}:`, err.message);
      }
    }
  }

  // 2. Xác định danh sách cặp cần quét (Chỉ quét coin nền tảng chất lượng)
  let symbolsToScan = [];
  if (CONFIG.scanMode === 'DYNAMIC_TOP') {
    const rawTop = await fetchTopVolumeCoins(CONFIG.topLimit);
    // Lọc bỏ toàn bộ memecoin / coin rác
    symbolsToScan = rawTop.filter(inst => {
      const sym = inst.replace('-SWAP', '');
      return !MEMECOIN_BLACKLIST.has(sym);
    });

    // Bổ sung các coin nền tảng chất lượng vào danh sách
    for (const core of QUALITY_UNIVERSE) {
      const inst = core.endsWith('-SWAP') ? core : `${core}-SWAP`;
      if (!symbolsToScan.includes(inst) && !MEMECOIN_BLACKLIST.has(core)) {
        symbolsToScan.push(inst);
      }
    }
  } else {
    symbolsToScan = QUALITY_UNIVERSE.map(c => c.endsWith('-SWAP') ? c : `${c}-SWAP`);
  }

  console.log(`[SCANNER] Đang phân tích ${symbolsToScan.length} cặp coin...`);

  for (const instId of symbolsToScan) {
    const symbol = instId.replace('-SWAP', '');

    try {
      // Tải nến H4, H1, M15
      const [candlesH4, candlesH1, candlesM15] = await Promise.all([
        fetchOkxCandles(instId, '4H', 50),
        fetchOkxCandles(instId, '1H', 30),
        fetchOkxCandles(instId, '15m', 30)
      ]);

      if (candlesH4.length < 20 || candlesH1.length < 15 || candlesM15.length < 10) {
        continue;
      }

      // Giá hiện tại theo thời gian thực để cập nhật TP/SL/Trailing BE
      const currentPrice = candlesM15[candlesM15.length - 1].close;

      // Nếu đã đạt số lượng vị thế tối đa thì không mở thêm lệnh mới
      if (activePositions.length >= CONFIG.maxOpenPositions) {
        continue;
      }

      // Nếu đã có vị thế mở cho cặp này thì không mở thêm
      const hasOpenPos = activePositions.some(p => p.instId === instId);
      if (hasOpenPos) continue;

      // LỌC NẾN ĐÃ ĐÓNG HOÀN TOÀN (confirm = 1) để nhận diện cấu trúc, chống Look-Ahead Bias
      const closedH4 = candlesH4.filter(c => c.confirm === 1);
      const closedH1 = candlesH1.filter(c => c.confirm === 1);
      const closedM15 = candlesM15.filter(c => c.confirm === 1);

      if (closedH4.length < 15 || closedH1.length < 15 || closedM15.length < 5) {
        continue;
      }

      // Chạy thuật toán định lượng Pure Engine trên nến đã đóng 100%
      const signal = evaluateMarket({
        symbol,
        candlesH4: closedH4,
        candlesH1: closedH1,
        candlesM15: closedM15,
        btcH1Candles: btcH1,
        config: CONFIG
      });

      if (signal && !signal.isBlocked) {
        console.log(`[SIGNAL FOUND] ${signal.direction} ${signal.symbol} via ${signal.strategy} | R:R 1:${signal.riskReward}`);
        
        // Mở vị thế Paper Trading
        const newPos = {
          id: `${instId}-${Date.now()}`,
          instId,
          symbol,
          direction: signal.direction,
          entry: signal.entry,
          stopLoss: signal.stopLoss,
          initialStopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          riskReward: signal.riskReward,
          sizing: signal.sizing,
          isBreakevenMoved: false,
          openedAt: Date.now(),
          currentBarsM15: 0
        };

        activePositions.push(newPos);
        savePositions();
        await notifyNewSignal(signal);
      } else if (signal && signal.isBlocked) {
        console.log(`[SIGNAL BLOCKED] ${signal.symbol} bị chặn bởi Khiên BTC: ${signal.blockReason}`);
      }
    } catch (err) {
      console.error(`[SCANNER] Lỗi phân tích ${symbol}:`, err.message);
    }
  }

  console.log(`[SCAN CYCLE] Hoàn tất chu kỳ. Chờ ${CONFIG.pollIntervalSec}s...`);
}

/**
 * Điểm khởi chạy chính
 */
async function main() {
  loadPositions();
  const isSingleRun = process.argv.includes('--single-run') || process.argv.includes('--dry-run');

  if (isSingleRun) {
    console.log('[RUNTIME] Chạy chế độ Single-Run / Dry-Run (Quét 1 lần)...');
    await runScanCycle();
    process.exit(0);
  }

  console.log(`[RUNTIME] Khởi động Bot Live Scanner (Chu kỳ: ${CONFIG.pollIntervalSec}s)...`);
  await runScanCycle();

  setInterval(async () => {
    try {
      await runScanCycle();
    } catch (err) {
      console.error('[RUNTIME] Lỗi chu kỳ quét:', err);
    }
  }, CONFIG.pollIntervalSec * 1000);
}

// Khởi chạy khi được gọi trực tiếp
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

