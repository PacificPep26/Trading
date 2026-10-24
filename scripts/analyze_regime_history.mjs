/**
 * ANALYZE_REGIME_HISTORY.MJS
 * Phân loại giai đoạn thị trường lớn (UPTREND/DOWNTREND/SIDEWAY) theo khung D1,
 * walk-forward 100% chống nhìn tương lai, tái dùng detectMarketPhase() có sẵn
 * trong src/engine.js (không viết lại thuật toán phân loại trend mới).
 * Xem docs/REGIME_ADAPTIVE_PLAN.md Phần 2.
 *
 * Output: data/cache_1year/<instId>_regime_daily.json
 *   [{ date: 'YYYY-MM-DD', ts, phase: 'STRONG_UPTREND'|'STRONG_DOWNTREND'|'RANGING' }, ...]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';
import { detectMarketPhase } from '../src/engine.js';
import { calculateEMA } from '../src/indicators.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache_1year');

const SYMBOLS = [
  'BTC-USDT-SWAP',
  'ETH-USDT-SWAP',
  'SOL-USDT-SWAP',
  'LINK-USDT-SWAP',
  'NEAR-USDT-SWAP'
];

/**
 * Phân loại giai đoạn thị trường cho một coin, walk-forward theo từng nến D1.
 * Tại mỗi thời điểm i, chỉ dùng nến D1[0..i] (đã đóng), đúng cấu trúc chống
 * look-ahead đã dùng trong scripts/backtest_1year.mjs.
 */
function labelRegimeHistory(candlesD1) {
  const labels = [];
  // Cần tối thiểu ~90 nến D1 để EMA89 ổn định (giống ngưỡng warmup H4 hiện có)
  for (let i = 89; i < candlesD1.length; i++) {
    const visible = candlesD1.slice(0, i + 1);
    const closes = visible.map(c => c.close);
    const ema34Arr = calculateEMA(closes, 34);
    const ema89Arr = calculateEMA(closes, 89);
    const phase = detectMarketPhase(visible, ema34Arr, ema89Arr);
    const d = visible[visible.length - 1];
    labels.push({
      date: new Date(d.ts).toISOString().slice(0, 10),
      ts: d.ts,
      phase
    });
  }
  return labels;
}

function main() {
  console.log('================================================================');
  console.log('🧭 PHÂN LOẠI GIAI ĐOẠN THỊ TRƯỜNG (D1) - WALK-FORWARD');
  console.log('================================================================\n');

  const selectedSymbol = process.argv[2];
  const symbolsToRun = selectedSymbol ? [selectedSymbol] : SYMBOLS;

  for (const instId of symbolsToRun) {
    const fD1 = path.join(CACHE_DIR, `${instId}_1Dutc.json`);
    if (!fs.existsSync(fD1)) {
      console.log(`⚠️  ${instId}: chưa có dữ liệu 1Dutc (chạy scripts/download_1year_history.mjs trước). Bỏ qua.`);
      continue;
    }

    const candlesD1 = JSON.parse(fs.readFileSync(fD1, 'utf8')).map(normalizeCandle);
    if (candlesD1.length < 90) {
      console.log(`⚠️  ${instId}: chỉ có ${candlesD1.length} nến D1 (<90), chưa đủ warmup EMA89. Bỏ qua.`);
      continue;
    }

    const labels = labelRegimeHistory(candlesD1);
    const counts = labels.reduce((acc, l) => {
      acc[l.phase] = (acc[l.phase] || 0) + 1;
      return acc;
    }, {});

    const outPath = path.join(CACHE_DIR, `${instId}_regime_daily.json`);
    fs.writeFileSync(outPath, JSON.stringify(labels), 'utf8');

    console.log(`✅ ${instId}: ${labels.length} ngày gắn nhãn (${candlesD1[89].ts ? new Date(candlesD1[89].ts).toISOString().slice(0, 10) : '?'} -> ${labels[labels.length - 1].date})`);
    console.log(`   UPTREND: ${counts.STRONG_UPTREND || 0} | DOWNTREND: ${counts.STRONG_DOWNTREND || 0} | SIDEWAY(RANGING): ${counts.RANGING || 0}`);
    console.log(`   💾 Đã lưu: ${path.basename(outPath)}\n`);
  }
}

main();
