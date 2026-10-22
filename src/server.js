/**
 * SERVER.JS
 * Runtime quét dữ liệu trực tiếp từ OKX Public REST API.
 * Quản lý vị thế Paper Trading thời gian thực, dời Stop Loss +1.5R và gửi Telegram.
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from './indicators.js';
import { evaluateMarket, DEFAULT_CONFIG } from './engine.js';
import {
  notifyNewSignal,
  notifyBreakevenTriggered,
  notifyTakeProfit,
  notifyStopLoss,
  notifyTimeStop
} from './telegram.js';
import { startTelegramListener } from './telegram_bot.js';

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
  lockProfitR: parseFloat(process.env.LOCK_PROFIT_R || '1.0'), // Kéo SL lên dương +1.0R khi đạt +1.5R, gồng tới 2R
  timeStopBars: parseInt(process.env.TIME_STOP_BARS || '16', 10),
  minCoinPrice: parseFloat(process.env.MIN_COIN_PRICE || '1.0'), // Chặn triệt để coin giá 0.xx (< 1.0 USDT)
  maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || '2', 10),
  scanMode: process.env.SCAN_MODE || 'WATCHLIST', // Mặc định chỉ trade Top 5 coin lớn theo yêu cầu
  topLimit: parseInt(process.env.TOP_COINS_LIMIT || '20', 10),
  pollIntervalSec: parseInt(process.env.POLL_INTERVAL_SEC || '60', 10),
  okxBaseUrl: process.env.OKX_BASE_URL || 'https://www.okx.com',
  watchlist: (process.env.WATCHLIST || 'BTC-USDT,ETH-USDT,SOL-USDT,LINK-USDT,NEAR-USDT,HYPE-USDT')
    .split(',')
    .map(s => s.trim().toUpperCase())
};

// Danh sách Coin Lớn & Chuẩn Cấu Trúc Nhất Sàn OKX (BTC, ETH, SOL, LINK, NEAR, HYPE)
const PREMIER_UNIVERSE = [
  'BTC-USDT',
  'ETH-USDT',
  'SOL-USDT',
  'LINK-USDT',
  'NEAR-USDT',
  'HYPE-USDT'
];

// Danh sách Memecoin / Coin rác cấm giao dịch vì râu nến giật ảo
const MEMECOIN_BLACKLIST = new Set([
  'FLOKI-USDT', 'BONK-USDT', 'SHIB-USDT', 'PEPE-USDT', 'MEME-USDT',
  'BOME-USDT', 'NEIRO-USDT', 'PENGU-USDT', 'APR-USDT', 'HMSTR-USDT',
  'TURBO-USDT', 'DOGS-USDT', '1000SATS-USDT', 'SATS-USDT', 'BABYDOGE-USDT',
  'BILL-USDT', 'AKE-USDT', 'DOOD-USDT', 'PUMP-USDT', 'DOGE-USDT'
]);

// Danh sách Tài sản truyền thống / Cổ phiếu CFD không phải Crypto trên OKX SWAP
const NON_CRYPTO_BLACKLIST = new Set([
  'XAU-USDT', 'XAG-USDT', 'CL-USDT', 'SOXL-USDT', 'SOXS-USDT', 'SPCX-USDT',
  'SNDK-USDT', 'SKHYNIX-USDT', 'SKHY-USDT', 'MU-USDT', 'KORU-USDT', 'SNXX-USDT',
  'TSLA-USDT', 'NVDA-USDT', 'QQQ-USDT', 'MSTR-USDT', 'CRCL-USDT', 'UNITREE-USDT', 'BZ-USDT'
]);

// Danh sách Altcoin Top & Nền tảng cấu trúc chuẩn được ưu tiên quét (Đều có giá >= 1.0 USDT)
const QUALITY_UNIVERSE = [
  'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'ZEC-USDT', 'LINK-USDT',
  'AVAX-USDT', 'NEAR-USDT', 'SUI-USDT', 'INJ-USDT', 'AAVE-USDT',
  'UNI-USDT', 'APT-USDT', 'TIA-USDT', 'RENDER-USDT'
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

      // Tự động giải phóng các coin rác / memecoin / coin 0.xx cũ để trả lại slot cho coin chất lượng
      const prevCount = activePositions.length;
      activePositions = activePositions.filter(p => {
        const sym = p.symbol || p.instId.replace('-SWAP', '');
        const isBanned = MEMECOIN_BLACKLIST.has(sym) || NON_CRYPTO_BLACKLIST.has(sym);
        const isSubDollar = (p.entry < CONFIG.minCoinPrice);
        if (isBanned || isSubDollar) {
          console.log(`[PURGE STALE] Đã giải phóng vị thế cũ của coin không phù hợp: ${sym} (Entry: ${p.entry}, MinPrice: ${CONFIG.minCoinPrice})`);
          return false;
        }
        return true;
      });
      if (activePositions.length !== prevCount) {
        savePositions();
        console.log(`[POSITIONS] Số vị thế hợp lệ sau khi dọn dẹp coin rác/0.xx: ${activePositions.length}`);
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

    return json.data.map(normalizeCandle).reverse(); // Đảo lại theo thứ tự thời gian tăng dần (cũ -> mới)
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
      .map(t => {
        const last = parseFloat(t.last || 0);
        const volCcy = parseFloat(t.volCcy24h || 0);
        return {
          instId: t.instId,
          last,
          turnoverUsdt: volCcy * last // Doanh số thực tế 24h tính bằng USDT (Volume * Giá)
        };
      })
      .filter(t => t.last >= CONFIG.minCoinPrice) // Lọc bỏ triệt để các coin giá 0.xx (< minCoinPrice)
      .sort((a, b) => b.turnoverUsdt - a.turnoverUsdt)
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
 * @param {number|object} candleOrPrice 
 */
