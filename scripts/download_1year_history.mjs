/**
 * DOWNLOAD_1YEAR_HISTORY.MJS
 * Tải TOÀN BỘ dữ liệu nến lịch sử từ lúc mỗi coin được niêm yết trên OKX Swap đến
 * nay (phân trang lùi tới khi API trả rỗng = chạm ngày niêm yết, tự nhiên dừng đúng
 * lúc, không cần biết trước ngày). Hỗ trợ 4H, 1H, 15m, 1Dutc cho danh mục Premier
 * (BTC, ETH, SOL, LINK, NEAR). 1Dutc dùng để phân loại giai đoạn thị trường lớn
 * (xem docs/REGIME_ADAPTIVE_PLAN.md Phần 1-2).
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

const TIMEFRAMES = ['4H', '1H', '15m', '1Dutc'];

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
  const genesisMarkerPath = `${filePath}.genesis`;

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
  let newestTsInMap = 0;
  for (const ts of candleMap.keys()) {
    if (ts > newestTsInMap) newestTsInMap = ts;
  }

  // Nếu đã từng tải tới tận ngày niêm yết (marker .genesis) VÀ nến mới nhất gần đây
  // (< 6 tiếng) -> bỏ qua, không cần tải lại toàn bộ lịch sử mỗi lần chạy.
  const sixHoursAgo = Date.now() - 6 * 3600 * 1000;
  if (fs.existsSync(genesisMarkerPath) && newestTsInMap >= sixHoursAgo) {
    console.log(`  ✅ Dữ liệu ${instId} (${bar}) đã đầy đủ từ lúc niêm yết đến nay. Bỏ qua tải!`);
    return;
  }

  console.log(`  ⏳ Bắt đầu tải ${instId} (${bar}) lùi về tới ngày niêm yết...`);
  let after = '';
  let batchCount = 0;
  let reachedGenesis = false;

  while (true) {
    const rawBatch = await fetchHistoryBatch(instId, bar, after);
    if (!rawBatch || rawBatch.length === 0) {
      console.log(`\n  🎯 API trả rỗng -> Đã chạm ngày niêm yết của ${instId}!`);
      reachedGenesis = true;
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

    if (batchCount % 10 === 0) {
      const oldestDateStr = new Date(batchOldestTs).toISOString().slice(0, 10);
      process.stdout.write(`    Batch ${batchCount} -> Đến ngày: ${oldestDateStr} (Tổng: ${candleMap.size} nến)\r`);
    }

    await sleep(75); // Tránh rate limit OKX (tối đa ~13 req/s)
  }

  // Sắp xếp theo thứ tự thời gian tăng dần
  const sorted = Array.from(candleMap.values()).sort((a, b) => a.ts - b.ts);
  fs.writeFileSync(filePath, JSON.stringify(sorted), 'utf8');
  if (reachedGenesis) {
    fs.writeFileSync(genesisMarkerPath, new Date().toISOString(), 'utf8');
  }
  console.log(`  💾 Đã lưu ${sorted.length} nến vào ${path.basename(filePath)} (${(fs.statSync(filePath).size / 1024 / 1024).toFixed(2)} MB)\n`);
}

async function main() {
  console.log('================================================================');
  console.log('🚀 TẢI TOÀN BỘ DỮ LIỆU NẾN LỊCH SỬ TỪ LÚC NIÊM YẾT TỪ OKX');
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

