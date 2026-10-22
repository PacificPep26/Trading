import fs from 'fs';
import path from 'path';
import { normalizeCandle, calculateEMA } from '../src/indicators.js';
import { evaluateMarket, DEFAULT_CONFIG } from '../src/engine.js';
import { calculateMetrics, groupTradesByMonth } from './backtest_1year.mjs';

const CACHE_DIR = 'data/cache_1year';
const M15_MS = 15 * 60 * 1000;
const H1_MS = 60 * 60 * 1000;
const H4_MS = 4 * 60 * 60 * 1000;
const START_BACKTEST_TS = new Date('2025-10-01T00:00:00Z').getTime();

export function detectMarketPhase(candlesH4, ema34Arr, ema89Arr) {
  if (candlesH4.length < 10) return 'RANGING';
  const lastIdx = candlesH4.length - 1;
  const e34 = ema34Arr[lastIdx];
  const e89 = ema89Arr[lastIdx];
  const prevE34 = ema34Arr[Math.max(0, lastIdx - 3)] || e34;
  const prevE89 = ema89Arr[Math.max(0, lastIdx - 3)] || e89;

  const curSpreadPct = (e34 - e89) / e89 * 100;
  const prevSpreadPct = (prevE34 - prevE89) / prevE89 * 100;
  const curPrice = candlesH4[lastIdx].close;

  // 1. Xu hướng Tăng Dốc Mạnh (Strong Uptrend)
  // EMA34 nằm trên EMA89, dải xòe rộng >= 0.8% và đang mở rộng, giá bám trên EMA34
  if (curSpreadPct >= 0.8 && curSpreadPct >= prevSpreadPct && curPrice >= e34 * 0.998) {
    return 'STRONG_UPTREND';
  }

  // 2. Xu hướng Giảm Dốc Đứng (Strong Downtrend / Waterfall)
  // EMA34 nằm dưới EMA89, dải xòe rộng <= -0.8% và đang mở rộng, giá bị đè dưới EMA34
  if (curSpreadPct <= -0.8 && curSpreadPct <= prevSpreadPct && curPrice <= e34 * 1.002) {
    return 'STRONG_DOWNTREND';
  }

  // 3. Thị trường Ranging có cấu trúc
  return 'RANGING';
}