export async function updateOpenPositions(instId, candleOrPrice) {
  const posIndex = activePositions.findIndex(p => p.instId === instId);
  if (posIndex === -1) return;

  const pos = activePositions[posIndex];
  const isLong = pos.direction === 'LONG';
  const riskDist = Math.abs(pos.entry - pos.initialStopLoss);

  const candle = (typeof candleOrPrice === 'object' && candleOrPrice !== null)
    ? candleOrPrice
    : { close: candleOrPrice, high: candleOrPrice, low: candleOrPrice };

  const currentPrice = candle.close;
  const highPrice = candle.high !== undefined ? candle.high : currentPrice;
  const lowPrice = candle.low !== undefined ? candle.low : currentPrice;

  // Tính P&L hiện tại theo R (theo giá đóng hiện tại)
  const rawPnlPrice = isLong ? (currentPrice - pos.entry) : (pos.entry - currentPrice);
  const currentR = riskDist > 0 ? (rawPnlPrice / riskDist) : 0;

  // Tính chính xác số nến M15 (15 phút) đã trôi qua kể từ khi mở vị thế
  const elapsedMs = Date.now() - (pos.openedAt || Date.now());
  pos.currentBarsM15 = Math.floor(elapsedMs / (15 * 60 * 1000));

  // 1. Kiểm tra kích hoạt Dời Stop Loss khóa lợi nhuận (+1.5R -> Kéo SL lên +1.0R, gồng tới 2.0R)
  const favorablePrice = isLong ? highPrice : lowPrice;
  const curMaxR = riskDist > 0
    ? (isLong ? (favorablePrice - pos.entry) : (pos.entry - favorablePrice)) / riskDist
    : 0;

  if (!pos.isProfitLocked && curMaxR >= CONFIG.beTriggerR) {
    pos.isProfitLocked = true;
    pos.isBreakevenMoved = true;
    const lockR = CONFIG.lockProfitR !== undefined ? CONFIG.lockProfitR : 1.0;
    const newSL = isLong
      ? pos.entry + (lockR * riskDist)
      : pos.entry - (lockR * riskDist);
    pos.stopLoss = parseFloat(newSL.toFixed(4));
    console.log(`[PROFIT LOCK] ${pos.symbol} đạt +${curMaxR.toFixed(2)}R -> Kéo SL lên khóa +${lockR}R: ${pos.stopLoss} (Gồng tới TP ${pos.takeProfit})`);
    await notifyBreakevenTriggered(pos, pos.stopLoss);
    savePositions();
  }

  // 2. Kiểm tra Dừng lỗ hoặc Chốt lời (Wick-level)
  // Nguyên tắc bảo toàn: Nếu cùng 1 nến râu giật quét cả SL và TP -> Ưu tiên xử lý SL trước (chống ảo tưởng lợi nhuận)
  const isStopLossHit = isLong ? (lowPrice <= pos.stopLoss) : (highPrice >= pos.stopLoss);
  const isTakeProfitHit = isLong ? (highPrice >= pos.takeProfit) : (lowPrice <= pos.takeProfit);

  if (isStopLossHit) {
    const pnlPrice = isLong ? (pos.stopLoss - pos.entry) : (pos.entry - pos.stopLoss);
    const grossPnl = pnlPrice * pos.sizing.size;
    const fee = pos.sizing.notional * CONFIG.feeRate;
    const netPnl = grossPnl - fee;
    const finalR = riskDist > 0 ? (pnlPrice / riskDist) : (pos.isProfitLocked ? (CONFIG.lockProfitR || 1.0) : -1);

    const logPrefix = pos.isProfitLocked ? `[LOCKED PROFIT HIT]` : `[STOP LOSS]`;
    console.log(`${logPrefix} ${pos.symbol} closed at ${pos.stopLoss} (${finalR >= 0 ? '+' : ''}${finalR.toFixed(2)}R, Net: $${netPnl.toFixed(2)})`);
    await notifyStopLoss(pos, pos.stopLoss, finalR, netPnl, pos.isProfitLocked);
    activePositions.splice(posIndex, 1);
    savePositions();
    return;
  }

  if (isTakeProfitHit) {
    const pnlPrice = isLong ? (pos.takeProfit - pos.entry) : (pos.entry - pos.takeProfit);
    const grossPnl = pnlPrice * pos.sizing.size;
    const fee = pos.sizing.notional * CONFIG.feeRate;
    const netPnl = grossPnl - fee;
    const finalR = riskDist > 0 ? (pnlPrice / riskDist) : pos.riskReward;

    console.log(`[TAKE PROFIT] ${pos.symbol} 100% closed at ${pos.takeProfit} (+${finalR.toFixed(2)}R, Net: $${netPnl.toFixed(2)})`);
    await notifyTakeProfit(pos, pos.takeProfit, finalR, netPnl);
    activePositions.splice(posIndex, 1);
    savePositions();
    return;
  }

  // 3. Kiểm tra Time-Stop (16 nến M15 = 4 tiếng lình xình đi ngang +-0.3R)
  if (pos.currentBarsM15 >= CONFIG.timeStopBars && Math.abs(currentR) <= 0.3) {
    const pnlPrice = isLong ? (currentPrice - pos.entry) : (pos.entry - currentPrice);
    const grossPnl = pnlPrice * pos.sizing.size;
    const fee = pos.sizing.notional * CONFIG.feeRate;
    const netPnl = grossPnl - fee;

    console.log(`[TIME-STOP] ${pos.symbol} lình xình sau ${pos.currentBarsM15} nến M15 -> Đóng tại ${currentPrice}`);
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
          const curCandle = candles[candles.length - 1];
          const curPrice = curCandle.close;
          const pnlR = (pos.direction === 'LONG' ? (curPrice - pos.entry) : (pos.entry - curPrice)) / Math.abs(pos.entry - pos.initialStopLoss);
          console.log(`  • ${pos.symbol} ${pos.direction} (Entry: ${pos.entry}, Hiện tại: ${curPrice}, PnL: ${pnlR.toFixed(2)}R, SL: ${pos.stopLoss}, TP: ${pos.takeProfit})`);
          await updateOpenPositions(pos.instId, curCandle);
        }
      } catch (err) {
        console.error(`[UPDATE POS] Lỗi cập nhật ${pos.symbol}:`, err.message);
      }
    }
  }

  // 2. Xác định danh sách cặp cần quét (Khóa chặt Danh mục Coin Lớn: BTC, ETH, SOL, LINK, NEAR, HYPE)
  let symbolsToScan = [];
  if (CONFIG.scanMode === 'WATCHLIST') {
    symbolsToScan = CONFIG.watchlist.map(c => c.endsWith('-SWAP') ? c : `${c}-SWAP`);
  } else {
    symbolsToScan = PREMIER_UNIVERSE.map(c => c.endsWith('-SWAP') ? c : `${c}-SWAP`);
  }

  const coinNames = symbolsToScan.map(s => s.replace('-USDT-SWAP', '')).join(', ');
  console.log(`[SCANNER] Đang phân tích ${symbolsToScan.length} coin lớn hàng đầu [${coinNames}] (Giá >= ${CONFIG.minCoinPrice} USDT)...`);

  for (const instId of symbolsToScan) {
    const symbol = instId.replace('-SWAP', '');

    try {
      // Tải nến H4 (lấy đủ 100 nến để tính EMA 34 & 89 chuẩn xác), H1, M15
      const [candlesH4, candlesH1, candlesM15] = await Promise.all([
        fetchOkxCandles(instId, '4H', 100),
        fetchOkxCandles(instId, '1H', 30),
        fetchOkxCandles(instId, '15m', 30)
      ]);

      if (candlesH4.length < 20 || candlesH1.length < 15 || candlesM15.length < 10) {
        continue;
      }

      // Giá hiện tại theo thời gian thực để cập nhật TP/SL/Trailing BE
      const currentPrice = candlesM15[candlesM15.length - 1].close;

      // KIỂM TRA GIÁ TỐI THIỂU: Bỏ qua tuyệt đối các coin 0.xx (nhỏ hơn minCoinPrice, mặc định 1.0 USDT)
      if (currentPrice < CONFIG.minCoinPrice) {
        continue;
      }

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

  // Tự động kiểm tra và phát Bản tin Smart Money AI vào đầu mỗi buổi sáng (07:00 VN)
  await checkAndTriggerDailyBriefing();

  console.log(`[SCAN CYCLE] Hoàn tất chu kỳ. Chờ ${CONFIG.pollIntervalSec}s...`);
}

let lastBriefingDate = '';

async function checkAndTriggerDailyBriefing() {
  const now = new Date();
  const vnDateStr = now.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const vnHour = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, hour: '2-digit' }), 10);

  // Kích hoạt vào khoảng 07:00 - 08:00 sáng mỗi ngày giờ VN
  if (vnHour >= 7 && lastBriefingDate !== vnDateStr && process.env.GEMINI_API_KEY) {
    lastBriefingDate = vnDateStr;
    console.log(`[AI AGENT] Kích hoạt Bản tin Smart Money Hàng Ngày (${vnDateStr})...`);
    try {
      const { generateDailyMarketAnalysis } = await import('./ai_agent.js');
      const { calculateEMA, classifyLiquidityTiers } = await import('./indicators.js');
      const { sendTelegramMessage } = await import('./telegram.js');

      const symbols = PREMIER_UNIVERSE;
      const snapshot = [];

      for (const symbol of symbols) {
        const instId = `${symbol}-SWAP`;
        const candlesH4 = await fetchOkxCandles(instId, '4H', 100);
        if (!candlesH4 || candlesH4.length < 50) continue;
        const closedH4 = candlesH4.filter(c => c.confirm === 1);
        const lastCandle = closedH4[closedH4.length - 1];
        const curPrice = lastCandle.close;
        const closes = closedH4.map(c => c.close);
        const ema34 = calculateEMA(closes, 34).slice(-1)[0];
        const ema89 = calculateEMA(closes, 89).slice(-1)[0];
        const liquidityTiers = classifyLiquidityTiers(closedH4, curPrice);

        snapshot.push({
          symbol,
          currentPrice: curPrice,
          trendH4: ema34 >= ema89 ? 'BULL' : 'BEAR',
          ema34: parseFloat(ema34?.toFixed(2) || '0'),
          ema89: parseFloat(ema89?.toFixed(2) || '0'),
          distanceToEma34Percent: parseFloat((((curPrice - ema34) / ema34) * 100).toFixed(2)),
          liquidityTiers: {
            tier1InducementHighs: liquidityTiers.tier1Highs.map(h => ({ price: h.avgPrice, touches: h.touchCount })),
            tier1InducementLows: liquidityTiers.tier1Lows.map(l => ({ price: l.avgPrice, touches: l.touchCount })),
            tier2MajorHigh: liquidityTiers.tier2MajorHigh,
            tier2MajorLow: liquidityTiers.tier2MajorLow,
            isInducementTrapRisk: liquidityTiers.isInducementTrapRisk,
            sweepState: liquidityTiers.sweepState,
            details: liquidityTiers.details
          }
        });
      }

      const briefingText = await generateDailyMarketAnalysis({ symbolsData: snapshot, activePositions });
      await sendTelegramMessage(briefingText);
      console.log('[AI AGENT] Đã tự động gửi Bản tin Smart Money sáng nay qua Telegram!');
    } catch (err) {
      console.error('[AI AGENT] Lỗi chạy Daily Briefing:', err.message);
    }
  }
}

