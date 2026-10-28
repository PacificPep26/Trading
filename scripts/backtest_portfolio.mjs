/**
 * BACKTEST_PORTFOLIO.MJS
 * Backtest CẤP DANH MỤC (không phải từng coin độc lập) - gộp cả watchlist
 * theo đúng trình tự thời gian thật, theo dõi số slot đang chiếm (lệnh mở +
 * lệnh đang chờ xác nhận) TẠI MỌI THỜI ĐIỂM trên toàn danh mục, để test ý
 * tưởng: "slot đầu tiên trống thì vào ngay (delay=0), các slot sau phải chờ
 * xác nhận (delay=cfg.entryDelayBars)".
 *
 * Khác biệt cốt lõi với backtest_1year.mjs: backtest_1year.mjs chạy từng
 * coin HOÀN TOÀN ĐỘC LẬP (không biết coin khác đang có lệnh hay không) - nên
 * không thể trả lời câu hỏi "slot thứ mấy". Script này dùng 1 vòng lặp thời
 * gian DUY NHẤT cho cả danh mục, tra cứu nến từng coin theo đúng mốc thời
 * gian thật (ts), không giả định các coin thẳng hàng theo index.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';
import { evaluateMarket, calculateSetupQualityScore, calculatePositionSize } from '../src/engine.js';
import { BOT_CONFIG, UNIVERSE_CONFIG } from '../src/config.js';
import { inspectTradeMistake, applyDisciplinaryPenalty, checkAdaptiveTradeAllowed, rewardWinAndClearPenalty } from '../src/learning.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache_1year');

const SYMBOLS = UNIVERSE_CONFIG.premierWatchlist
  .map(s => s.endsWith('-SWAP') ? s : s + '-SWAP')
  .filter(s => s !== 'HYPE-USDT-SWAP'); // HYPE chưa có đủ cache 1 năm

const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const H4_MS = 4 * 60 * 60 * 1000;
const D1_MS = 24 * 60 * 60 * 1000;
const START_TS = new Date('2025-10-01T00:00:00Z').getTime();

function loadJson(f) {
  if (!fs.existsSync(f)) return [];
  return JSON.parse(fs.readFileSync(f, 'utf8')).map(normalizeCandle);
}

function buildTsIndex(candles) {
  const map = new Map();
  candles.forEach((c, idx) => map.set(c.ts, idx));
  return map;
}

export async function runPortfolioBacktest(customConfig = null) {
  const cfg = customConfig || BOT_CONFIG;

  const btcH1 = loadJson(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json'));
  const btcH4 = loadJson(path.join(CACHE_DIR, 'BTC-USDT-SWAP_4H.json'));

  // Nạp toàn bộ dữ liệu từng coin + xây index tra cứu theo ts
  const coinData = {};
  for (const instId of SYMBOLS) {
    const symbol = instId.replace('-SWAP', '');
    const candlesH4 = loadJson(path.join(CACHE_DIR, `${instId}_4H.json`));
    const candlesH1 = loadJson(path.join(CACHE_DIR, `${instId}_1H.json`));
    const candlesM15 = loadJson(path.join(CACHE_DIR, `${instId}_15m.json`));
    const candlesD1 = loadJson(path.join(CACHE_DIR, `${instId}_1Dutc.json`));
    if (candlesM15.length === 0) continue;
    coinData[instId] = {
      symbol, candlesH4, candlesH1, candlesM15, candlesD1,
      m15Index: buildTsIndex(candlesM15),
      h4Index: buildTsIndex(candlesH4),
      h1Index: buildTsIndex(candlesH1),
      d1Index: buildTsIndex(candlesD1),
      state: null,       // { type: 'OPEN', trade: {...} } | { type: 'PENDING', pending: {...} } | null
    };
  }
  const btcH1Index = buildTsIndex(btcH1);
  const btcH4Index = buildTsIndex(btcH4);

  // Master timeline: hợp nhất toàn bộ mốc ts M15 của mọi coin, sắp xếp tăng dần
  const tsSet = new Set();
  for (const d of Object.values(coinData)) {
    for (const c of d.candlesM15) {
      if (c.ts >= START_TS) tsSet.add(c.ts);
    }
  }
  const masterTimeline = Array.from(tsSet).sort((a, b) => a - b);

  const closedTrades = [];

  // Hàm phụ: tìm index gần nhất <= ts trong 1 mảng nến đã sort theo thời gian
  function findPointerAt(candles, ts) {
    // Binary search tìm index lớn nhất có candles[idx].ts + duration <= ts
    // Đơn giản hoá: dùng tsIndex map trước, nếu không có thì linear fallback hiếm khi cần
    let lo = 0, hi = candles.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (candles[mid].ts <= ts) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return ans;
  }

  // learning.js dùng Date.now() (đồng hồ thật) để tính hạn phạt/cooldown -
  // nếu không giả lập, 1 án phạt đầu tiên trong backtest sẽ KHÔNG BAO GIỜ
  // hết hạn (vì thời gian thật không trôi đủ trong lúc backtest chạy qua dữ
  // liệu lịch sử chỉ mất vài giây thực tế). Giả lập Date.now = masterTs khi
  // mô phỏng penalty, khôi phục lại cuối hàm.
  const originalDateNow = Date.now;
  let currentMockTs = 0;
  if (cfg.simulatePenaltySystem) {
    Date.now = () => currentMockTs;
  }

  for (const masterTs of masterTimeline) {
    currentMockTs = masterTs;
    // ---- 1. Quản lý TẤT CẢ lệnh đang mở (mọi coin) ----
    for (const instId of Object.keys(coinData)) {
      const d = coinData[instId];
      if (!d.state || d.state.type !== 'OPEN') continue;
      const m15Idx = d.m15Index.get(masterTs);
      if (m15Idx === undefined) continue; // Coin này không có nến đúng mốc thời gian này
      const currentM15 = d.candlesM15[m15Idx];
      const trade = d.state.trade;
      trade.barsHeld++;
      const isLong = trade.direction === 'LONG';
      const riskDist = Math.abs(trade.entry - trade.initialStopLoss);

      const favorablePrice = isLong ? currentM15.high : currentM15.low;
      const curMaxR = isLong ? (favorablePrice - trade.entry) / riskDist : (trade.entry - favorablePrice) / riskDist;
      if (!trade.isProfitLocked && curMaxR >= cfg.beTriggerR) {
        trade.isProfitLocked = true;
        trade.stopLoss = isLong ? trade.entry + (cfg.lockProfitR * riskDist) : trade.entry - (cfg.lockProfitR * riskDist);
      }

      const isSLHit = isLong ? (currentM15.low <= trade.stopLoss) : (currentM15.high >= trade.stopLoss);
      const isTPHit = isLong ? (currentM15.high >= trade.takeProfit) : (currentM15.low <= trade.takeProfit);

      if (isSLHit) {
        const exitPrice = trade.stopLoss;
        const grossPnl = isLong ? (exitPrice - trade.entry) * trade.sizing.size : (trade.entry - exitPrice) * trade.sizing.size;
        const fee = trade.sizing.notional * cfg.feeRate;
        closedTrades.push({ ...trade, exitTime: masterTs + M15_MS, exitPrice, outcome: trade.isProfitLocked ? 'LOCK_+1R' : 'SL', netR: trade.isProfitLocked ? cfg.lockProfitR : -1.0, netUsd: grossPnl - fee });
        d.state = null;

        // MÔ PHỎNG HỆ THỐNG PENALTY THẬT (learning.js) khi SL thua thật sự
        // (không phải LOCK_+1R, đúng hành vi live server.js). Chỉ chạy khi
        // cfg.simulatePenaltySystem=true - xem docs/REGIME_ADAPTIVE_PLAN.md.
        if (cfg.simulatePenaltySystem) {
          if (!trade.isProfitLocked) {
            const h4Idx = findPointerAt(d.candlesH4, masterTs + M15_MS - H4_MS);
            const h1Idx = findPointerAt(d.candlesH1, masterTs + M15_MS - H1_MS);
            const bH4Idx = findPointerAt(btcH4, masterTs + M15_MS - H4_MS);
            const bH1Idx = findPointerAt(btcH1, masterTs + M15_MS - H1_MS);
            const mistake = inspectTradeMistake({
              pos: { symbol: d.symbol, direction: trade.direction, entry: trade.entry, initialStopLoss: trade.initialStopLoss },
              candlesH4: d.candlesH4.slice(Math.max(0, h4Idx - 25), h4Idx + 1),
              candlesH1: d.candlesH1.slice(Math.max(0, h1Idx - 15), h1Idx + 1),
              candlesM15: d.candlesM15.slice(Math.max(0, m15Idx - 20), m15Idx + 1),
              btcH4Candles: btcH4.slice(Math.max(0, bH4Idx - 35), bH4Idx + 1),
              btcH1Candles: btcH1.slice(Math.max(0, bH1Idx - 15), bH1Idx + 1)
            });
            applyDisciplinaryPenalty({ symbol: d.symbol, direction: trade.direction, entry: trade.entry, initialStopLoss: trade.initialStopLoss }, mistake);
          } else {
            rewardWinAndClearPenalty(d.symbol);
          }
        }
      } else if (isTPHit) {
        const exitPrice = trade.takeProfit;
        const grossPnl = isLong ? (exitPrice - trade.entry) * trade.sizing.size : (trade.entry - exitPrice) * trade.sizing.size;
        const fee = trade.sizing.notional * cfg.feeRate;
        closedTrades.push({ ...trade, exitTime: masterTs + M15_MS, exitPrice, outcome: 'TP', netR: trade.riskReward, netUsd: grossPnl - fee });
        d.state = null;
        if (cfg.simulatePenaltySystem) rewardWinAndClearPenalty(d.symbol);
      }
    }

    // ---- 2. Xử lý hàng đợi PENDING (mọi coin) ----
    for (const instId of Object.keys(coinData)) {
      const d = coinData[instId];
      if (!d.state || d.state.type !== 'PENDING') continue;
      const p = d.state.pending;
      const m15Idx = d.m15Index.get(masterTs);
      if (m15Idx === undefined) continue;
      const currentM15 = d.candlesM15[m15Idx];
      const isLong = p.signal.direction === 'LONG';

      if (isLong) {
        if (currentM15.low <= p.signal.stopLoss || currentM15.high >= p.signal.takeProfit) { d.state = null; continue; }
      } else {
        if (currentM15.high >= p.signal.stopLoss || currentM15.low <= p.signal.takeProfit) { d.state = null; continue; }
      }

      p.barsWaited++;
      if (p.barsWaited < p.assignedDelayBars) continue;

      const finalEntry = currentM15.close;
      const riskDist = Math.abs(finalEntry - p.signal.stopLoss);
      if (riskDist <= 0) { d.state = null; continue; }
      const rr = isLong ? (p.signal.takeProfit - finalEntry) / riskDist : (finalEntry - p.signal.takeProfit) / riskDist;
      if (rr < 1.0) { d.state = null; continue; }

      d.state = {
        type: 'OPEN',
        trade: {
          ...p.signal,
          entry: finalEntry,
          sizing: calculatePositionSize(finalEntry, p.signal.stopLoss, cfg.riskUsd, cfg.leverage),
          riskReward: parseFloat(rr.toFixed(2)),
          qualityScore: p.score,
          entryTime: masterTs,
          initialStopLoss: p.signal.stopLoss,
          isProfitLocked: false,
          barsHeld: 0,
          assignedSlotRank: p.assignedSlotRank
        }
      };
    }

    // ---- 3. Quét tín hiệu mới cho coin đang rảnh (không OPEN, không PENDING) ----
    // Số slot đang chiếm = tổng (OPEN + PENDING) hiện tại trên toàn danh mục.
    let occupiedSlots = Object.values(coinData).filter(d => d.state !== null).length;
    if (occupiedSlots >= cfg.maxOpenPositions) continue;

    for (const instId of Object.keys(coinData)) {
      if (occupiedSlots >= cfg.maxOpenPositions) break;
      const d = coinData[instId];
      if (d.state !== null) continue;

      const m15Idx = d.m15Index.get(masterTs);
      if (m15Idx === undefined || m15Idx < 40) continue;
      const h4Pointer = findPointerAt(d.candlesH4, masterTs + M15_MS - H4_MS);
      const h1Pointer = findPointerAt(d.candlesH1, masterTs + M15_MS - H1_MS);
      const d1Pointer = findPointerAt(d.candlesD1, masterTs - D1_MS);
      const btcH1Pointer = findPointerAt(btcH1, masterTs + M15_MS - H1_MS);
      const btcH4Pointer = findPointerAt(btcH4, masterTs + M15_MS - H4_MS);
      if (h4Pointer < 90 || h1Pointer < 15) continue;

      const visibleH4 = d.candlesH4.slice(Math.max(0, h4Pointer - 150), h4Pointer + 1);
      const visibleH1 = d.candlesH1.slice(Math.max(0, h1Pointer - 40), h1Pointer + 1);
      const visibleM15 = d.candlesM15.slice(Math.max(0, m15Idx - 40), m15Idx + 1);
      const visibleD1 = d1Pointer >= 90 ? d.candlesD1.slice(Math.max(0, d1Pointer - 150), d1Pointer + 1) : null;
      const visibleBtcH1 = btcH1Pointer >= 15 ? btcH1.slice(Math.max(0, btcH1Pointer - 40), btcH1Pointer + 1) : null;
      const visibleBtcH4 = btcH4Pointer >= 35 ? btcH4.slice(Math.max(0, btcH4Pointer - 100), btcH4Pointer + 1) : null;

      const signal = evaluateMarket({
        symbol: d.symbol, candlesH4: visibleH4, candlesH1: visibleH1, candlesM15: visibleM15,
        candlesD1: visibleD1, btcH1Candles: visibleBtcH1, btcH4Candles: visibleBtcH4, config: cfg
      });
      if (!signal || signal.isBlocked) continue;

      const quality = calculateSetupQualityScore({ signal, candlesH4: visibleH4, candlesH1: visibleH1, candlesM15: visibleM15, btcH1Candles: visibleBtcH1 });
      if (quality.score < (cfg.minSetupQualityScore || 75)) continue;

      // CỔNG KIỂM TRA ÁN PHẠT (chỉ khi cfg.simulatePenaltySystem=true) - đúng
      // hành vi live server.js: checkAdaptiveTradeAllowed() trước khi chấp
      // nhận tín hiệu.
      if (cfg.simulatePenaltySystem) {
        const allowCheck = checkAdaptiveTradeAllowed(d.symbol, signal.direction, visibleBtcH1, visibleBtcH4);
        if (!allowCheck.allowed) continue;
      }

      // QUYẾT ĐỊNH SLOT: slot đầu tiên trống (occupiedSlots===0 tại lúc này)
      // -> vào NGAY (delay=0). Slot thứ 2 trở đi -> phải chờ xác nhận
      // (delay=cfg.entryDelayBars).
      const slotRank = occupiedSlots + 1; // 1 = slot đầu tiên
      // cfg.firstSlotInstant=true -> slot đầu tiên vào NGAY (delay=0), các
      // slot sau chờ xác nhận bình thường. Mặc định false = mọi slot đều
      // chờ giống nhau (đúng hành vi live hiện tại, dùng làm baseline so sánh).
      const assignedDelayBars = (cfg.firstSlotInstant && slotRank === 1) ? 0 : (cfg.entryDelayBars || 0);

      if (assignedDelayBars === 0) {
        d.state = {
          type: 'OPEN',
          trade: {
            ...signal,
            qualityScore: quality.score,
            entryTime: masterTs,
            initialStopLoss: signal.stopLoss,
            isProfitLocked: false,
            barsHeld: 0,
            assignedSlotRank: slotRank
          }
        };
      } else {
        d.state = {
          type: 'PENDING',
          pending: { signal, score: quality.score, assignedDelayBars, assignedSlotRank: slotRank, barsWaited: 0 }
        };
      }
      occupiedSlots++;
    }
  }

  Date.now = originalDateNow;
  return closedTrades;
}

function calculateMetrics(trades) {
  if (!trades || trades.length === 0) return { count: 0, pf: '0.00', totalR: '0.00R', netUsd: '$0.00', maxDD: '0.00R' };
  const wins = trades.filter(t => t.netUsd > 0).reduce((a, t) => a + t.netUsd, 0);
  const losses = Math.abs(trades.filter(t => t.netUsd < 0).reduce((a, t) => a + t.netUsd, 0));
  const pf = losses > 0 ? wins / losses : (wins > 0 ? Infinity : 0);
  const totalR = trades.reduce((a, t) => a + t.netR, 0);
  const netUsd = trades.reduce((a, t) => a + t.netUsd, 0);
  let peak = 0, running = 0, maxDD = 0;
  for (const t of trades) { running += t.netR; if (running > peak) peak = running; const dd = running - peak; if (dd < maxDD) maxDD = dd; }
  return {
    count: trades.length,
    pf: isFinite(pf) ? pf.toFixed(2) : '∞',
    totalR: (totalR >= 0 ? '+' : '') + totalR.toFixed(2) + 'R',
    netUsd: '$' + netUsd.toFixed(2),
    maxDD: maxDD.toFixed(2) + 'R'
  };
}

async function main() {
  console.log('================================================================');
  console.log('🧭 PORTFOLIO BACKTEST - "Slot đầu vào ngay, slot sau chờ xác nhận"');
  console.log('================================================================\n');

  console.log('--- Baseline: TẤT CẢ slot đều chờ xác nhận (delay=4, hành vi live hiện tại) ---');
  const baselineCfg = { ...BOT_CONFIG, maxOpenPositions: 3, firstSlotInstant: false };
  const baselineTrades = await runPortfolioBacktest(baselineCfg);
  console.log(calculateMetrics(baselineTrades));

  console.log('\n--- Hybrid: Slot 1 vào ngay (delay=0), Slot 2-3 chờ xác nhận (delay=4) ---');
  const hybridCfg = { ...BOT_CONFIG, maxOpenPositions: 3, firstSlotInstant: true };
  const hybridTrades = await runPortfolioBacktest(hybridCfg);
  console.log(calculateMetrics(hybridTrades));

  const bySlot = { 1: [], 2: [], 3: [] };
  for (const t of hybridTrades) {
    const rank = t.assignedSlotRank || 1;
    if (bySlot[rank]) bySlot[rank].push(t);
  }
  console.log('\nPhân tích theo thứ hạng slot (bản Hybrid):');
  for (const [rank, trades] of Object.entries(bySlot)) {
    console.log(`  Slot ${rank}: ${trades.length} lệnh | ${JSON.stringify(calculateMetrics(trades))}`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch(err => console.error(err));
}
