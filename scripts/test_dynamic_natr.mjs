/**
 * TEST_DYNAMIC_NATR.MJS
 * Thử nghiệm đề xuất 4.2 của Reviewer:
 * Đo NATR_D1 = ATR(14, D1) / Close(D1).
 * Khi NATR_D1 < ngưỡng (thị trường mùa đông nén biến động):
 * - Tắt KANE_THUAN_TREND (chỉ cho phép SMC_ZONE_REACTION hoạt động tại cản lớn)
 * - Co giãn beTriggerR = 1.0R (thay vì 1.4R) để bảo vệ vốn sớm.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle, calculateATR, calculateEMA } from '../src/indicators.js';
import { evaluateMarket } from '../src/engine.js';
import { BOT_CONFIG } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache_1year');

const SYMBOLS = [
  'BTC-USDT-SWAP',
  'ETH-USDT-SWAP',
  'SOL-USDT-SWAP',
  'LINK-USDT-SWAP',
  'NEAR-USDT-SWAP'
];

const PERIODS = [
  { label: '2021 (Bull mạnh)', start: '2021-01-01', end: '2021-12-31' },
  { label: '2022 (Bear mạnh - Luna/FTX sập)', start: '2022-01-01', end: '2022-12-31' },
  { label: '2023 (Tích lũy/Sideway)', start: '2023-01-01', end: '2023-12-31' },
  { label: '2024 (Bull trở lại)', start: '2024-01-01', end: '2024-12-31' },
  { label: '2025 (tới nay)', start: '2025-01-01', end: '2026-10-24' }
];

function computeStats(trades) {
  if (trades.length === 0) return { count: 0, winRate: '-', pf: '-', totalR: '0.00R', netR: 0, maxDDR: '0.00R' };
  const wins = trades.filter(t => t.netR > 0);
  const losses = trades.filter(t => t.netR < 0);
  const totalR = trades.reduce((s, t) => s + t.netR, 0);
  const grossWinR = wins.reduce((s, t) => s + t.netR, 0);
  const grossLossR = Math.abs(losses.reduce((s, t) => s + t.netR, 0));
  const pf = grossLossR > 0 ? (grossWinR / grossLossR) : (grossWinR > 0 ? Infinity : 0);

  let peak = 0;
  let running = 0;
  let maxDD = 0;
  for (const t of trades) {
    running += t.netR;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    count: trades.length,
    winRate: (wins.length / trades.length * 100).toFixed(1) + '%',
    pf: pf.toFixed(2),
    totalR: (totalR >= 0 ? '+' : '') + totalR.toFixed(2) + 'R',
    netR: totalR,
    maxDDR: '-' + maxDD.toFixed(2) + 'R'
  };
}

// Giả lập backtestSymbol với Dynamic NATR_D1 logic
async function backtestWithNatrFilter(instId, btcH1Candles, btcH4Candles, startTs, endTs, natrThreshold = 0.035, disableKaneTrend = true, dynamicBE = true) {
  const fH4 = path.join(CACHE_DIR, `${instId}_4H.json`);
  const fH1 = path.join(CACHE_DIR, `${instId}_1H.json`);
  const fM15 = path.join(CACHE_DIR, `${instId}_15m.json`);
  const fD1 = path.join(CACHE_DIR, `${instId}_1Dutc.json`);

  if (!fs.existsSync(fH4) || !fs.existsSync(fH1) || !fs.existsSync(fM15)) return [];

  const candlesH4 = JSON.parse(fs.readFileSync(fH4, 'utf8')).map(normalizeCandle);
  const candlesH1 = JSON.parse(fs.readFileSync(fH1, 'utf8')).map(normalizeCandle);
  const candlesM15 = JSON.parse(fs.readFileSync(fM15, 'utf8')).map(normalizeCandle);
  const candlesD1 = fs.existsSync(fD1) ? JSON.parse(fs.readFileSync(fD1, 'utf8')).map(normalizeCandle) : [];

  const atrD1Arr = candlesD1.length > 14 ? calculateATR(candlesD1, 14) : [];

  const symbol = instId.replace('-SWAP', '');
  const cfg = BOT_CONFIG;
  const takerRate = cfg.capital?.takerFeeRate ?? 0.0008;
  const makerRate = cfg.capital?.makerFeeRate ?? 0.0002;
  const slippage = 0.0003;

  function roundtripFee(notional, exitKind) {
    const entryRate = takerRate;
    const exitRate = exitKind === 'TP' ? makerRate : exitKind === 'SL' ? (takerRate + slippage) : takerRate;
    const feeUsd = notional * (entryRate + exitRate);
    return { feeUsd, feeR: feeUsd / cfg.riskUsd };
  }

  const closedTrades = [];
  let activeTrade = null;

  let h4Pointer = 0;
  let h1Pointer = 0;
  let d1Pointer = 0;
  let btcH1Pointer = 0;
  let btcH4Pointer = 0;

  const total = candlesM15.length;
  for (let i = 0; i < total; i++) {
    const currentM15 = candlesM15[i];
    const m15CloseTime = currentM15.ts;

    if (m15CloseTime < startTs) continue;
    if (m15CloseTime > endTs) break;

    // Quản lý vị thế đang mở
    if (activeTrade) {
      activeTrade.barsHeld++;
      const isLong = activeTrade.direction === 'LONG';
      const riskDist = Math.abs(activeTrade.entry - activeTrade.initialStopLoss);
      const favorablePrice = isLong ? currentM15.high : currentM15.low;
      const curMaxR = isLong ? (favorablePrice - activeTrade.entry) / riskDist : (activeTrade.entry - favorablePrice) / riskDist;

      // Trailing Lock Profit (có hỗ trợ Dynamic BE)
      const triggerR = activeTrade.customBeTriggerR || cfg.beTriggerR;
      if (!activeTrade.isProfitLocked && curMaxR >= triggerR) {
        activeTrade.isProfitLocked = true;
        activeTrade.stopLoss = isLong ? activeTrade.entry + (cfg.lockProfitR * riskDist) : activeTrade.entry - (cfg.lockProfitR * riskDist);
      }

      const isSLHit = isLong ? (currentM15.low <= activeTrade.stopLoss) : (currentM15.high >= activeTrade.stopLoss);
      const isTPHit = isLong ? (currentM15.high >= activeTrade.takeProfit) : (currentM15.low <= activeTrade.takeProfit);

      if (isSLHit) {
        const exitPrice = activeTrade.stopLoss;
        const grossPnl = isLong ? (exitPrice - activeTrade.entry) * activeTrade.sizing.size : (activeTrade.entry - exitPrice) * activeTrade.sizing.size;
        const { feeUsd, feeR } = roundtripFee(activeTrade.sizing.notional, 'SL');
        const grossR = activeTrade.isProfitLocked ? cfg.lockProfitR : -1.0;
        closedTrades.push({
          ...activeTrade,
          exitTime: m15CloseTime,
          exitPrice,
          outcome: activeTrade.isProfitLocked ? 'LOCK_+1R' : 'SL',
          netR: grossR - feeR,
          netUsd: grossPnl - feeUsd
        });
        activeTrade = null;
      } else if (isTPHit) {
        const exitPrice = activeTrade.takeProfit;
        const grossPnl = isLong ? (exitPrice - activeTrade.entry) * activeTrade.sizing.size : (activeTrade.entry - exitPrice) * activeTrade.sizing.size;
        const { feeUsd, feeR } = roundtripFee(activeTrade.sizing.notional, 'TP');
        closedTrades.push({
          ...activeTrade,
          exitTime: m15CloseTime,
          exitPrice,
          outcome: 'TP',
          netR: activeTrade.riskReward - feeR,
          netUsd: grossPnl - feeUsd
        });
        activeTrade = null;
      }
    }

    // Dịch chuyển pointer chống look-ahead
    while (h4Pointer < candlesH4.length && candlesH4[h4Pointer].ts <= m15CloseTime) h4Pointer++;
    while (h1Pointer < candlesH1.length && candlesH1[h1Pointer].ts <= m15CloseTime) h1Pointer++;
    while (d1Pointer < candlesD1.length && candlesD1[d1Pointer].ts <= m15CloseTime) d1Pointer++;
    while (btcH1Pointer < btcH1Candles.length && btcH1Candles[btcH1Pointer].ts <= m15CloseTime) btcH1Pointer++;
    while (btcH4Pointer < btcH4Candles.length && btcH4Candles[btcH4Pointer].ts <= m15CloseTime) btcH4Pointer++;

    if (!activeTrade) {
      const sliceH4 = candlesH4.slice(0, h4Pointer);
      const sliceH1 = candlesH1.slice(0, h1Pointer);
      const sliceM15 = candlesM15.slice(0, i + 1);
      const sliceD1 = candlesD1.slice(0, d1Pointer);
      const sliceBtcH1 = btcH1Candles.slice(0, btcH1Pointer);
      const sliceBtcH4 = btcH4Candles.slice(0, btcH4Pointer);

      // Tính NATR_D1 tại thời điểm hiện tại
      let natrD1 = 0.05;
      if (sliceD1.length > 14) {
        const lastD1Idx = sliceD1.length - 1;
        const lastAtr = atrD1Arr[lastD1Idx];
        if (lastAtr && sliceD1[lastD1Idx].close > 0) {
          natrD1 = lastAtr / sliceD1[lastD1Idx].close;
        }
      }

      const isLowVolD1 = natrD1 < natrThreshold;

      const signal = evaluateMarket({
        symbol,
        candlesH4: sliceH4,
        candlesH1: sliceH1,
        candlesM15: sliceM15,
        candlesD1: sliceD1,
        btcH1Candles: sliceBtcH1,
        btcH4Candles: sliceBtcH4,
        config: cfg
      });

      if (signal && !signal.isBlocked) {
        // ĐỀ XUẤT 4.2: Nếu đang ở chế độ mùa đông nén biến động (isLowVolD1)
        if (isLowVolD1 && disableKaneTrend) {
          // Tắt KANE_THUAN_TREND trong mùa đông (vì hầu hết false break)
          if (signal.strategy && signal.strategy.includes('KANE_THUAN_TREND')) {
            continue; // Bỏ qua setup này!
          }
        }

        // ENTRY DELAY 4 nến M15
        const delayBars = cfg.entryDelayBars || 0;
        let skipTrade = false;
        let finalEntry = signal.entry;
        let finalEntryTime = signal.entryTime || m15CloseTime;

        if (delayBars > 0) {
          for (let d = 1; d <= delayBars; d++) {
            const idx = i + d;
            if (idx >= total) { skipTrade = true; break; }
            const futureBar = candlesM15[idx];
            if (signal.direction === 'LONG') {
              if (futureBar.low <= signal.stopLoss || futureBar.high >= signal.takeProfit) { skipTrade = true; break; }
            } else {
              if (futureBar.high >= signal.stopLoss || futureBar.low <= signal.takeProfit) { skipTrade = true; break; }
            }
            finalEntry = futureBar.close;
            finalEntryTime = futureBar.ts;
          }
        }

        if (!skipTrade) {
          const riskDist = Math.abs(finalEntry - signal.stopLoss);
          if (riskDist <= 0) continue;
          const rewardDist = Math.abs(signal.takeProfit - finalEntry);
          const effectiveRR = rewardDist / riskDist;
          if (effectiveRR < 1.0) continue;

          // Co giãn beTriggerR = 1.0R nếu trong mùa đông
          const customBeTriggerR = (isLowVolD1 && dynamicBE) ? 1.0 : cfg.beTriggerR;

          activeTrade = {
            ...signal,
            entry: finalEntry,
            entryTime: finalEntryTime,
            initialStopLoss: signal.stopLoss,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            riskReward: effectiveRR,
            customBeTriggerR,
            isProfitLocked: false,
            barsHeld: 0
          };

          if (delayBars > 0) i += delayBars;
        }
      }
    }
  }

  return closedTrades;
}

async function runSweep() {
  const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json'), 'utf8')).map(normalizeCandle);
  const btcH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_4H.json'), 'utf8')).map(normalizeCandle);

  const configs = [
    { label: 'BASELINE (Không lọc NATR)', threshold: 0.0, disableKane: false, dynamicBE: false },
    { label: 'NATR < 3.0% (Tắt Kane Thuận Trend khi Low Vol)', threshold: 0.030, disableKane: true, dynamicBE: false },
    { label: 'NATR < 3.5% (Tắt Kane Thuận Trend khi Low Vol)', threshold: 0.035, disableKane: true, dynamicBE: false },
    { label: 'NATR < 4.0% (Tắt Kane Thuận Trend khi Low Vol)', threshold: 0.040, disableKane: true, dynamicBE: false },
    { label: 'NATR < 3.5% (Tắt Kane + Dynamic BE = 1.0R)', threshold: 0.035, disableKane: true, dynamicBE: true }
  ];

  for (const c of configs) {
    console.log(`\n======================================================`);
    console.log(`🧪 CHẠY: ${c.label}`);
    console.log(`======================================================`);

    const yearStats = [];
    let allTrades = [];

    for (const period of PERIODS) {
      const startTs = new Date(period.start + 'T00:00:00Z').getTime();
      const endTs = new Date(period.end + 'T23:59:59Z').getTime();

      let periodTrades = [];
      for (const instId of SYMBOLS) {
        const trades = await backtestWithNatrFilter(instId, btcH1, btcH4, startTs, endTs, c.threshold, c.disableKane, c.dynamicBE);
        periodTrades.push(...trades);
      }

      periodTrades.sort((a, b) => (a.entryTime || a.triggerTime) - (b.entryTime || b.triggerTime));
      const st = computeStats(periodTrades);
      yearStats.push({ label: period.label, ...st });
      allTrades.push(...periodTrades);
    }

    allTrades.sort((a, b) => (a.entryTime || a.triggerTime) - (b.entryTime || b.triggerTime));
    const overall = computeStats(allTrades);

    console.log('Giai đoạn'.padEnd(35) + 'Lệnh'.padEnd(8) + 'Win Rate'.padEnd(12) + 'PF'.padEnd(8) + 'Tổng R'.padEnd(12) + 'Max DD');
    console.log('-'.repeat(85));
    for (const s of yearStats) {
      console.log(s.label.padEnd(35) + String(s.count).padEnd(8) + s.winRate.padEnd(12) + s.pf.padEnd(8) + s.totalR.padEnd(12) + s.maxDDR);
    }
    console.log('-'.repeat(85));
    console.log('TỔNG 5 NĂM (2021-2026)'.padEnd(35) + String(overall.count).padEnd(8) + overall.winRate.padEnd(12) + overall.pf.padEnd(8) + overall.totalR.padEnd(12) + overall.maxDDR);
  }
}

runSweep();

