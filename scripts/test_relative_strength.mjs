import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle, analyzeCandle, detectVolumeAbsorption } from '../src/indicators.js';
import { evaluateMarket } from '../src/engine.js';
import { BOT_CONFIG } from '../src/config.js';
import { calculateMetrics } from './backtest_1year.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache_1year');

const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const H4_MS = 4 * 60 * 60 * 1000;
const START_BACKTEST_TS = new Date('2025-10-01T00:00:00Z').getTime();

export function calculateSetupQualityScore({ signal, candlesH4, candlesH1, candlesM15, btcH1Candles = null }) {
  let score = 0;
  const reasons = [];

  const lastM15 = candlesM15[candlesM15.length - 1];
  const lastH4 = candlesH4[candlesH4.length - 1];
  const anatomyM15 = analyzeCandle(lastM15);
  const anatomyH4 = analyzeCandle(lastH4);
  const isLong = signal.direction === 'LONG';

  // 1. ĐỘ SẠCH VÀ CHIỀU DÀI RÂU NẾN (WICK PURITY) - Tối đa 25đ
  const wickRatio = isLong 
    ? Math.max(anatomyM15.lowerWickRatio, anatomyH4.lowerWickRatio)
    : Math.max(anatomyM15.upperWickRatio, anatomyH4.upperWickRatio);

  if (wickRatio >= 0.50) {
    score += 25;
    reasons.push(`Râu nến cực đẹp ${(wickRatio * 100).toFixed(0)}%`);
  } else if (wickRatio >= 0.40) {
    score += 20;
    reasons.push(`Râu nến tốt ${(wickRatio * 100).toFixed(0)}%`);
  } else if (wickRatio >= 0.30) {
    score += 15;
    reasons.push(`Râu nến chuẩn ${(wickRatio * 100).toFixed(0)}%`);
  }

  // 2. KHỐI LƯỢNG HẤP THỤ VSA (VOLUME CLIMAX ABSORPTION) - Tối đa 25đ
  const volM15 = detectVolumeAbsorption(candlesM15, candlesM15.length - 1);
  const volH4 = detectVolumeAbsorption(candlesH4, candlesH4.length - 1);
  if (volM15.isAbsorption || volH4.isAbsorption) {
    score += 25;
    reasons.push('VSA Climax Absorption');
  } else {
    const vols = candlesM15.map(c => c.vol);
    const avgVol = vols.slice(-20).reduce((a, b) => a + b, 0) / 20 || 1;
    const volRatio = (vols[vols.length - 1] || 1) / avgVol;
    if (volRatio >= 1.5) {
      score += 15;
      reasons.push(`Vol M15 ${volRatio.toFixed(1)}x SMA20`);
    } else if (volRatio >= 1.0) {
      score += 10;
    }
  }

  // 3. CẤP ĐỘ CẢN SMC & FVG (KEY LEVEL & MITIGATION) - Tối đa 25đ
  if (signal.reason.includes('Major') || signal.strategy.includes('ZONE_REACTION')) {
    score += 25;
    reasons.push('Cản Lớn Tier 2');
  } else if (signal.reason.includes('FVG') || signal.reason.includes('Order Block')) {
    score += 25;
    reasons.push('Retest FVG/OB');
  } else if (signal.reason.includes('swept Support') || signal.reason.includes('swept Resistance')) {
    score += 20;
    reasons.push('Liquidity Sweep');
  } else {
    score += 10;
  }

  // 4. SỨC MẠNH TƯƠNG ĐỐI SO VỚI ĐẦU TÀU BTC (RELATIVE STRENGTH) - Tối đa 25đ
  if (btcH1Candles && btcH1Candles.length >= 2 && candlesH1 && candlesH1.length >= 2) {
    const lastBtc = btcH1Candles[btcH1Candles.length - 1];
    const prevBtc = btcH1Candles[btcH1Candles.length - 2];
    const btcPct = (lastBtc.close - prevBtc.close) / prevBtc.close;

    const lastCoin = candlesH1[candlesH1.length - 1];
    const prevCoin = candlesH1[candlesH1.length - 2];
    const coinPct = (lastCoin.close - prevCoin.close) / prevCoin.close;

    if (isLong) {
      if (coinPct > btcPct + 0.003) {
        score += 25;
        reasons.push('Khỏe hơn BTC');
      } else if (coinPct > 0) {
        score += 15;
      }
    } else {
      if (coinPct < btcPct - 0.003) {
        score += 25;
        reasons.push('Yếu hơn BTC');
      } else if (coinPct < 0) {
        score += 15;
      }
    }
  } else {
    score += 15;
  }

  return {
    score: Math.min(100, score),
    reasons
  };
}

