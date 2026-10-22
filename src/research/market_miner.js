/**
 * MARKET_MINER.JS
 * Autonomous Market Pattern Miner & Self-Learning Engine.
 * 
 * Tự động khai phá dữ liệu nến lịch sử, phát hiện các cú săn thanh khoản (Liquidity Hunts / Fakeouts),
 * gửi dữ liệu giải phẫu nến cho Gemini 3.8 Flash để tự động suy luận chân lý và bài học kinh nghiệm,
 * sau đó lưu trữ vĩnh viễn vào Knowledge Base để nâng cao trí tuệ cho Bot.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeCandle, classifyLiquidityTiers } from '../indicators.js';
import { callGemini } from '../ai_agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../../data/cache');
const LEARNED_FILE = path.join(__dirname, '../../data/knowledge_base/learned_patterns.json');

/**
 * Quét tìm các cú Fakeout & Liquidity Sweep trong chuỗi nến lịch sử
 * @param {Array} candlesH4 
 * @param {string} symbol 
 * @returns {Array}
 */
export function mineMarketEvents(candlesH4, symbol) {
  const events = [];
  if (!candlesH4 || candlesH4.length < 30) return events;

  for (let i = 25; i < candlesH4.length - 3; i++) {
    const historicalSlice = candlesH4.slice(0, i + 1);
    const triggerCandle = candlesH4[i];
    const anatomy = analyzeCandle(triggerCandle);

    const tiers = classifyLiquidityTiers(historicalSlice, triggerCandle.close);

    // 1. Phát hiện cú quét đỉnh săn SL phe Short (Bearish Sweep)
    if (tiers.tier1Highs.length > 0) {
      for (const eqh of tiers.tier1Highs) {
        // Đỉnh nến đâm thủng cản con EQH
        const breached = triggerCandle.high > eqh.maxPrice;
        // Râu nến trên dài >= 35% hoặc 3 nến sau cắm đầu giảm > 2%
        const futureSlice = candlesH4.slice(i + 1, i + 4);
        const minFuturePrice = Math.min(...futureSlice.map(c => c.low));
        const dropRate = (triggerCandle.high - minFuturePrice) / triggerCandle.high;

        if (breached && (anatomy.upperWickRatio >= 0.35 || dropRate >= 0.025)) {
          events.push({
            id: `MINE-${symbol}-${triggerCandle.ts}`,
            symbol,
            type: 'BEARISH_LIQUIDITY_SWEEP',
            timestamp: triggerCandle.ts,
            date: new Date(triggerCandle.ts).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
            eqhPrice: eqh.avgPrice,
            touchCount: eqh.touchCount,
            sweepHigh: triggerCandle.high,
            subsequentDropPercent: parseFloat((dropRate * 100).toFixed(2)),
            upperWickPercent: parseFloat((anatomy.upperWickRatio * 100).toFixed(1)),
            candleSnapshot: {
              open: triggerCandle.open,
              high: triggerCandle.high,
              low: triggerCandle.low,
              close: triggerCandle.close
            }
          });
          break;
        }
      }
    }

    // 2. Phát hiện cú quét đáy săn SL phe Long (Bullish Sweep)
    if (tiers.tier1Lows.length > 0) {
      for (const eql of tiers.tier1Lows) {
        const breached = triggerCandle.low < eql.minPrice;
        const futureSlice = candlesH4.slice(i + 1, i + 4);
        const maxFuturePrice = Math.max(...futureSlice.map(c => c.high));
        const pumpRate = (maxFuturePrice - triggerCandle.low) / triggerCandle.low;

        if (breached && (anatomy.lowerWickRatio >= 0.35 || pumpRate >= 0.025)) {
          events.push({
            id: `MINE-${symbol}-${triggerCandle.ts}`,
            symbol,
            type: 'BULLISH_LIQUIDITY_SWEEP',
            timestamp: triggerCandle.ts,
            date: new Date(triggerCandle.ts).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
            eqlPrice: eql.avgPrice,
            touchCount: eql.touchCount,
            sweepLow: triggerCandle.low,
            subsequentPumpPercent: parseFloat((pumpRate * 100).toFixed(2)),
            lowerWickPercent: parseFloat((anatomy.lowerWickRatio * 100).toFixed(1)),
            candleSnapshot: {
              open: triggerCandle.open,
              high: triggerCandle.high,
              low: triggerCandle.low,
              close: triggerCandle.close
            }
          });
          break;
        }
      }
    }
  }

  return events;
}

