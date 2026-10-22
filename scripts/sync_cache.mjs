/**
 * SYNC_CACHE.MJS
 * Cập nhật dữ liệu nến mới nhất từ OKX API vào data/cache/
 * Đảm bảo backtest bao phủ trọn vẹn đến từng phút của tuần này (19/10/2026 -> 22/10/2026).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchOkxCandles } from '../src/server.js';
import { normalizeCandle } from '../src/indicators.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../data/cache');

const SYMBOLS = [
  'BTC-USDT-SWAP',
  'ETH-USDT-SWAP',
  'SOL-USDT-SWAP',
  'LINK-USDT-SWAP',
  'NEAR-USDT-SWAP'
];

const TIMEFRAMES = [
  { bar: '4H', suffix: '_4H_october.json' },
  { bar: '1H', suffix: '_1H_october.json' },
  { bar: '15m', suffix: '_15m_october.json' }
];

async function sync() {
  console.log('🔄 Đang đồng bộ dữ liệu nến mới nhất đến 11:00 AM 22/10/2026...');

  for (const sym of SYMBOLS) {
    for (const tf of TIMEFRAMES) {
      const filePath = path.join(CACHE_DIR, `${sym}${tf.suffix}`);
      if (!fs.existsSync(filePath)) continue;

      let existing = JSON.parse(fs.readFileSync(filePath, 'utf8')).map(normalizeCandle);
      const newCandles = await fetchOkxCandles(sym, tf.bar, 100);

      // Merge & deduplicate by ts
      const map = new Map();
      for (const c of existing) map.set(c.ts, c);
      for (const c of newCandles) map.set(c.ts, c);

      const merged = Array.from(map.values()).sort((a, b) => a.ts - b.ts);
      fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf8');

      const lastTs = merged[merged.length - 1].ts;
      const lastDate = new Date(lastTs).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      console.log(`  ✅ ${sym} ${tf.bar}: Đã cập nhật ${merged.length} nến (Đến: ${lastDate})`);
    }
  }
  console.log('🎉 Đồng bộ hoàn tất!');
}

sync().catch(console.error);

