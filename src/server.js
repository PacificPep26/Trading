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
import { evaluateMarket, calculateSetupQualityScore, calculatePositionSize } from './engine.js';
import { BOT_CONFIG, UNIVERSE_CONFIG, getEffectiveConfig } from './config.js';
import {
  notifyNewSignal,
  notifyBreakevenTriggered,
  notifyTakeProfit,
  notifyStopLoss,
  notifyPostMortemPenalty,
  notifyTimeStop
} from './telegram.js';
import {
  inspectTradeMistake,
  applyDisciplinaryPenalty,
  rewardWinAndClearPenalty,
  checkAdaptiveTradeAllowed,
  getAdaptiveRiskMultiplier
} from './learning.js';
import { startTelegramListener } from './telegram_bot.js';
import { isNewsBlackout, getNextNewsEvent } from './news_calendar.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSITIONS_FILE = process.env.STATE_FILE || path.join(__dirname, '../positions.json');
const PENDING_SIGNALS_FILE = process.env.PENDING_SIGNALS_FILE || path.join(__dirname, '../pending_signals.json');

const CONFIG = BOT_CONFIG;

// Danh sách Coin Lớn & Chuẩn Cấu Trúc Nhất Sàn OKX (BTC, ETH, SOL, LINK, NEAR, HYPE)
const PREMIER_UNIVERSE = UNIVERSE_CONFIG.premierWatchlist;

// Danh sách Memecoin / Coin rác cấm giao dịch vì râu nến giật ảo
const MEMECOIN_BLACKLIST = UNIVERSE_CONFIG.memecoinBlacklist;

// Danh sách Tài sản truyền thống / Cổ phiếu CFD không phải Crypto trên OKX SWAP
const NON_CRYPTO_BLACKLIST = UNIVERSE_CONFIG.nonCryptoBlacklist;

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

// ENTRY DELAY: hàng đợi tín hiệu "đạt chuẩn nhưng đang chờ xác nhận" (backtest
// xác nhận chờ CONFIG.entryDelayBars nến M15 rồi mới khớp lệnh thật cải thiện
// PF/Tổng R đáng kể, xem src/config.js). Mỗi phần tử: { instId, symbol,
// signal (gốc, chưa đổi entry), score, reasons, detectedAt (ms thật, dùng để
// tính đã đủ thời gian chờ hay chưa - vì live quét mỗi pollIntervalSec giây,
// không đồng bộ hoàn hảo như backtest theo nến) }.
let pendingSignals = [];

function loadPendingSignals() {
  if (fs.existsSync(PENDING_SIGNALS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(PENDING_SIGNALS_FILE, 'utf8'));
      pendingSignals = Array.isArray(parsed) ? parsed : [];
      if (pendingSignals.length > 0) {
        console.log(`[PENDING] Đã nạp ${pendingSignals.length} tín hiệu đang chờ xác nhận từ ${PENDING_SIGNALS_FILE}`);
      }
    } catch (err) {
      console.error(`[PENDING] Lỗi đọc ${PENDING_SIGNALS_FILE}:`, err.message);
      pendingSignals = [];
    }
  }
}

function savePendingSignals() {
  try {
    fs.writeFileSync(PENDING_SIGNALS_FILE, JSON.stringify(pendingSignals, null, 2), 'utf8');
  } catch (err) {
    console.error('[PENDING] Lỗi ghi pending_signals.json:', err.message);
  }
}

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

const TRADE_HISTORY_FILE = process.env.TRADE_HISTORY_FILE || path.join(__dirname, '../data/trade_history.json');

/**
 * Ghi lại 1 lệnh đã đóng vào sổ lệnh lâu dài (append-only, không mất dữ liệu
 * khi redeploy/mất log Railway). Dùng để trả lời "hôm qua bot vào lệnh gì".
 * @param {object} pos Vị thế vừa đóng
 * @param {string} outcome 'TP' | 'SL' | 'TIME_STOP'
 * @param {number} exitPrice
 * @param {number} finalR
 * @param {number} netPnl
 */
