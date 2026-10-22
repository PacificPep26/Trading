/**
 * CHECK_LIVE_MARKET.MJS
 * Quét trực tiếp thời gian thực thị trường OKX lúc này (11:16 AM 22/10/2026)
 * In ra chi tiết kỹ thuật từng coin để trả lời câu hỏi: "Giờ vô được lệnh nào không?"
 */

import { fetchOkxCandles } from '../src/server.js';
import { calculateEMA, analyzeCandle, findFractalPivots, classifyLiquidityTiers } from '../src/indicators.js';
import { evaluateMarket, DEFAULT_CONFIG } from '../src/engine.js';

const WATCHLIST = [
  'BTC-USDT',
  'ETH-USDT',
  'SOL-USDT',
  'LINK-USDT',
  'NEAR-USDT',
  'HYPE-USDT'
];

async function scanNow() {
  console.log('================================================================');
  console.log(`🔍 PHÂN TÍCH THỜI GIAN THỰC LÚC ${new Date().toLocaleTimeString('vi-VN', {timeZone: 'Asia/Ho_Chi_Minh'})} (22/10/2026)`);
  console.log('================================================================\n');

  for (const sym of WATCHLIST) {
    const instId = `${sym}-SWAP`;
    try {
      const candlesH4 = await fetchOkxCandles(instId, '4H', 100);
      const candlesH1 = await fetchOkxCandles(instId, '1H', 30);
      const candlesM15 = await fetchOkxCandles(instId, '15m', 20);

      if (!candlesH4 || candlesH4.length < 50) {
        console.log(`⚠️ ${sym}: Không đủ dữ liệu nến H4.`);
        continue;
      }

      const closedH4 = candlesH4.filter(c => c.confirm === 1);
      const closedH1 = candlesH1.filter(c => c.confirm === 1);
      const closedM15 = candlesM15.filter(c => c.confirm === 1);

      const lastH4 = closedH4[closedH4.length - 1];
      const curM15 = candlesM15[candlesM15.length - 1];
      const curPrice = curM15.close;

      const closesH4 = closedH4.map(c => c.close);
      const ema34 = calculateEMA(closesH4, 34).slice(-1)[0];
      const ema89 = calculateEMA(closesH4, 89).slice(-1)[0];
      const h4Anatomy = analyzeCandle(lastH4);

      const h4CloseDate = new Date(lastH4.ts + 4 * 3600 * 1000).toLocaleTimeString('vi-VN', {timeZone: 'Asia/Ho_Chi_Minh'});
      const barsSinceH4 = Math.round(((curM15.ts + 15*60*1000) - (lastH4.ts + 4*3600*1000)) / (15*60*1000));

      const tiers = classifyLiquidityTiers(closedH4, curPrice);

      const signal = evaluateMarket({
        symbol: sym,
        candlesH4: closedH4,
        candlesH1: closedH1,
        candlesM15: closedM15,
        config: DEFAULT_CONFIG
      });

      console.log(`----------------------------------------------------------------`);
      console.log(`📌 ${sym} | Giá hiện tại: ${curPrice}`);
      console.log(`   • Nến H4 vừa đóng lúc: ${h4CloseDate} (Cách đây ${barsSinceH4} nến M15)`);
      console.log(`   • H4 Đóng: ${lastH4.close} | Cao nhất: ${lastH4.high} | Thấp nhất: ${lastH4.low}`);
      console.log(`   • Dải EMA Kane H4: EMA34 = ${ema34?.toFixed(2)} | EMA89 = ${ema89?.toFixed(2)} (${ema34 >= ema89 ? 'BULL' : 'BEAR'})`);
      console.log(`   • Trạng thái Thanh khoản: ${tiers.sweepState} | Inducement Trap: ${tiers.isInducementTrapRisk ? 'CÓ NGUY CƠ' : 'AN TOÀN'}`);
      
      if (signal) {
        console.log(`   🎯 TÍN HIỆU ĐỦ ĐIỀU KIỆN: ${signal.direction} tại ${signal.entry} (SL: ${signal.stopLoss}, TP: ${signal.takeProfit}, RR: ${signal.riskReward})`);
      } else {
        console.log(`   ⏸️ LÝ DO CHƯA VÀO LỆNH:`);
        if (barsSinceH4 > 4) {
          console.log(`      - Nến H4 đóng lúc ${h4CloseDate} đã trôi qua ${barsSinceH4 * 15} phút (> 1 tiếng). Hết hiệu lực Freshness để vào lệnh mới!`);
        } else {
          console.log(`      - Chưa xuất hiện nến M15 xác nhận bứt phá theo cấu trúc Kane/SMC.`);
        }
      }
    } catch (err) {
      console.error(`Lỗi quét ${sym}:`, err.message);
    }
  }
  console.log('\n================================================================');
}

scanNow().catch(console.error);

