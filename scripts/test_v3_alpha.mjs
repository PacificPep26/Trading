import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle, calculateATR, calculateSMA, calculateTR, analyzeCandle, detectVolumeAbsorption } from '../src/indicators.js';
import { evaluateMarket, calculateSetupQualityScore } from '../src/engine.js';
import { BOT_CONFIG } from '../src/config.js';
import { calculateMetrics } from './backtest_1year.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache_1year');

const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const H4_MS = 4 * 60 * 60 * 1000;
const START_BACKTEST_TS = new Date('2025-10-01T00:00:00Z').getTime();

export function calculateADX(candles, period = 14) {
  if (!candles || candles.length < period * 2) return [];

  const len = candles.length;
  const result = new Array(len).fill(null).map(() => ({ adx: null, plusDI: null, minusDI: null }));

  const tr = new Array(len).fill(0);
  const plusDM = new Array(len).fill(0);
  const minusDM = new Array(len).fill(0);

  tr[0] = candles[0].high - candles[0].low;

  for (let i = 1; i < len; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];

    tr[i] = calculateTR(cur.high, cur.low, prev.close);

    const upMove = cur.high - prev.high;
    const downMove = prev.low - cur.low;

    if (upMove > downMove && upMove > 0) {
      plusDM[i] = upMove;
    } else {
      plusDM[i] = 0;
    }

    if (downMove > upMove && downMove > 0) {
      minusDM[i] = downMove;
    } else {
      minusDM[i] = 0;
    }
  }

  let smoothTR = 0;
  let smoothPlusDM = 0;
  let smoothMinusDM = 0;

  for (let i = 1; i <= period; i++) {
    smoothTR += tr[i];
    smoothPlusDM += plusDM[i];
    smoothMinusDM += minusDM[i];
  }

  const dx = new Array(len).fill(null);

  const calcDI = (idx, sTR, sPlus, sMinus) => {
    if (sTR === 0) return { pDI: 0, mDI: 0, dxVal: 0 };
    const pDI = (sPlus / sTR) * 100;
    const mDI = (sMinus / sTR) * 100;
    const diSum = pDI + mDI;
    const dxVal = diSum === 0 ? 0 : (Math.abs(pDI - mDI) / diSum) * 100;
    return { pDI, mDI, dxVal };
  };

  const initial = calcDI(period, smoothTR, smoothPlusDM, smoothMinusDM);
  result[period] = { adx: null, plusDI: initial.pDI, minusDI: initial.mDI };
  dx[period] = initial.dxVal;

  for (let i = period + 1; i < len; i++) {
    smoothTR = smoothTR - (smoothTR / period) + tr[i];
    smoothPlusDM = smoothPlusDM - (smoothPlusDM / period) + plusDM[i];
    smoothMinusDM = smoothMinusDM - (smoothMinusDM / period) + minusDM[i];

    const { pDI, mDI, dxVal } = calcDI(i, smoothTR, smoothPlusDM, smoothMinusDM);
    dx[i] = dxVal;
    result[i] = { adx: null, plusDI: pDI, minusDI: mDI };
  }

  let sumDX = 0;
  for (let i = period; i < period * 2; i++) {
    sumDX += (dx[i] || 0);
  }
  let prevADX = sumDX / period;
  result[period * 2 - 1].adx = prevADX;

  for (let i = period * 2; i < len; i++) {
    const curDX = dx[i] || 0;
    const curADX = (prevADX * (period - 1) + curDX) / period;
    result[i].adx = curADX;
    prevADX = curADX;
  }

  return result;
}

export function calculateATRCompression(candles, atrPeriod = 14, smaPeriod = 50) {
  const atrs = calculateATR(candles, atrPeriod);
  if (!atrs || atrs.length < smaPeriod + atrPeriod) return 1.0;

  const validAtrs = atrs.slice(-smaPeriod);
  if (validAtrs.some(v => v === null)) return 1.0;

  const curAtr = atrs[atrs.length - 1];
  const avgAtr = validAtrs.reduce((a, b) => a + b, 0) / smaPeriod;

  if (avgAtr <= 0) return 1.0;
  return curAtr / avgAtr;
}