function logClosedTrade(pos, outcome, exitPrice, finalR, netPnl) {
  try {
    let history = [];
    if (fs.existsSync(TRADE_HISTORY_FILE)) {
      history = JSON.parse(fs.readFileSync(TRADE_HISTORY_FILE, 'utf8'));
    }
    history.push({
      symbol: pos.symbol,
      direction: pos.direction,
      strategy: pos.strategy,
      entry: pos.entry,
      exitPrice,
      initialStopLoss: pos.initialStopLoss,
      takeProfit: pos.takeProfit,
      outcome,
      finalR: parseFloat(finalR.toFixed(3)),
      netPnl: parseFloat(netPnl.toFixed(2)),
      qualityScore: pos.qualityScore,
      openedAt: pos.openedAt,
      closedAt: Date.now()
    });
    fs.writeFileSync(TRADE_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('[TRADE HISTORY] Lỗi ghi trade_history.json:', err.message);
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
    logClosedTrade(pos, pos.isProfitLocked ? 'LOCKED_PROFIT' : 'SL', pos.stopLoss, finalR, netPnl);
    await notifyStopLoss(pos, pos.stopLoss, finalR, netPnl, pos.isProfitLocked);

    // BỘ MỔ XẺ SAI LẦM & ÁP DỤNG HÌNH PHẠT HỌC HỎI
    // TẮT mặc định (ENABLE_PENALTY_SYSTEM !== 'true') theo kết luận backtest
    // 28/10: hệ thống phạt không cải thiện PF, chỉ bỏ lỡ cơ hội. Tắt cả việc
    // ghi án phạt + gửi tin nhắn "BẢN KIỂM ĐIỂM" gây hiểu nhầm.
    if (process.env.ENABLE_PENALTY_SYSTEM === 'true' && !pos.isProfitLocked) {
      try {
        const [h4, h1, m15, bH4, bH1] = await Promise.all([
          fetchOkxCandles(pos.instId, '4H', 25),
          fetchOkxCandles(pos.instId, '1H', 15),
          fetchOkxCandles(pos.instId, '15m', 20),
          fetchOkxCandles('BTC-USDT-SWAP', '4H', 35),
          fetchOkxCandles('BTC-USDT-SWAP', '1H', 20)
        ]);
        const mistake = inspectTradeMistake({
          pos,
          candlesH4: h4,
          candlesH1: h1,
          candlesM15: m15,
          btcH4Candles: bH4.filter(c => c.confirm === 1),
          btcH1Candles: bH1.filter(c => c.confirm === 1)
        });
        const penalty = applyDisciplinaryPenalty(pos, mistake);
        console.log(`[LEARNING PENALTY] Phạt ${pos.symbol}: ${mistake.mistakeTitle} -> Yêu cầu Đầu Tàu BTC: ${mistake.requiredBtcConfirmation || 'Chờ nến xác nhận'}`);
        await notifyPostMortemPenalty(pos, mistake, penalty);
      } catch (err) {
        console.error(`[LEARNING ERROR] Lỗi phân tích thất bại:`, err.message);
      }
    } else {
      rewardWinAndClearPenalty(pos.symbol);
    }

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
    logClosedTrade(pos, 'TP', pos.takeProfit, finalR, netPnl);
    rewardWinAndClearPenalty(pos.symbol);
    await notifyTakeProfit(pos, pos.takeProfit, finalR, netPnl);
    activePositions.splice(posIndex, 1);
    savePositions();
    return;
  }

  // 3. Kiểm tra Time-Stop (lình xình đi ngang +-0.3R sau N nến M15).
  // timeStopBars=0 hoặc falsy = TẮT HẲN (backtest full-history xác nhận Time-
  // Stop ngắn làm cắt cụt setup H4 đang tích lũy lành mạnh -> lật từ +60.32R
  // thành -7.48R/năm, xem docs/REGIME_ADAPTIVE_PLAN.md). Bắt buộc check
  // > 0 tường minh, không dùng trực tiếp >= vì 0 nến cũng thỏa >= khiến lệnh
  // bị đóng ngay lập tức thay vì tắt tính năng.
  if (CONFIG.timeStopBars > 0 && pos.currentBarsM15 >= CONFIG.timeStopBars && Math.abs(currentR) <= 0.3) {
    const pnlPrice = isLong ? (currentPrice - pos.entry) : (pos.entry - currentPrice);
    const grossPnl = pnlPrice * pos.sizing.size;
    const fee = pos.sizing.notional * CONFIG.feeRate;
    const netPnl = grossPnl - fee;

    console.log(`[TIME-STOP] ${pos.symbol} lình xình sau ${pos.currentBarsM15} nến M15 -> Đóng tại ${currentPrice}`);
    logClosedTrade(pos, 'TIME_STOP', currentPrice, currentR, netPnl);
    await notifyTimeStop(pos, currentPrice, netPnl);
    activePositions.splice(posIndex, 1);
    savePositions();
  }
}

/**
 * Cập nhật giá thời gian thực cho tất cả vị thế đang mở (tách từ runScanCycle,
 * logic giữ nguyên 100%).
 */
async function updateOpenPositionPrices() {
  if (activePositions.length === 0) return;
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

/**
 * Quét toàn bộ universe/watchlist và trả về danh sách ứng viên đạt chuẩn
 * điểm chất lượng (tách từ runScanCycle, logic giữ nguyên 100%).
 * @param {object} btcH4 Nến H4 BTC đã lọc confirm=1
 * @param {object} btcH1 Nến H1 BTC đã lọc confirm=1
 * @returns {Promise<Array>} candidateSignals
 */
async function scanUniverseForCandidates(btcH4, btcH1) {
  // 2. Xác định danh sách cặp cần quét (Khóa chặt Danh mục Coin Lớn: BTC, ETH, SOL, LINK, NEAR, HYPE)
  let symbolsToScan = [];
  if (CONFIG.scanMode === 'WATCHLIST') {
    symbolsToScan = CONFIG.watchlist.map(c => c.endsWith('-SWAP') ? c : `${c}-SWAP`);
  } else {
    symbolsToScan = PREMIER_UNIVERSE.map(c => c.endsWith('-SWAP') ? c : `${c}-SWAP`);
  }

  const coinNames = symbolsToScan.map(s => s.replace('-USDT-SWAP', '')).join(', ');
  console.log(`[SCANNER] Đang phân tích ${symbolsToScan.length} coin lớn [${coinNames}] (Giá >= ${CONFIG.minCoinPrice} USDT)...`);

  const candidateSignals = [];

  for (const instId of symbolsToScan) {
    const symbol = instId.replace('-SWAP', '');

    try {
      // Nếu đã có vị thế mở HOẶC đang chờ xác nhận (ENTRY DELAY) cho cặp này
      // thì không phân tích mở thêm
      const hasOpenPos = activePositions.some(p => p.instId === instId);
      const hasPending = pendingSignals.some(p => p.instId === instId);
      if (hasOpenPos || hasPending) continue;

      // Tải nến H4 (lấy đủ 100 nến để tính EMA 34 & 89 chuẩn xác), H1, M15, D1
      // (D1 dùng để nhận diện giai đoạn khung Ngày -> cấm bắt đáy/cản tàu ngược
      // hướng D1 ngay cả khi H4 còn báo RANGING cục bộ, xem docs/REGIME_ADAPTIVE_PLAN.md)
      const [candlesH4, candlesH1, candlesM15, candlesD1] = await Promise.all([
        fetchOkxCandles(instId, '4H', 100),
        fetchOkxCandles(instId, '1H', 30),
        fetchOkxCandles(instId, '15m', 30),
        fetchOkxCandles(instId, '1Dutc', 100)
      ]);

      if (candlesH4.length < 20 || candlesH1.length < 15 || candlesM15.length < 10) {
        continue;
      }

      // Giá hiện tại theo thời gian thực (lọc giá tối thiểu đã được evaluateMarket()
      // trong engine.js thực thi thống nhất cho cả live lẫn backtest, không lặp lại ở đây)
      const currentPrice = candlesM15[candlesM15.length - 1].close;

      // KIỂM TRA HÌNH PHẠT HỌC HỎI (ADAPTIVE PENALTY GATE THEO ĐẦU TÀU BTC):
      const generalCheck = checkAdaptiveTradeAllowed(symbol, null, btcH1, btcH4);
      if (!generalCheck.allowed) {
        continue; // Cặp coin đang bị đóng băng kỷ luật chờ đầu tàu BTC xác nhận
      }

      // LỌC NẾN ĐÃ ĐÓNG HOÀN TOÀN (confirm = 1) để nhận diện cấu trúc, chống Look-Ahead Bias
      const closedH4 = candlesH4.filter(c => c.confirm === 1);
      const closedH1 = candlesH1.filter(c => c.confirm === 1);
      const closedM15 = candlesM15.filter(c => c.confirm === 1);
      const closedD1 = candlesD1.filter(c => c.confirm === 1);

      if (closedH4.length < 15 || closedH1.length < 15 || closedM15.length < 5) {
        continue;
      }

      // Áp dụng cấu hình riêng theo từng coin (ví dụ SOL đệm ATR 1.0)
      const coinConfig = getEffectiveConfig(symbol, CONFIG);

      // Chạy thuật toán định lượng Pure Engine trên nến đã đóng 100%
      const signal = evaluateMarket({
        symbol,
        candlesH4: closedH4,
        candlesH1: closedH1,
        candlesM15: closedM15,
        candlesD1: closedD1,
        btcH1Candles: btcH1,
        btcH4Candles: btcH4,
        config: coinConfig
      });

      if (signal && !signal.isBlocked) {
        // KIỂM TRA HÌNH PHẠT THEO HƯỚNG LỆNH (CẤM BẮT ĐÁY / CẤM CẢN TÀU):
        const dirCheck = checkAdaptiveTradeAllowed(symbol, signal.direction, btcH1, btcH4);
        if (!dirCheck.allowed) {
          console.log(`[PENALTY VETO] ${symbol} bị hủy lệnh ${signal.direction}: ${dirCheck.reason}`);
          continue;
        }

        // Chấm điểm chất lượng Setup & Sức mạnh tương đối (0 - 100 điểm)
        const quality = calculateSetupQualityScore({
          signal,
          candlesH4: closedH4,
          candlesH1: closedH1,
          candlesM15: closedM15,
          btcH1Candles: btcH1
        });

        console.log(`[QUALITY CHECK] ${symbol}: ${quality.score}/100 pts (${quality.reasons.join(', ')})`);

        const minScore = CONFIG.minSetupQualityScore || 75;
        if (quality.score >= minScore) {
          candidateSignals.push({
            instId,
            symbol,
            signal: {
              ...signal,
              qualityScore: quality.score,
              qualityReasons: quality.reasons
            },
            score: quality.score,
            reasons: quality.reasons
          });
          console.log(`  ⭐ ỨNG VIÊN ĐẠT CHUẨN: ${symbol} (${quality.score}đ >= ${minScore}đ)`);
        } else {
          console.log(`  ⚪ Bỏ qua ${symbol}: Điểm chất lượng thấp (${quality.score}đ < ${minScore}đ)`);
        }
      } else if (signal && signal.isBlocked) {
        console.log(`[SIGNAL BLOCKED] ${signal.symbol}: ${signal.blockReason}`);
      }
    } catch (err) {
      console.error(`[SCANNER] Lỗi phân tích ${symbol}:`, err.message);
    }
  }

  return candidateSignals;
}

/**
 * Xếp hạng ứng viên theo điểm chất lượng, chọn "Con Khỏe Nhất" trong số
 * slot còn trống và mở lệnh (tách từ runScanCycle, logic giữ nguyên 100%).
 * @param {Array} candidateSignals
 */
// Mở vị thế thật (tách riêng để dùng chung cho cả 2 đường: vào ngay khi
// entryDelayBars=0, và finalize từ pendingSignals khi entryDelayBars>0).
async function openPositionNow(instId, symbol, signal, score, reasons) {
  const newPos = {
    id: `${instId}-${Date.now()}`,
    instId,
    symbol,
    direction: signal.direction,
    strategy: signal.strategy,
    entry: signal.entry,
    stopLoss: signal.stopLoss,
    initialStopLoss: signal.stopLoss,
    takeProfit: signal.takeProfit,
    riskReward: signal.riskReward,
    sizing: signal.sizing,
    qualityScore: score,
    qualityReasons: reasons,
    isBreakevenMoved: false,
    openedAt: Date.now(),
    currentBarsM15: 0
  };

  activePositions.push(newPos);
  savePositions();
  await notifyNewSignal(signal);
}

async function pickAndExecuteWinners(candidateSignals) {
  // 3. ĐÁNH GIÁ VÀ CHỌN "CON KHỎE NHẤT" ĐỂ VÀO LỆNH (RELATIVE STRENGTH WINNER)
  if (candidateSignals.length > 0) {
    // Sắp xếp các setup hợp lệ theo điểm chất lượng giảm dần -> CON KHỎE NHẤT ĐỨNG ĐẦU!
    candidateSignals.sort((a, b) => b.score - a.score);
    console.log(`\n🏆 [BẢNG XẾP HẠNG CON KHỎE NHẤT] (${candidateSignals.length} setup hội tụ trong chu kỳ):`);
    candidateSignals.forEach((c, idx) => {
      console.log(`   ${idx + 1}. ${c.symbol.padEnd(12)}: ${c.score}/100 điểm [${c.reasons.join(' | ')}]`);
    });

    // Slot còn trống phải trừ luôn cả tín hiệu đang pending (sắp chiếm slot)
    // để không duyệt dư quá CONFIG.maxOpenPositions.
    const availableSlots = CONFIG.maxOpenPositions - activePositions.length - pendingSignals.length;
    const winners = candidateSignals.slice(0, Math.max(0, availableSlots));

    for (const winner of winners) {
      const { instId, symbol, signal } = winner;

      if (CONFIG.entryDelayBars > 0) {
        // ENTRY DELAY: không mở ngay, đưa vào hàng đợi chờ xác nhận thêm
        // CONFIG.entryDelayBars nến M15 (~CONFIG.entryDelayBars*15 phút) rồi
        // mới thật sự khớp lệnh - xem processPendingSignals().
        console.log(`\n⏳ [CHỜ XÁC NHẬN] ${signal.direction} ${symbol} (${winner.score}đ) - đưa vào hàng đợi, chờ ${CONFIG.entryDelayBars * 15} phút xác nhận trước khi vào lệnh thật.`);
        pendingSignals.push({
          instId,
          symbol,
          signal,
          score: winner.score,
          reasons: winner.reasons,
          detectedAt: Date.now()
        });
        savePendingSignals();
        continue;
      }

      console.log(`\n🚀 [KÍCH HOẠT LỆNH] Tuyển chọn CON KHỎE NHẤT: ${signal.direction} ${symbol} (${winner.score}đ)`);

      // Quản trị rủi ro thích ứng
      const riskMult = getAdaptiveRiskMultiplier();
      if (riskMult < 1.0) {
        signal.sizing.size = signal.sizing.size * riskMult;
        signal.sizing.notional = signal.sizing.notional * riskMult;
        signal.sizing.margin = signal.sizing.margin * riskMult;
        console.log(`[RISK PENALTY] Giảm size theo kỷ luật cho ${symbol}: size = ${signal.sizing.size.toFixed(4)}`);
      }

      await openPositionNow(instId, symbol, signal, winner.score, winner.reasons);
    }
  }
}

// Xử lý hàng đợi tín hiệu đang chờ xác nhận (ENTRY DELAY): kiểm tra mỗi chu
// kỳ quét (mỗi CONFIG.pollIntervalSec giây) xem đã đủ thời gian chờ chưa, và
// SL/TP gốc đã bị chạm trước khi kịp vào chưa (coi như setup thất bại trước
// khi xác nhận xong -> huỷ, không vào lệnh - đúng hành vi đã backtest).
async function processPendingSignals() {
  if (pendingSignals.length === 0) return;

  const delayMs = CONFIG.entryDelayBars * 15 * 60 * 1000;
  const stillPending = [];
  let changed = false;

  for (const pending of pendingSignals) {
    const { instId, symbol, signal, score, reasons, detectedAt } = pending;
    try {
      // Lấy dư nến hơn mức cần (+4 đệm) để chắc chắn phủ hết khoảng thời gian
      // chờ, kể cả khi CONFIG.entryDelayBars bị chỉnh cao hơn mặc định sau này.
      const candlesM15Raw = await fetchOkxCandles(instId, '15m', CONFIG.entryDelayBars + 4);
      const closedM15 = candlesM15Raw.filter(c => c.confirm === 1);
      if (closedM15.length === 0) { stillPending.push(pending); continue; }

      const isLong = signal.direction === 'LONG';
      // Kiểm tra TOÀN BỘ nến M15 đã đóng kể từ lúc phát hiện tín hiệu (không
      // chỉ nến mới nhất) để không bỏ sót trường hợp SL/TP bị chạm giữa 2 lần
      // quét (poll mỗi 60s nhưng nến M15 đóng mỗi 15 phút).
      const barsSinceDetect = closedM15.filter(c => c.ts >= detectedAt - 15 * 60 * 1000);
      let invalidated = false;
      for (const bar of barsSinceDetect) {
        if (isLong) {
          if (bar.low <= signal.stopLoss || bar.high >= signal.takeProfit) { invalidated = true; break; }
        } else {
          if (bar.high >= signal.stopLoss || bar.low <= signal.takeProfit) { invalidated = true; break; }
        }
      }

      if (invalidated) {
        console.log(`[PENDING HỦY] ${symbol} ${signal.direction}: SL/TP gốc đã bị chạm trước khi kịp xác nhận -> huỷ, không vào lệnh.`);
        changed = true;
        continue;
      }

      const elapsedMs = Date.now() - detectedAt;
      if (elapsedMs < delayMs) {
        stillPending.push(pending);
        continue;
      }

      // Phòng vệ: nếu bằng cách nào đó instId đã có vị thế mở (lý thuyết
      // không xảy ra vì scanUniverseForCandidates đã chặn trùng, nhưng vẫn
      // kiểm tra lại cho chắc trước khi mở thêm) -> huỷ pending, không mở đè.
      if (activePositions.some(p => p.instId === instId)) {
        console.log(`[PENDING HỦY] ${symbol}: đã có vị thế mở cho ${instId}, huỷ pending để tránh trùng.`);
        changed = true;
        continue;
      }

      // Đủ thời gian chờ, chưa bị huỷ -> khớp lệnh thật tại giá hiện tại
      const finalEntry = closedM15[closedM15.length - 1].close;
      const riskDist = Math.abs(finalEntry - signal.stopLoss);
      if (riskDist <= 0) {
        console.log(`[PENDING HỦY] ${symbol}: riskDist <= 0 sau khi chờ, dữ liệu bất thường -> huỷ.`);
        changed = true;
        continue;
      }
      const rr = isLong
        ? (signal.takeProfit - finalEntry) / riskDist
        : (finalEntry - signal.takeProfit) / riskDist;
      if (rr < 1.0) {
        console.log(`[PENDING HỦY] ${symbol} ${signal.direction}: RR sau khi chờ chỉ còn ${rr.toFixed(2)} (<1.0, giá đã chạy xa) -> huỷ, không vào lệnh.`);
        changed = true;
        continue;
      }

      const finalSignal = {
        ...signal,
        entry: finalEntry,
        sizing: calculatePositionSize(finalEntry, signal.stopLoss, CONFIG.riskUsd, CONFIG.leverage),
        riskReward: parseFloat(rr.toFixed(2))
      };

      const riskMult = getAdaptiveRiskMultiplier();
      if (riskMult < 1.0) {
        finalSignal.sizing.size *= riskMult;
        finalSignal.sizing.notional *= riskMult;
        finalSignal.sizing.margin *= riskMult;
      }

      console.log(`\n🚀 [KÍCH HOẠT LỆNH SAU XÁC NHẬN] ${signal.direction} ${symbol} (${score}đ) - entry đã cập nhật: ${finalEntry}`);
      await openPositionNow(instId, symbol, finalSignal, score, reasons);
      changed = true;
    } catch (err) {
      console.error(`[PENDING] Lỗi xử lý ${symbol}:`, err.message);
      stillPending.push(pending);
    }
  }

  pendingSignals = stillPending;
  if (changed) savePendingSignals();
}

/**
 * Chu kỳ quét thị trường chính
 */
export async function runScanCycle() {
  const timeStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  console.log(`\n======================================================`);
  console.log(`[SCAN CYCLE] Bắt đầu quét thị trường lúc: ${timeStr}`);
  console.log(`[MODE] ${CONFIG.scanMode} | Đang mở: ${activePositions.length} vị thế`);

  // 1. Tải nến Đầu Tàu BTC (H4 & 1H) để kích hoạt Bộ Chỉ Huy Đầu Tàu
  const [rawBtcH4, rawBtcH1] = await Promise.all([
    fetchOkxCandles('BTC-USDT-SWAP', '4H', 40),
    fetchOkxCandles('BTC-USDT-SWAP', '1H', 30)
  ]);
  const btcH4 = rawBtcH4.filter(c => c.confirm === 1);
  const btcH1 = rawBtcH1.filter(c => c.confirm === 1);

  // 1.1. Luôn cập nhật giá thời gian thực cho TẤT CẢ các vị thế đang mở
  await updateOpenPositionPrices();

  // 1.2. Xử lý hàng đợi tín hiệu đang chờ xác nhận (ENTRY DELAY) TRƯỚC khi
  // quét tín hiệu mới - để giải phóng slot kịp thời nếu có tín hiệu bị huỷ.
  await processPendingSignals();

  // 1.3. LỊCH TIN TỨC: tạm dừng VÀO LỆNH MỚI quanh tin lớn Mỹ (FOMC/CPI/NFP)
  // để tránh bị quét 2 đầu lúc giá giật mạnh. VẪN quản lý lệnh đang mở bình
  // thường (SL/TP/trailing ở updateOpenPositionPrices phía trên). Bật/tắt qua
  // ENABLE_NEWS_FILTER (mặc định BẬT), bán kính vùng cấm NEWS_BLACKOUT_HOURS.
  if (process.env.ENABLE_NEWS_FILTER !== 'false') {
    const blackoutHours = parseFloat(process.env.NEWS_BLACKOUT_HOURS || '2');
    const news = isNewsBlackout(Date.now(), blackoutHours);
    if (news.blocked) {
      const when = news.minutesToEvent >= 0
        ? `còn ${news.minutesToEvent} phút nữa ra tin`
        : `vừa ra tin ${Math.abs(news.minutesToEvent)} phút trước`;
      console.log(`[NEWS FILTER] ⏸️ Tạm dừng vào lệnh mới quanh tin lớn: ${news.event} (${when}). Chỉ quản lý lệnh đang mở.`);
      console.log(`[SCAN CYCLE] Hoàn tất chu kỳ (news blackout). Chờ ${CONFIG.pollIntervalSec}s...`);
      return;
    }
  }

  // 2 & 3. Quét universe tìm ứng viên, rồi chọn Con Khỏe Nhất để vào lệnh
  const candidateSignals = await scanUniverseForCandidates(btcH4, btcH1);
  await pickAndExecuteWinners(candidateSignals);

  // Tự động kiểm tra và phát Bản tin Smart Money AI vào đầu mỗi buổi sáng (07:00 VN)
  await checkAndTriggerDailyBriefing();

  console.log(`[SCAN CYCLE] Hoàn tất chu kỳ. Chờ ${CONFIG.pollIntervalSec}s...`);
}

const BRIEFING_STATE_FILE = 'data/last_briefing.txt';

function getLastBriefingDate() {
  try {
    if (fs.existsSync(BRIEFING_STATE_FILE)) {
      return fs.readFileSync(BRIEFING_STATE_FILE, 'utf8').trim();
    }
  } catch {}
  return '';
}

function saveLastBriefingDate(dateStr) {
  try {
    fs.writeFileSync(BRIEFING_STATE_FILE, dateStr, 'utf8');
  } catch {}
}

async function checkAndTriggerDailyBriefing() {
  const now = new Date();
  const vnDateStr = now.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const vnHour = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, hour: '2-digit' }), 10);

  const lastSavedDate = getLastBriefingDate();

  // Chỉ kích hoạt duy nhất vào khung giờ 07:00 - 08:59 sáng giờ VN, mỗi ngày chỉ gửi đúng 1 lần
  if (vnHour >= 7 && vnHour < 9 && lastSavedDate !== vnDateStr && process.env.GEMINI_API_KEY) {
    saveLastBriefingDate(vnDateStr);
    console.log(`[AI AGENT] Kích hoạt Bản tin Smart Money Buổi Sáng (${vnDateStr})...`);
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
  loadPendingSignals();
  const isSingleRun = process.argv.includes('--single-run') || process.argv.includes('--dry-run');

  if (isSingleRun) {
    console.log('[RUNTIME] Chạy chế độ Single-Run / Dry-Run (Quét 1 lần)...');
    await safeRunScanCycle();
    process.exit(0);
  }

  console.log(`[RUNTIME] Khởi động Bot Live Scanner (Chu kỳ: ${CONFIG.pollIntervalSec}s)...`);
  
  // Khởi động Trợ lý AI Tương tác 2 Chiều trên Telegram (Gemini 3.8 Flash Vision)
  startTelegramListener({ fetchOkxCandles, getActivePositions: () => activePositions, getPendingSignals: () => pendingSignals });

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