async function backtestWithRegimeFilter() {
  const symbols = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'LINK-USDT-SWAP', 'NEAR-USDT-SWAP'];
  const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json'), 'utf8')).map(normalizeCandle);
  let allTrades = [];

  for (const instId of symbols) {
    const candlesH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, instId + '_4H.json'), 'utf8')).map(normalizeCandle);
    const candlesH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, instId + '_1H.json'), 'utf8')).map(normalizeCandle);
    const candlesM15 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, instId + '_15m.json'), 'utf8')).map(normalizeCandle);

    let h4Pointer = 0;
    let h1Pointer = 0;
    let btcH1Pointer = 0;
    let activeTrade = null;
    let symbolTrades = [];

    let startIndex = candlesM15.findIndex(c => c.ts >= START_BACKTEST_TS);
    if (startIndex < 50) startIndex = 50;

    for (let i = startIndex; i < candlesM15.length; i++) {
      const currentM15 = candlesM15[i];
      const m15CloseTime = currentM15.ts + M15_MS;

      if (activeTrade) {
        const isLong = activeTrade.direction === 'LONG';
        const riskDist = Math.abs(activeTrade.entry - activeTrade.initialStopLoss);
        const favorablePrice = isLong ? currentM15.high : currentM15.low;
        const curMaxR = isLong ? (favorablePrice - activeTrade.entry) / riskDist : (activeTrade.entry - favorablePrice) / riskDist;

        if (!activeTrade.isProfitLocked && curMaxR >= 1.5) {
          activeTrade.isProfitLocked = true;
          activeTrade.stopLoss = isLong ? activeTrade.entry + (1.0 * riskDist) : activeTrade.entry - (1.0 * riskDist);
        }

        const isSLHit = isLong ? (currentM15.low <= activeTrade.stopLoss) : (currentM15.high >= activeTrade.stopLoss);
        const isTPHit = isLong ? (currentM15.high >= activeTrade.takeProfit) : (currentM15.low <= activeTrade.takeProfit);

        if (isSLHit) {
          const exitPrice = activeTrade.stopLoss;
          const grossPnl = isLong ? (exitPrice - activeTrade.entry) * activeTrade.sizing.size : (activeTrade.entry - exitPrice) * activeTrade.sizing.size;
          const fee = activeTrade.sizing.notional * 0.0008;
          const netR = activeTrade.isProfitLocked ? 1.0 : -1.0;
          symbolTrades.push({ ...activeTrade, exitTime: m15CloseTime, exitPrice, outcome: activeTrade.isProfitLocked ? 'LOCK_+1R' : 'SL', netR, netUsd: grossPnl - fee });
          activeTrade = null;
        } else if (isTPHit) {
          const exitPrice = activeTrade.takeProfit;
          const grossPnl = isLong ? (exitPrice - activeTrade.entry) * activeTrade.sizing.size : (activeTrade.entry - exitPrice) * activeTrade.sizing.size;
          const fee = activeTrade.sizing.notional * 0.0008;
          const netR = activeTrade.riskReward;
          symbolTrades.push({ ...activeTrade, exitTime: m15CloseTime, exitPrice, outcome: 'TP', netR, netUsd: grossPnl - fee });
          activeTrade = null;
        }
      }

      if (!activeTrade) {
        while (h4Pointer + 1 < candlesH4.length && candlesH4[h4Pointer + 1].ts + H4_MS <= m15CloseTime) h4Pointer++;
        while (h1Pointer + 1 < candlesH1.length && candlesH1[h1Pointer + 1].ts + H1_MS <= m15CloseTime) h1Pointer++;
        if (btcH1 && btcH1.length > 0) {
          while (btcH1Pointer + 1 < btcH1.length && btcH1[btcH1Pointer + 1].ts + H1_MS <= m15CloseTime) btcH1Pointer++;
        }

        if (h4Pointer >= 90 && h1Pointer >= 15 && i >= 5) {
          const visibleH4 = candlesH4.slice(Math.max(0, h4Pointer - 150), h4Pointer + 1);
          const visibleH1 = candlesH1.slice(Math.max(0, h1Pointer - 40), h1Pointer + 1);
          const visibleM15 = candlesM15.slice(Math.max(0, i - 40), i + 1);
          const visibleBtcH1 = btcH1 && btcH1Pointer >= 15 ? btcH1.slice(Math.max(0, btcH1Pointer - 40), btcH1Pointer + 1) : null;

          // NHẬN DIỆN GIAI ĐOẠN THỊ TRƯỜNG (MARKET REGIME)
          const closesH4 = visibleH4.map(c => c.close);
          const ema34Arr = calculateEMA(closesH4, 34);
          const ema89Arr = calculateEMA(closesH4, 89);
          const phase = detectMarketPhase(visibleH4, ema34Arr, ema89Arr);

          const signal = evaluateMarket({
            symbol: instId.replace('-SWAP', ''),
            candlesH4: visibleH4,
            candlesH1: visibleH1,
            candlesM15: visibleM15,
            btcH1Candles: visibleBtcH1,
            config: DEFAULT_CONFIG
          });

          if (signal && !signal.isBlocked) {
            // QUY TẮC ĐÁNH THEO GIAI ĐOẠN (REGIME-BASED TRADING RULES):
            // 1. Khi đang trong Xu hướng Giảm dốc đứng (STRONG_DOWNTREND):
            //    TUYỆT ĐỐI CẤM LONG BẮT ĐÁY DAO RƠI! Chỉ cho phép SHORT thuận chiều!
            if (phase === 'STRONG_DOWNTREND' && signal.direction === 'LONG') {
              continue;
            }

            // 2. Khi đang trong Xu hướng Tăng dốc mạnh (STRONG_UPTREND):
            //    TUYỆT ĐỐI CẤM SHORT CẢN TÀU! Chỉ cho phép LONG thuận chiều!
            if (phase === 'STRONG_UPTREND' && signal.direction === 'SHORT') {
              continue;
            }

            activeTrade = {
              ...signal,
              entryTime: currentM15.ts,
              initialStopLoss: signal.stopLoss,
              isProfitLocked: false,
              marketPhase: phase
            };
          }
        }
      }
    }
    allTrades.push(...symbolTrades);
  }

  allTrades.sort((a, b) => a.entryTime - b.entryTime);
  const m = calculateMetrics(allTrades);

  console.log('================================================================');
  console.log('🏆 KẾT QUẢ 1 NĂM VỚI BỘ LỌC ĐÁNH THEO GIAI ĐOẠN (REGIME FILTER)');
  console.log('Quy tắc: Cấm bắt đáy khi Waterfall | Cấm chặn đầu xe khi Strong Pump');
  console.log('================================================================');
  console.log(`• Tổng số lệnh: ${m.totalTrades} (So với gốc 2,160 lệnh)`);
  console.log(`• Số lệnh TP: ${m.wins}`);
  console.log(`• Số lệnh Lock +1R: ${m.locks}`);
  console.log(`• Số lệnh Dừng lỗ SL: ${m.losses}`);
  console.log(`• Tỷ Lệ Thắng (Win Rate): ${m.winRate}`);
  console.log(`• Profit Factor: ${m.profitFactor}`);
  console.log(`• Tổng Lợi Nhuận R: ${m.totalR} (Gốc là -199.72R)`);
  console.log(`• Net PnL USD: ${m.netPnlUsd} (Gốc là -$3,519.11)`);
  console.log(`• Max Drawdown: ${m.maxDrawdownR}`);
  console.log('================================================================\n');

  console.log('📅 BẢNG CHI TIẾT TỪNG THÁNG SAU KHI ĐÁNH THEO GIAI ĐOẠN:');
  const monthly = groupTradesByMonth(allTrades);
  monthly.forEach(mo => {
    console.log(mo.month, 'Trades:', String(mo.totalTrades).padEnd(4), 'WR:', mo.winRate.padEnd(8), 'TotalR:', mo.totalR.padEnd(10), 'NetUSD:', mo.netPnlUsd);
  });
}

backtestWithRegimeFilter().catch(console.error);

