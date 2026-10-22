/**
 * TEST_EXHAUSTION.MJS
 * Kiểm tra xem điều kiện Chống Short Đuổi / Bắt buộc có nhịp Hồi (Pullback Check)
 * có chặn thành công lệnh Short kiệt sức của SOL lúc 11:45 không!
 */

import { normalizeCandle } from '../src/indicators.js';
import { evaluateMarket, DEFAULT_CONFIG } from '../src/engine.js';
import fs from 'fs';
import path from 'path';

const CACHE_DIR = 'data/cache';
const candlesH4 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'SOL-USDT-SWAP_4H_october.json'), 'utf8')).map(normalizeCandle);
const candlesH1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'SOL-USDT-SWAP_1H_october.json'), 'utf8')).map(normalizeCandle);
const candlesM15 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'SOL-USDT-SWAP_15m_october.json'), 'utf8')).map(normalizeCandle);

// Nến 11:30 đóng lúc 11:45:00
const targetM15Idx = candlesM15.findIndex(c => c.ts === new Date('2026-10-22T04:30:00Z').getTime());
console.log('Target M15 Index:', targetM15Idx, candlesM15[targetM15Idx]);

const curM15 = candlesM15[targetM15Idx];
const m15Close = curM15.ts + 15 * 60 * 1000;
const visibleH4 = candlesH4.filter(c => c.ts + 4 * 3600 * 1000 <= m15Close);
const visibleH1 = candlesH1.filter(c => c.ts + 3600 * 1000 <= m15Close);
const visibleM15 = candlesM15.slice(0, targetM15Idx + 1);

const lastH4 = visibleH4[visibleH4.length - 1];
const h4Mid = (lastH4.high + lastH4.low) / 2;

console.log('Last H4:', {
  high: lastH4.high,
  low: lastH4.low,
  close: lastH4.close,
  h4Mid
});
console.log('Current M15 close (Entry):', curM15.close);

const isExhaustedShort = curM15.close < h4Mid;
console.log('curM15.close < h4Mid ?', isExhaustedShort, '(Đang ở nửa dưới/đáy nến H4)');

// Kiểm tra 8 nến M15 gần nhất xem có nến nào hồi lên được h4Mid không
const recentM15 = visibleM15.slice(-8);
const maxRecentHigh = Math.max(...recentM15.map(c => c.high));
console.log('Cao nhất 8 nến M15 gần đây (2 tiếng qua):', maxRecentHigh);
console.log('Có nhịp hồi lên 50% H4 không?:', maxRecentHigh >= h4Mid ? 'CÓ' : 'KHÔNG CÓ (RƠI XONG LẾT ĐÁY)');

