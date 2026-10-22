/**
 * DOWNLOAD_1YEAR_HISTORY.MJS
 * Tải toàn bộ dữ liệu nến lịch sử từ 01/09/2025 đến nay (hơn 1 năm) từ OKX API.
 * Hỗ trợ các khung thời gian 4H, 1H, 15m cho danh mục Premier (BTC, ETH, SOL, LINK, NEAR).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache_1year');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const SYMBOLS = [
  'BTC-USDT-SWAP',
  'ETH-USDT-SWAP',
  'SOL-USDT-SWAP',
  'LINK-USDT-SWAP',
  'NEAR-USDT-SWAP'
];

const TIMEFRAMES = ['4H', '1H', '15m'];

// Bắt đầu từ 01/09/2025 để EMA 89 trên H4 được làm ấm (warmup) hoàn chỉnh trước 01/10/2025
const TARGET_START_TS = new Date('2025-09-01T00:00:00Z').getTime();

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchHistoryBatch(instId, bar, after = '') {
  let url = `https://www.okx.com/api/v5/market/history-candles?instId=${instId}&bar=${bar}&limit=100`;
  if (after) {
    url += `&after=${after}`;
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.status === 429) {
        console.warn(`[RATE_LIMIT] Đang chờ 1.5s (lần thử ${attempt})...`);
        await sleep(1500);
        continue;
      }
      const json = await res.json();
      if (json.code === '0' && Array.isArray(json.data)) {
        return json.data;
      }
      console.warn(`[API_ERROR] ${json.msg || json.code}, thử lại lần ${attempt}...`);
      await sleep(1000);
    } catch (err) {
      console.warn(`[NETWORK_ERROR] ${err.message}, thử lại lần ${attempt}...`);
      await sleep(1000);
    }
  }
  return [];
}

async function downloadCandlesForSymbolAndBar(instId, bar) {
  const filePath = path.join(CACHE_DIR, `${instId}_${bar}.json`);

  let candleMap = new Map();
  if (fs.existsSync(filePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      existing.forEach(c => candleMap.set(c.ts, c));
      console.log(`  📂 Tìm thấy cache có sẵn: ${candleMap.size} nến.`);
    } catch (e) {
      console.warn(`  ⚠️ Lỗi đọc cache cũ, tải lại từ đầu: ${e.message}`);
    }
  }

  // Xác định điểm bắt đầu tải
  let oldestTsInMap = Infinity;
  let newestTsInMap = 0;
  for (const ts of candleMap.keys()) {
    if (ts < oldestTsInMap) oldestTsInMap = ts;
    if (ts > newestTsInMap) newestTsInMap = ts;
  }

  // Nếu đã có dữ liệu chạm TARGET_START_TS và nến mới nhất gần đây (< 6 tiếng)
  const sixHoursAgo = Date.now() - 6 * 3600 * 1000;
  if (oldestTsInMap <= TARGET_START_TS && newestTsInMap >= sixHoursAgo) {
    console.log(`  ✅ Dữ liệu ${instId} (${bar}) đã đầy đủ từ ${new Date(oldestTsInMap).toISOString().slice(0, 10)} đến nay. Bỏ qua tải!`);
    return;
  }

  console.log(`  ⏳ Bắt đầu tải ${instId} (${bar}) về đến 01/09/2025...`);
  let after = '';
  let batchCount = 0;

  while (true) {
    const rawBatch = await fetchHistoryBatch(instId, bar, after);
    if (!rawBatch || rawBatch.length === 0) {
      console.log(`  ℹ️ Không còn nến nào cũ hơn từ API.`);
      break;
    }

    batchCount++;
    const normalized = rawBatch.map(normalizeCandle);
    let batchOldestTs = Infinity;

    for (const c of normalized) {
      candleMap.set(c.ts, c);
      if (c.ts < batchOldestTs) batchOldestTs = c.ts;
    }

    after = rawBatch[rawBatch.length - 1][0]; // timestamp của nến cũ nhất trong batch

    if (batchCount % 10 === 0 || batchOldestTs <= TARGET_START_TS) {
      const oldestDateStr = new Date(batchOldestTs).toISOString().slice(0, 10);
      process.stdout.write(`    Batch ${batchCount} -> Đến ngày: ${oldestDateStr} (Tổng: ${candleMap.size} nến)\r`);
    }

    if (batchOldestTs <= TARGET_START_TS) {
      console.log(`\n  🎯 Đã đạt mốc thời gian mục tiêu: ${new Date(batchOldestTs).toISOString().slice(0, 10)}!`);
      break;
    }

    await sleep(75); // Tránh rate limit OKX (tối đa ~13 req/s)
  }

  // Sắp xếp theo thứ tự thời gian tăng dần
  const sorted = Array.from(candleMap.values()).sort((a, b) => a.ts - b.ts);
  fs.writeFileSync(filePath, JSON.stringify(sorted), 'utf8');
  console.log(`  💾 Đã lưu ${sorted.length} nến vào ${path.basename(filePath)} (${(fs.statSync(filePath).size / 1024 / 1024).toFixed(2)} MB)\n`);
}

async function main() {
  console.log('================================================================');
  console.log('🚀 TẢI DỮ LIỆU NẾN LỊCH SỬ 1 NĂM (09/2025 -> 10/2026) TỪ OKX');
  console.log('================================================================\n');

  const selectedSymbol = process.argv[2];
  const symbolsToRun = selectedSymbol ? [selectedSymbol] : SYMBOLS;

  for (const sym of symbolsToRun) {
    console.log(`▶️ ĐANG XỬ LÝ: ${sym}`);
    for (const bar of TIMEFRAMES) {
      await downloadCandlesForSymbolAndBar(sym, bar);
    }
  }

  console.log('🎉 TẤT CẢ DỮ LIỆU ĐÃ ĐƯỢC TẢI VÀ LƯU VÀO data/cache_1year/!');
}

main().catch(err => {
  console.error('Lỗi nghiêm trọng:', err);
});

