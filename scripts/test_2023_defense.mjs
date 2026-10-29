/**
 * TEST_2023_DEFENSE.MJS
 * Khung thử nghiệm định lượng:
 * 1. Weekly Circuit Breaker (-3.0R, -3.5R, -4.0R)
 * 2. Dynamic NATR_D1 (khi NATR_D1 thấp -> tắt Kane Thuận Trend hoặc hạ beTriggerR)
 * 3. Cấm RANGING x SMC_SWEEP_REVERSAL_SHORT
 * 
 * Đo lường trực tiếp trên cả 5 năm (2021-2026) và 1 năm gần nhất với phí Taker thật.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';
import { backtestSymbol } from './backtest_1year.mjs';
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

/**
 * Lấy nhãn tuần UTC: YYYY-Www (bắt đầu từ Thứ Hai)
 */
function getWeekKey(ts) {
  const d = new Date(ts);
  const day = d.getUTCDay();
  // dời về thứ 2 của tuần đó
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diffToMonday);
  return monday.toISOString().slice(0, 10);
}

/**
 * Áp dụng Weekly Circuit Breaker lên danh sách lệnh theo dòng thời gian
 */
function applyWeeklyCircuitBreaker(trades, maxWeeklyLossR = 3.5) {
  // Sắp xếp lệnh theo triggerTime / entryTime
  const sorted = [...trades].sort((a, b) => (a.entryTime || a.triggerTime) - (b.entryTime || b.triggerTime));
  
  const acceptedTrades = [];
  const weeklyPnL = new Map(); // weekKey -> cumNetR

  for (const t of sorted) {
    const weekKey = getWeekKey(t.entryTime || t.triggerTime);
    const curLoss = weeklyPnL.get(weekKey) || 0;

    // Nếu tuần này đã lỗ quá ngưỡng -> Cầu dao đóng băng mở lệnh mới
    if (curLoss <= -maxWeeklyLossR) {
      // Bị chặn bởi weekly circuit breaker
      continue;
    }

    acceptedTrades.push(t);
    // Cập nhật PnL tuần sau khi lệnh kết thúc
    weeklyPnL.set(weekKey, curLoss + t.netR);
  }

  return acceptedTrades;
}

async function runTest(label, filterTradeFn = null, weeklyLossLimit = null) {
  const btcH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_1H.json'), 'utf8')).map(normalizeCandle);
  const btcH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTC-USDT-SWAP_4H.json'), 'utf8')).map(normalizeCandle);

  console.log(`\n======================================================`);
  console.log(`🧪 KIỂM THỬ: ${label}`);
  console.log(`======================================================`);

  const yearStats = [];
  let allTrades = [];

  for (const period of PERIODS) {
    const startTs = new Date(period.start + 'T00:00:00Z').getTime();
    const endTs = new Date(period.end + 'T23:59:59Z').getTime();

    let periodTrades = [];
    for (const instId of SYMBOLS) {
      const trades = await backtestSymbol(instId, btcH1, btcH4, null, startTs, endTs);
      periodTrades.push(...trades);
    }

    if (filterTradeFn) {
      periodTrades = periodTrades.filter(filterTradeFn);
    }

    if (weeklyLossLimit !== null) {
      periodTrades = applyWeeklyCircuitBreaker(periodTrades, weeklyLossLimit);
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
  return { label, yearStats, overall };
}

async function main() {
  // 1. Baseline hiện tại (sau A1-A4 fix)
  await runTest('BASELINE HIỆN TẠI (Taker Fee 2 Chiều)');

  // 2. Weekly Circuit Breaker -3.5R
  await runTest('WEEKLY CIRCUIT BREAKER (-3.5R)', null, 3.5);

  // 3. Weekly Circuit Breaker -3.0R
  await runTest('WEEKLY CIRCUIT BREAKER (-3.0R)', null, 3.0);

  // 4. Weekly Circuit Breaker -4.0R
  await runTest('WEEKLY CIRCUIT BREAKER (-4.0R)', null, 4.0);

  // 5. Cấm RANGING x SMC_SWEEP_REVERSAL_SHORT
  await runTest('CẤM RANGING x SMC_SWEEP_REVERSAL_SHORT', (t) => {
    // Nếu trong regime ranging mà là setup sweep short -> loại
    return !(t.strategy && t.strategy.includes('SMC_SWEEP_REVERSAL_SHORT') && t.marketPhase === 'RANGING');
  });

  // 6. Cấm RANGING x SMC_SWEEP_REVERSAL_SHORT + Weekly Circuit Breaker (-3.5R)
  await runTest('CẤM RANGING-SWEEP-SHORT + WEEKLY CIRCUIT BREAKER (-3.5R)', (t) => {
    return !(t.strategy && t.strategy.includes('SMC_SWEEP_REVERSAL_SHORT') && t.marketPhase === 'RANGING');
  }, 3.5);
}

main();