async function testRelativeStrengthPortfolio() {
  const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json'), 'utf8')).map(normalizeCandle);
  const btcH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_4H.json'), 'utf8')).map(normalizeCandle);
  
  // TOÀN BỘ 5 COIN (BAO GỒM CẢ SOL, BTC, ETH, LINK, NEAR)
  const allSymbols = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'LINK-USDT-SWAP', 'NEAR-USDT-SWAP'];
  console.log('🧪 CHẠY MÔ PHỎNG LỌC THEO SỨC MẠNH (RELATIVE STRENGTH) TRÊN TOÀN BỘ 5 COIN (CÓ CẢ SOL)...');

  // Load all candles into memory
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

  // M15 timeline
  const btcM15 = coinData['BTC-USDT-SWAP'].m15;
  const startIdx = btcM15.findIndex(c => c.ts >= START_BACKTEST_TS);

  let btcH1Pointer = 0;
  let btcH4Pointer = 0;

  const MAX_CONCURRENT_POSITIONS = 2; // Tối đa 2 vị thế mở cùng lúc
  let openPositionsCount = 0;
  const allClosedTrades = [];

  for (let i = Math.max(startIdx, 50); i < btcM15.length; i++) {
    const curTs = btcM15[i].ts;
    const m15CloseTime = curTs + M15_MS;

    // 1. Quản lý vị thế mở của các coin
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

        if (!data.activeTrade.isProfitLocked && curMaxR >= BOT_CONFIG.beTriggerR) {
          data.activeTrade.isProfitLocked = true;
          data.activeTrade.stopLoss = isLong ? data.activeTrade.entry + (BOT_CONFIG.lockProfitR * riskDist) : data.activeTrade.entry - (BOT_CONFIG.lockProfitR * riskDist);
        }

        const isSLHit = isLong ? (m15Bar.low <= data.activeTrade.stopLoss) : (m15Bar.high >= data.activeTrade.stopLoss);
        const isTPHit = isLong ? (m15Bar.high >= data.activeTrade.takeProfit) : (m15Bar.low <= data.activeTrade.takeProfit);

        if (isSLHit) {
          const exitPrice = data.activeTrade.stopLoss;
          const grossPnl = isLong ? (exitPrice - data.activeTrade.entry) * data.activeTrade.sizing.size : (data.activeTrade.entry - exitPrice) * data.activeTrade.sizing.size;
          const fee = data.activeTrade.sizing.notional * BOT_CONFIG.feeRate;
          const netPnl = grossPnl - fee;
          const netR = data.activeTrade.isProfitLocked ? BOT_CONFIG.lockProfitR : -1.0;

          const tradeResult = {
            ...data.activeTrade,
            exitTime: m15CloseTime,
            exitPrice,
            outcome: data.activeTrade.isProfitLocked ? 'LOCK_BE' : 'SL',
            netR,
            netUsd: netPnl
          };
          data.closedTrades.push(tradeResult);
          allClosedTrades.push(tradeResult);
          data.activeTrade = null;
          openPositionsCount--;
        } else if (isTPHit) {
          const exitPrice = data.activeTrade.takeProfit;
          const grossPnl = isLong ? (exitPrice - data.activeTrade.entry) * data.activeTrade.sizing.size : (data.activeTrade.entry - exitPrice) * data.activeTrade.sizing.size;
          const fee = data.activeTrade.sizing.notional * BOT_CONFIG.feeRate;
          const netPnl = grossPnl - fee;
          const netR = data.activeTrade.riskReward;

          const tradeResult = {
            ...data.activeTrade,
            exitTime: m15CloseTime,
            exitPrice,
            outcome: 'TP',
            netR,
            netUsd: netPnl
          };
          data.closedTrades.push(tradeResult);
          allClosedTrades.push(tradeResult);
          data.activeTrade = null;
          openPositionsCount--;
        }
      }
    }

    // Cập nhật pointers BTC
    while (btcH1Pointer + 1 < btcH1.length && btcH1[btcH1Pointer + 1].ts + H1_MS <= m15CloseTime) btcH1Pointer++;
    while (btcH4Pointer + 1 < btcH4.length && btcH4[btcH4Pointer + 1].ts + H4_MS <= m15CloseTime) btcH4Pointer++;

    const visibleBtcH1 = btcH1.slice(Math.max(0, btcH1Pointer - 40), btcH1Pointer + 1);
    const visibleBtcH4 = btcH4.slice(Math.max(0, btcH4Pointer - 100), btcH4Pointer + 1);

    // 2. Nếu còn slot mở vị thế, quét toàn bộ 5 coin để tìm "CON KHỎE NHẤT"
    if (openPositionsCount < MAX_CONCURRENT_POSITIONS) {
      const candidateSignals = [];

      for (const s of allSymbols) {
        const data = coinData[s];
        if (data.activeTrade) continue; // Đang có lệnh mở trên coin này

        const m15Idx = data.tsMap.get(curTs);
        if (m15Idx === undefined || m15Idx < 5) continue;

        while (data.h4Pointer + 1 < data.h4.length && data.h4[data.h4Pointer + 1].ts + H4_MS <= m15CloseTime) data.h4Pointer++;
        while (data.h1Pointer + 1 < data.h1.length && data.h1[data.h1Pointer + 1].ts + H1_MS <= m15CloseTime) data.h1Pointer++;

        if (data.h4Pointer < 90 || data.h1Pointer < 15) continue;

        const visibleH4 = data.h4.slice(Math.max(0, data.h4Pointer - 150), data.h4Pointer + 1);
        const visibleH1 = data.h1.slice(Math.max(0, data.h1Pointer - 40), data.h1Pointer + 1);
        const visibleM15 = data.m15.slice(Math.max(0, m15Idx - 40), m15Idx + 1);

        const sig = evaluateMarket({
          symbol: s.replace('-SWAP', ''),
          candlesH4: visibleH4,
          candlesH1: visibleH1,
          candlesM15: visibleM15,
          btcH1Candles: visibleBtcH1,
          btcH4Candles: visibleBtcH4,
          config: BOT_CONFIG
        });

        if (sig && !sig.isBlocked) {
          const quality = calculateSetupQualityScore({
            signal: sig,
            candlesH4: visibleH4,
            candlesH1: visibleH1,
            candlesM15: visibleM15,
            btcH1Candles: visibleBtcH1
          });

          // Chỉ lấy các setup đạt điểm chất lượng cao >= 65 điểm
          if (quality.score >= 65) {
            candidateSignals.push({
              instId: s,
              signal: sig,
              score: quality.score,
              reasons: quality.reasons
            });
          }
        }
      }

      // SẮP XẾP CHỌN CON CÓ ĐIỂM SỨC MẠNH CAO NHẤT (CON KHỎE NHẤT)
      candidateSignals.sort((a, b) => b.score - a.score);

      for (const cand of candidateSignals) {
        if (openPositionsCount >= MAX_CONCURRENT_POSITIONS) break;
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

  // Run thresholds from 60 to 80
  console.log('\n--- THỬ NGHIỆM CÁC MỐC ĐIỂM CHỌN CON KHỎE NHẤT (60 -> 80) ---');
  for (const threshold of [60, 65, 70, 75, 80]) {
    // reset
    for (const s of allSymbols) {
      coinData[s].activeTrade = null;
      coinData[s].closedTrades = [];
      coinData[s].h4Pointer = 0;
      coinData[s].h1Pointer = 0;
    }
    btcH1Pointer = 0;
    btcH4Pointer = 0;
    openPositionsCount = 0;
    const testClosedTrades = [];

    for (let i = Math.max(startIdx, 50); i < btcM15.length; i++) {
      const curTs = btcM15[i].ts;
      const m15CloseTime = curTs + M15_MS;

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

          if (!data.activeTrade.isProfitLocked && curMaxR >= BOT_CONFIG.beTriggerR) {
            data.activeTrade.isProfitLocked = true;
            data.activeTrade.stopLoss = isLong ? data.activeTrade.entry + (BOT_CONFIG.lockProfitR * riskDist) : data.activeTrade.entry - (BOT_CONFIG.lockProfitR * riskDist);
          }

          const isSLHit = isLong ? (m15Bar.low <= data.activeTrade.stopLoss) : (m15Bar.high >= data.activeTrade.stopLoss);
          const isTPHit = isLong ? (m15Bar.high >= data.activeTrade.takeProfit) : (m15Bar.low <= data.activeTrade.takeProfit);

          if (isSLHit) {
            const exitPrice = data.activeTrade.stopLoss;
            const grossPnl = isLong ? (exitPrice - data.activeTrade.entry) * data.activeTrade.sizing.size : (data.activeTrade.entry - exitPrice) * data.activeTrade.sizing.size;
            const fee = data.activeTrade.sizing.notional * BOT_CONFIG.feeRate;
            const netPnl = grossPnl - fee;
            const netR = data.activeTrade.isProfitLocked ? BOT_CONFIG.lockProfitR : -1.0;

            const tradeResult = {
              ...data.activeTrade,
              exitTime: m15CloseTime,
              exitPrice,
              outcome: data.activeTrade.isProfitLocked ? 'LOCK_BE' : 'SL',
              netR,
              netUsd: netPnl
            };
            data.closedTrades.push(tradeResult);
            testClosedTrades.push(tradeResult);
            data.activeTrade = null;
            openPositionsCount--;
          } else if (isTPHit) {
            const exitPrice = data.takeProfit || data.activeTrade.takeProfit;
            const grossPnl = isLong ? (exitPrice - data.activeTrade.entry) * data.activeTrade.sizing.size : (data.activeTrade.entry - exitPrice) * data.activeTrade.sizing.size;
            const fee = data.activeTrade.sizing.notional * BOT_CONFIG.feeRate;
            const netPnl = grossPnl - fee;
            const netR = data.activeTrade.riskReward;

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
            data.activeTrade = null;
            openPositionsCount--;
          }
        }
      }

      while (btcH1Pointer + 1 < btcH1.length && btcH1[btcH1Pointer + 1].ts + H1_MS <= m15CloseTime) btcH1Pointer++;
      while (btcH4Pointer + 1 < btcH4.length && btcH4[btcH4Pointer + 1].ts + H4_MS <= m15CloseTime) btcH4Pointer++;

      const visibleBtcH1 = btcH1.slice(Math.max(0, btcH1Pointer - 40), btcH1Pointer + 1);
      const visibleBtcH4 = btcH4.slice(Math.max(0, btcH4Pointer - 100), btcH4Pointer + 1);

      if (openPositionsCount < MAX_CONCURRENT_POSITIONS) {
        const candidateSignals = [];

        for (const s of allSymbols) {
          const data = coinData[s];
          if (data.activeTrade) continue;

          const m15Idx = data.tsMap.get(curTs);
          if (m15Idx === undefined || m15Idx < 5) continue;

          while (data.h4Pointer + 1 < data.h4.length && data.h4[data.h4Pointer + 1].ts + H4_MS <= m15CloseTime) data.h4Pointer++;
          while (data.h1Pointer + 1 < data.h1.length && data.h1[data.h1Pointer + 1].ts + H1_MS <= m15CloseTime) data.h1Pointer++;

          if (data.h4Pointer < 90 || data.h1Pointer < 15) continue;

          const visibleH4 = data.h4.slice(Math.max(0, data.h4Pointer - 150), data.h4Pointer + 1);
          const visibleH1 = data.h1.slice(Math.max(0, data.h1Pointer - 40), data.h1Pointer + 1);
          const visibleM15 = data.m15.slice(Math.max(0, m15Idx - 40), m15Idx + 1);

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

            if (quality.score >= threshold) {
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
          if (openPositionsCount >= MAX_CONCURRENT_POSITIONS) break;
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
    console.log(`Ngưỡng >= ${threshold}đ: Lệnh: ${String(tM.totalTrades).padEnd(4)} | WinRate: ${tM.winRate.padEnd(6)} | PF: ${tM.profitFactor.padEnd(5)} | Total R: ${tM.totalR.padEnd(8)} | Net USD: ${tM.netPnlUsd.padEnd(8)} | MaxDD: ${tM.maxDrawdownR}`);
    if (threshold === 75 || threshold === 80) {
      for (const s of allSymbols) {
        const sm = calculateMetrics(coinData[s].closedTrades);
        console.log(`   └─ ${s.padEnd(16)} Lệnh: ${String(sm.totalTrades).padEnd(4)} | WR: ${sm.winRate.padEnd(6)} | R: ${sm.totalR.padEnd(8)} | USD: ${sm.netPnlUsd}`);
      }
    }
  }
}

testRelativeStrengthPortfolio();