let isScanning = false;

export async function safeRunScanCycle() {
  if (isScanning) {
    console.warn('[SCAN CYCLE] Chu kỳ quét trước vẫn đang chạy. Bỏ qua lần này để chống chồng chéo.');
    return;
  }
  isScanning = true;
  try {
    await runScanCycle();
  } catch (err) {
    console.error('[RUNTIME] Lỗi chu kỳ quét:', err);
  } finally {
    isScanning = false;
  }
}

/**
 * Điểm khởi chạy chính
 */
async function main() {
  loadPositions();
  const isSingleRun = process.argv.includes('--single-run') || process.argv.includes('--dry-run');

  if (isSingleRun) {
    console.log('[RUNTIME] Chạy chế độ Single-Run / Dry-Run (Quét 1 lần)...');
    await safeRunScanCycle();
    process.exit(0);
  }

  console.log(`[RUNTIME] Khởi động Bot Live Scanner (Chu kỳ: ${CONFIG.pollIntervalSec}s)...`);
  
  // Khởi động Trợ lý AI Tương tác 2 Chiều trên Telegram (Gemini 3.8 Flash Vision)
  startTelegramListener({ fetchOkxCandles });

  await safeRunScanCycle();

  const scheduleNext = () => {
    setTimeout(async () => {
      try {
        await safeRunScanCycle();
      } finally {
        scheduleNext();
      }
    }, CONFIG.pollIntervalSec * 1000);
  };

  scheduleNext();
}

// Khởi chạy khi được gọi trực tiếp
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