async function runV3AlphaSimulation() {
  const allSymbols = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'LINK-USDT-SWAP', 'NEAR-USDT-SWAP'];
  console.log('🧪 CHẠY MÔ PHỎNG V3.0 ALPHA: MARKET REGIME (ADX + ATR RATIO) + LIMIT MAKER (0.02% FEE)...');

  const coinData = {};
  for (const s of allSymbols) {
    const m15 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${s}_15m.json`), 'utf8')).map(normalizeCandle);
    const tsMap = new Map();
    m15.forEach((c, idx) => tsMap.set(c.ts, idx));

    coinData[s] = {
      h4: JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${s}_4H.json`), 'utf8')).map(normalizeCandle),
      h1: JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${s}_1H.json`), 'utf8')).map(normalizeCandle),
      m15,
      tsMap,
      activeTrade: null,
      closedTrades: [],
      h4Pointer: 0,
      h1Pointer: 0
    };
  }

  const btcH1 = coinData['BTC-USDT-SWAP'].h1;
  const btcH4 = coinData['BTC-USDT-SWAP'].h4;
  const btcM15 = coinData['BTC-USDT-SWAP'].m15;
  const startIdx = btcM15.findIndex(c => c.ts >= START_BACKTEST_TS);

  // Thử nghiệm 3 kịch bản:
  // Kịch bản A: Base v2.5 (Phí Taker 0.08%, không lọc ADX)
  // Kịch bản B: v3.0 Alpha (Lọc ADX > 20 + ATR Ratio >= 0.70 + Phí Maker 0.02%)
  // Kịch bản C: v3.0 Alpha + SPLIT TARGET (Chốt 50% tại +1.5R & Dời BE, 50% gồng +2.0R)
  for (const mode of ['V2.5_BASE_TAKER', 'V3.0_ALPHA_REGIME_MAKER', 'V3.0_ALPHA_SPLIT_TARGET']) {
    const isV3 = mode !== 'V2.5_BASE_TAKER';
    const isSplit = mode === 'V3.0_ALPHA_SPLIT_TARGET';
    const feeRate = isV3 ? 0.0002 : 0.0008; // 0.02% Maker vs 0.08% Taker

    for (const s of allSymbols) {
      coinData[s].activeTrade = null;
      coinData[s].closedTrades = [];
      coinData[s].h4Pointer = 0;
      coinData[s].h1Pointer = 0;
    }
    let btcH1Pointer = 0;
    let btcH4Pointer = 0;
    let openPositionsCount = 0;
    const testClosedTrades = [];

    const monthlyStats = {};

    for (let i = Math.max(startIdx, 50); i < btcM15.length; i++) {
      const curTs = btcM15[i].ts;
      const m15CloseTime = curTs + M15_MS;
      const dateStr = new Date(curTs).toISOString().slice(0, 7);
      if (!monthlyStats[dateStr]) monthlyStats[dateStr] = { trades: 0, pnlUsd: 0, r: 0 };

      // 1. Quản lý vị thế mở
      for (const s of allSymbols) {
        const data = coinData[s];
        const m15Idx = data.tsMap.get(curTs);
        if (m15Idx === undefined) continue;
        const m15Bar = data.m15[m15Idx];

        if (data.activeTrade) {
          data.activeTrade.barsHeld++;
          const isLong = data.activeTrade.direction === 'LONG';
          const riskDist = Math.abs(data.activeTrade.entry - data.activeTrade.initialStopLoss);
          const favorablePrice = isLong ? m15Bar.high : m15Bar.low;
          const curMaxR = isLong ? (favorablePrice - data.activeTrade.entry) / riskDist : (data.activeTrade.entry - favorablePrice) / riskDist;

          // Xử lý Split Target cho kịch bản C
          if (isSplit) {
            // Khi chạm +1.5R: Chốt 50% vị thế, dời SL 50% còn lại về BE
            if (!data.activeTrade.tp1Hit && curMaxR >= 1.5) {
              data.activeTrade.tp1Hit = true;
              data.activeTrade.isProfitLocked = true;
              data.activeTrade.stopLoss = isLong ? data.activeTrade.entry + (0.05 * riskDist) : data.activeTrade.entry - (0.05 * riskDist);
            }
          } else {
            // Dời BE thông thường tại +1.4R
            if (!data.activeTrade.isProfitLocked && curMaxR >= 1.4) {
              data.activeTrade.isProfitLocked = true;
              data.activeTrade.stopLoss = isLong ? data.activeTrade.entry + (0.05 * riskDist) : data.activeTrade.entry - (0.05 * riskDist);
            }
          }

          const isSLHit = isLong ? (m15Bar.low <= data.activeTrade.stopLoss) : (m15Bar.high >= data.activeTrade.stopLoss);
          const isTPHit = isLong ? (m15Bar.high >= data.activeTrade.takeProfit) : (m15Bar.low <= data.activeTrade.takeProfit);

          if (isSLHit) {
            const exitPrice = data.activeTrade.stopLoss;
            let netPnl, netR, outcome;

            if (isSplit && data.activeTrade.tp1Hit) {
              // 50% đã ăn +1.5R ($7.5), 50% còn lại ăn +0.05R ($0.25)
              const halfNotional = data.activeTrade.sizing.notional * 0.5;
              const grossPnl = (1.5 * 0.5 * 10) + (0.05 * 0.5 * 10);
              const fee = (halfNotional * feeRate * 2);
              netPnl = grossPnl - fee;
              netR = (1.5 * 0.5) + (0.05 * 0.5); // +0.775R
              outcome = 'TP1_PLUS_BE';
            } else {
              const grossPnl = isLong ? (exitPrice - data.activeTrade.entry) * data.activeTrade.sizing.size : (data.activeTrade.entry - exitPrice) * data.activeTrade.sizing.size;
              const fee = data.activeTrade.sizing.notional * feeRate;
              netPnl = grossPnl - fee;
              netR = data.activeTrade.isProfitLocked ? 0.05 : -1.0;
              outcome = data.activeTrade.isProfitLocked ? 'LOCK_BE' : 'SL';
            }

            const tradeResult = {
              ...data.activeTrade,
              exitTime: m15CloseTime,
              exitPrice,
              outcome,
              netR,
              netUsd: netPnl
            };
            data.closedTrades.push(tradeResult);
            testClosedTrades.push(tradeResult);
            monthlyStats[dateStr].trades++;
            monthlyStats[dateStr].pnlUsd += netPnl;
            monthlyStats[dateStr].r += netR;
            data.activeTrade = null;
            openPositionsCount--;
          } else if (isTPHit) {
            const exitPrice = data.activeTrade.takeProfit;
            let netPnl, netR;

            if (isSplit && data.activeTrade.tp1Hit) {
              // 50% ăn +1.5R ($7.5), 50% ăn +2.0R ($10) -> Tổng +1.75R
              const grossPnl = (1.5 * 0.5 * 10) + (2.0 * 0.5 * 10);
              const fee = data.activeTrade.sizing.notional * feeRate;
              netPnl = grossPnl - fee;
              netR = (1.5 * 0.5) + (2.0 * 0.5); // +1.75R
            } else {
              const grossPnl = isLong ? (exitPrice - data.activeTrade.entry) * data.activeTrade.sizing.size : (data.activeTrade.entry - exitPrice) * data.activeTrade.sizing.size;
              const fee = data.activeTrade.sizing.notional * feeRate;
              netPnl = grossPnl - fee;
              netR = data.activeTrade.riskReward;
            }

            const tradeResult = {
              ...data.activeTrade,
              exitTime: m15CloseTime,
              exitPrice,
              outcome: 'TP',
              netR,
              netUsd: netPnl
            };
            data.closedTrades.push(tradeResult);
            testClosedTrades.push(tradeResult);
            monthlyStats[dateStr].trades++;
            monthlyStats[dateStr].pnlUsd += netPnl;
            monthlyStats[dateStr].r += netR;
            data.activeTrade = null;
            openPositionsCount--;
          }
        }
      }

      while (btcH1Pointer + 1 < btcH1.length && btcH1[btcH1Pointer + 1].ts + H1_MS <= m15CloseTime) btcH1Pointer++;
      while (btcH4Pointer + 1 < btcH4.length && btcH4[btcH4Pointer + 1].ts + H4_MS <= m15CloseTime) btcH4Pointer++;

      const visibleBtcH1 = btcH1.slice(Math.max(0, btcH1Pointer - 40), btcH1Pointer + 1);
      const visibleBtcH4 = btcH4.slice(Math.max(0, btcH4Pointer - 100), btcH4Pointer + 1);

      if (openPositionsCount < 2) {
        const candidateSignals = [];

        for (const s of allSymbols) {
          const data = coinData[s];
          if (data.activeTrade) continue;

          const m15Idx = data.tsMap.get(curTs);
          if (m15Idx === undefined || m15Idx < 5) continue;

          while (data.h4Pointer + 1 < data.h4.length && data.h4[data.h4Pointer + 1].ts + H4_MS <= m15CloseTime) data.h4Pointer++;
          while (data.h1Pointer + 1 < data.h1.length && data.h1[data.h1Pointer + 1].ts + H1_MS <= m15CloseTime) data.h1Pointer++;

          if (data.h4Pointer < 90 || data.h1Pointer < 30) continue;

          const visibleH4 = data.h4.slice(Math.max(0, data.h4Pointer - 150), data.h4Pointer + 1);
          const visibleH1 = data.h1.slice(Math.max(0, data.h1Pointer - 60), data.h1Pointer + 1);
          const visibleM15 = data.m15.slice(Math.max(0, m15Idx - 40), m15Idx + 1);

          // BỘ LỌC MARKET REGIME CỦA V3.0 ALPHA
          if (isV3) {
            // 1. Kiểm tra H1 ADX(14)
            const adxSeries = calculateADX(visibleH1, 14);
            const curADX = adxSeries && adxSeries.length > 0 ? adxSeries[adxSeries.length - 1].adx : null;
            if (curADX !== null && curADX <= 20) {
              continue; // Thị trường Sideway / Chop -> Sleep Mode
            }

            // 2. Kiểm tra ATR Compression Ratio
            const atrRatio = calculateATRCompression(visibleH1, 14, 50);
            if (atrRatio !== null && atrRatio < 0.70) {
              continue; // Biến động co thắt kiệt quệ -> Bỏ qua
            }
          }

          const coinConfig = s.includes('SOL')
            ? { ...BOT_CONFIG, atrBufferMultiplier: 1.0, maxSlDistanceRate: 0.035 }
            : BOT_CONFIG;

          const sig = evaluateMarket({
            symbol: s.replace('-SWAP', ''),
            candlesH4: visibleH4,
            candlesH1: visibleH1,
            candlesM15: visibleM15,
            btcH1Candles: visibleBtcH1,
            btcH4Candles: visibleBtcH4,
            config: coinConfig
          });

          if (sig && !sig.isBlocked) {
            const quality = calculateSetupQualityScore({
              signal: sig,
              candlesH4: visibleH4,
              candlesH1: visibleH1,
              candlesM15: visibleM15,
              btcH1Candles: visibleBtcH1
            });

            if (quality.score >= 80) {
              candidateSignals.push({
                instId: s,
                signal: sig,
                score: quality.score,
                reasons: quality.reasons
              });
            }
          }
        }

        candidateSignals.sort((a, b) => b.score - a.score);

        for (const cand of candidateSignals) {
          if (openPositionsCount >= 2) break;
          const data = coinData[cand.instId];
          data.activeTrade = {
            ...cand.signal,
            entryTime: curTs,
            initialStopLoss: cand.signal.stopLoss,
            isProfitLocked: false,
            barsHeld: 0,
            qualityScore: cand.score
          };
          openPositionsCount++;
        }
      }
    }

    const tM = calculateMetrics(testClosedTrades);
    console.log(`\n========================================================================`);
    console.log(`📊 KẾT QUẢ KỊCH BẢN: ${mode}`);
    console.log(`========================================================================`);
    console.log(`Tổng Lệnh: ${tM.totalTrades} | WinRate: ${tM.winRate} | Profit Factor: ${tM.profitFactor} | Total R: ${tM.totalR} | Net USD: ${tM.netPnlUsd} | MaxDD: ${tM.maxDrawdownR}`);
    
    console.log(`\n📅 THỐNG KÊ CHI TIẾT TỪNG THÁNG:`);
    for (const [m, stat] of Object.entries(monthlyStats)) {
      console.log(`   ${m}: Lệnh: ${String(stat.trades).padEnd(3)} | R: ${(stat.r >= 0 ? '+' : '') + stat.r.toFixed(2)}R | Net USD: ${(stat.pnlUsd >= 0 ? '+$' : '-$') + Math.abs(stat.pnlUsd).toFixed(2)}`);
    }

    console.log(`\n🪙 THEO TỪNG COIN:`);
    for (const s of allSymbols) {
      const sm = calculateMetrics(coinData[s].closedTrades);
      console.log(`   ${s.padEnd(16)} Lệnh: ${String(sm.totalTrades).padEnd(4)} | WR: ${sm.winRate.padEnd(6)} | R: ${sm.totalR.padEnd(8)} | USD: ${sm.netPnlUsd}`);
    }
  }
}

runV3AlphaSimulation();
