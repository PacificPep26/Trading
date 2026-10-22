/**
 * DAILY_BRIEFING.MJS
 * Script tự động tổng hợp dữ liệu thị trường và gọi Gemini 3.8 Flash
 * để sản xuất Bản Tin Smart Money & Bản Đồ Thanh Khoản hàng ngày phát qua Telegram.
 * 
 * Chạy lệnh thủ công:
 *   node scripts/daily_briefing.mjs           (Gửi Telegram)
 *   node scripts/daily_briefing.mjs --dry-run (Chỉ in ra Console)
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchOkxCandles } from '../src/server.js';
import { calculateEMA, classifyLiquidityTiers } from '../src/indicators.js';
import { generateDailyMarketAnalysis } from '../src/ai_agent.js';
import { sendTelegramMessage } from '../src/telegram.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSITIONS_FILE = path.join(__dirname, '../positions.json');

const WATCHLIST = [
  'BTC-USDT',
  'ETH-USDT',
  'SOL-USDT',
  'LINK-USDT',
  'NEAR-USDT',
  'HYPE-USDT'
];

async function collectMarketSnapshot() {
  const snapshot = [];

  for (const symbol of WATCHLIST) {
    const instId = symbol.includes('-SWAP') ? symbol : `${symbol}-SWAP`;
    try {
      const candlesH4 = await fetchOkxCandles(instId, '4H', 100);
      if (!candlesH4 || candlesH4.length < 50) continue;

      const closedH4 = candlesH4.filter(c => c.confirm === 1);
      const lastCandle = closedH4[closedH4.length - 1];
      const curPrice = lastCandle.close;

      const closes = closedH4.map(c => c.close);
      const ema34 = calculateEMA(closes, 34).slice(-1)[0];
      const ema89 = calculateEMA(closes, 89).slice(-1)[0];

      const liquidityTiers = classifyLiquidityTiers(closedH4, curPrice);

      snapshot.push({
        symbol,
        currentPrice: curPrice,
        trendH4: ema34 >= ema89 ? 'BULL' : 'BEAR',
        ema34: parseFloat(ema34?.toFixed(2) || '0'),
        ema89: parseFloat(ema89?.toFixed(2) || '0'),
        distanceToEma34Percent: parseFloat((((curPrice - ema34) / ema34) * 100).toFixed(2)),
        liquidityTiers: {
          tier1InducementHighs: liquidityTiers.tier1Highs.map(h => ({ price: h.avgPrice, touches: h.touchCount })),
          tier1InducementLows: liquidityTiers.tier1Lows.map(l => ({ price: l.avgPrice, touches: l.touchCount })),
          tier2MajorHigh: liquidityTiers.tier2MajorHigh,
          tier2MajorLow: liquidityTiers.tier2MajorLow,
          isInducementTrapRisk: liquidityTiers.isInducementTrapRisk,
          sweepState: liquidityTiers.sweepState,
          details: liquidityTiers.details
        }
      });
    } catch (err) {
      console.warn(`[BRIEFING] Lỗi nạp dữ liệu ${symbol}:`, err.message);
    }
  }

  return snapshot;
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log('======================================================');
  console.log(`🤖 KHỞI TẠO BẢN TIN SMART MONEY HÀNG NGÀY (GEMINI 3.8 FLASH)`);
  console.log(`Chế độ: ${isDryRun ? 'DRY-RUN (In console)' : 'LIVE TELEGRAM'}`);
  console.log('======================================================\n');

  console.log('1. Đang quét dữ liệu kỹ thuật và bản đồ thanh khoản...');
  const symbolsData = await collectMarketSnapshot();
  console.log(`   -> Thu thập thành công dữ liệu cho ${symbolsData.length} coin lớn.`);

  let activePositions = [];
  if (fs.existsSync(POSITIONS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'));
      activePositions = Array.isArray(data) ? data : (data.positions || []);
    } catch {
      activePositions = [];
    }
  }

  console.log('2. Đang gửi dữ liệu tới Gemini 3.8 Flash phân tích...');
  const briefingText = await generateDailyMarketAnalysis({ symbolsData, activePositions });

  console.log('\n================ NỘI DUNG BẢN TIN ================');
  console.log(briefingText);
  console.log('==================================================\n');

  if (isDryRun) {
    console.log('✅ Hoàn tất chế độ Dry-Run (Không gửi Telegram).');
  } else {
    console.log('3. Đang phát bản tin qua Telegram Bot...');
    const success = await sendTelegramMessage(briefingText);
    if (success) {
      console.log('✅ Phát bản tin qua Telegram thành công rực rỡ!');
    } else {
      console.error('❌ Gửi Telegram thất bại. Kiểm tra cấu hình Token/Chat ID.');
    }
  }
}

main().catch(err => {
  console.error('[BRIEFING ERROR]:', err);
  process.exit(1);
});