/**
 * Cho Gemini 3.8 Flash học và đúc kết chân lý từ sự kiện
 * @param {object} event 
 * @returns {Promise<object>}
 */
export async function deduceLessonWithGemini(event) {
  const prompt = `
Bạn là AI Quant Researcher & Chuyên gia SMC. Hãy phân tích trường hợp quét thanh khoản sau:
- Cặp tiền: ${event.symbol}
- Loại bẫy: ${event.type}
- Thời điểm: ${event.date}
- Vùng cản con (Inducement): ${event.eqhPrice || event.eqlPrice} (Đã test ${event.touchCount} lần trước đó)
- Giá nến quét đỉnh/đáy: ${event.sweepHigh || event.sweepLow}
- Râu nến phản ứng: ${event.upperWickPercent || event.lowerWickPercent}%
- Biên độ đảo chiều ngay sau đó: ${event.subsequentDropPercent || event.subsequentPumpPercent}%

DỮ LIỆU NẾN QUÉT:
${JSON.stringify(event.candleSnapshot)}

Hãy đúc kết một "Chân lý Giao dịch Định lượng" (Quantitative Market Truth) cho hệ thống bot:
1. Bẫy tâm lý: Đám đông retail đã mắc bẫy gì tại vùng cản con?
2. Chiêu bài Smart Money: Market Maker đã gom thanh khoản ra sao?
3. Quy tắc cốt lõi: Quy tắc 1 câu ngắn gọn, đanh thép để Bot Trade không bao giờ lặp lại sai lầm này.

Trả về duy nhất định dạng JSON thuần:
{
  "eventId": "${event.id}",
  "symbol": "${event.symbol}",
  "type": "${event.type}",
  "date": "${event.date}",
  "retailTrap": "...",
  "smartMoneyTactic": "...",
  "coreTruthRule": "..."
}
Không bao quanh bằng markdown json hay text thừa.
`.trim();

  try {
    const raw = await callGemini(prompt);
    const cleaned = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error(`[MINER] Lỗi Gemini phân tích ${event.id}:`, err.message);
    return null;
  }
}

async function main() {
  console.log('======================================================');
  console.log('⛏️ KHỞI CHẠY MARKET MINER - KHAI PHÁ CHÂN LÝ THỊ TRƯỜNG');
  console.log('======================================================\n');

  if (!fs.existsSync(CACHE_DIR)) {
    console.error('Không tìm thấy thư mục data/cache');
    return;
  }

  let learned = [];
  if (fs.existsSync(LEARNED_FILE)) {
    try {
      learned = JSON.parse(fs.readFileSync(LEARNED_FILE, 'utf8'));
    } catch {
      learned = [];
    }
  }

  const learnedIds = new Set(learned.map(l => l.eventId));
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.includes('4H_october.json'));

  console.log(`Tìm thấy ${files.length} file lịch sử H4 để khai phá.`);
  const allEvents = [];

  for (const file of files) {
    const symbol = file.split('_')[0].replace('-SWAP', '');
    try {
      const candles = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf8'));
      const events = mineMarketEvents(candles, symbol);
      console.log(`-> ${symbol}: Phát hiện ${events.length} sự kiện quét thanh khoản tiềm năng.`);
      allEvents.push(...events);
    } catch (err) {
      console.warn(`Lỗi đọc ${file}:`, err.message);
    }
  }

  // Lọc các sự kiện chưa học
  const newEvents = allEvents.filter(e => !learnedIds.has(e.id)).slice(0, 3); // Học 3 sự kiện tiêu biểu mỗi lần chạy để tối ưu quota
  console.log(`\nCó ${newEvents.length} sự kiện mới chuẩn bị được chuyển tới Gemini 3.8 Flash phân tích...`);

  for (const ev of newEvents) {
    console.log(`\n🧠 Đang phân tích sự kiện ${ev.id} (${ev.symbol} - ${ev.date})...`);
    const deduction = await deduceLessonWithGemini(ev);
    if (deduction) {
      learned.push(deduction);
      console.log(`   ✨ ĐÃ HỌC ĐƯỢC CHÂN LÝ: "${deduction.coreTruthRule}"`);
    }
  }

  fs.writeFileSync(LEARNED_FILE, JSON.stringify(learned, null, 2), 'utf8');
  console.log(`\n✅ Đã cập nhật ${learned.length} Chân lý thị trường vào: ${LEARNED_FILE}`);
}

// Khởi chạy khi gọi trực tiếp
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}

