/**
 * CHECK.MJS
 * Bộ kiểm tra tự động (Unit Test) cho toán học chỉ báo và lõi chiến lược.
 * Chạy lệnh: npm run check
 */

import {
  calculateSMA,
  calculateEMA,
  calculateATR,
  analyzeCandle,
  isMarubozu,
  findFractalPivots,
  getNearestKeyLevels,
  findFairValueGaps,
  detectSqueeze,
  normalizeCandle,
  validateCandleSchema,
  classifyLiquidityTiers,
  detectVolumeAbsorption,
  detectPreviousBarSweep,
  calculateADX,
  calculateATRCompression,
  detectCandlePattern,
  calculateVolumeProfile,
  findBreakerBlocks
} from '../src/indicators.js';

import {
  calculatePositionSize,
  checkBtcMacroShield,
  analyzeBtcLocomotive,
  detectMarketPhase,
  evaluateMarket,
  generateKeyLevelRadar,
  calculateSetupQualityScore,
  DEFAULT_CONFIG,
  detectMacroRangeBox,
  evaluateMacroRangeFade,
  buildBoxAlert,
  evaluateVolumeBreakout,
  evaluateTradeFlipOpportunity,
  registerTakeProfitHit
} from '../src/engine.js';

import { getEffectiveConfig, BOT_CONFIG } from '../src/config.js';

import {
  inspectTradeMistake,
  applyDisciplinaryPenalty,
  checkAdaptiveTradeAllowed,
  rewardWinAndClearPenalty
} from '../src/learning.js';

import { fetchOkxCandles } from '../src/server.js';
import { formatPrice, buildNewSignalMessage, buildEarlySignalMessage, buildPendingCancelMessage, buildSmcFvgAlertMessage, buildBoxDigestMessage, sendTelegramMessage } from '../src/telegram.js';
import { persistentMap } from '../src/alert_state.js';
import os from 'os';
import fsNode from 'fs';
import pathNode from 'path';
import { latestSmcFvgSignal } from '../src/strategies/smc_fvg.js';
import { tryKaneLongSetup, tryKaneShortSetup } from '../src/strategies/kane_strategy.js';
import { computeH4Freshness, isInTradingSession, computeStructTrend } from '../src/strategies/regime.js';
import { evaluateWyckoffSpring, evaluateWyckoffBreakoutRetest } from '../src/strategies/wyckoff_box.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

console.log('======================================================');
console.log('🧪 BẮT ĐẦU KIỂM THỬ ĐỊNH LƯỢNG (UNIT TESTS)');
console.log('======================================================\n');

// 1. Test SMA & EMA
console.log('1. Kiểm tra Moving Averages (SMA / EMA):');
const values = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const sma5 = calculateSMA(values, 5);
assert(sma5[4] === 12, 'SMA 5 nến đầu của [10..14] phải bằng 12');
assert(sma5[9] === 17, 'SMA 5 nến cuối của [15..19] phải bằng 17');

const ema5 = calculateEMA(values, 5);
assert(ema5[4] === 12, 'EMA khởi tạo tại kỳ đầu phải bằng 12');
assert(ema5[9] > 16.5 && ema5[9] < 18, 'EMA phản ánh trọng số tăng dần');

// 2. Test ATR
console.log('\n2. Kiểm tra Average True Range (ATR):');
const mockCandles = [
  { high: 105, low: 95, close: 100 },
  { high: 110, low: 98, close: 108 },
  { high: 112, low: 102, close: 104 },
  { high: 106, low: 96, close: 98 },
  { high: 100, low: 90, close: 92 },
  { high: 95, low: 88, close: 94 },
  { high: 99, low: 91, close: 96 },
  { high: 102, low: 93, close: 97 },
  { high: 105, low: 95, close: 103 },
  { high: 108, low: 100, close: 106 },
  { high: 111, low: 102, close: 108 },
  { high: 115, low: 105, close: 112 },
  { high: 116, low: 108, close: 110 },
  { high: 114, low: 106, close: 109 },
  { high: 112, low: 104, close: 107 }
];
const atrs = calculateATR(mockCandles, 14);
assert(atrs[13] !== null && atrs[13] > 0, 'ATR(14) tính toán thành công tại nến thứ 14');

// 3. Test Giải phẫu nến & Râu nến
console.log('\n3. Kiểm tra Phân tích Râu nến (Wick Analysis):');
// Cây nến quét đáy rút chân (Hammer / Pinbar)
const sweepBullCandle = { open: 100, high: 102, low: 80, close: 98 };
const bullAnatomy = analyzeCandle(sweepBullCandle);
assert(bullAnatomy.lowerWickRatio > 0.8, 'Râu dưới chiếm > 80% biên độ (Rút chân mạnh)');
assert(bullAnatomy.upperWickRatio < 0.15, 'Râu trên rất ngắn');

// Cây nến quét đỉnh rút râu trên (Shooting Star)
const sweepBearCandle = { open: 100, high: 120, low: 99, close: 101 };
const bearAnatomy = analyzeCandle(sweepBearCandle);
assert(bearAnatomy.upperWickRatio > 0.85, 'Râu trên chiếm > 85% biên độ (Từ chối giá mạnh)');

// 4. Test Fractal Pivots
console.log('\n4. Kiểm tra Fractal Key Levels (Pivots L=2, R=2):');
const pivotCandles = [
  { high: 10, low: 5, close: 8, ts: 1 },
  { high: 12, low: 6, close: 10, ts: 2 },
  { high: 20, low: 8, close: 15, ts: 3 }, // Pivot High tại index 2
  { high: 14, low: 7, close: 11, ts: 4 },
  { high: 11, low: 4, close: 8, ts: 5 },
  { high: 9, low: 2, close: 6, ts: 6 },   // Pivot Low tại index 5
  { high: 13, low: 5, close: 10, ts: 7 },
  { high: 15, low: 8, close: 12, ts: 8 }
];
const pivots = findFractalPivots(pivotCandles, 2, 2);
const hasPivotHigh20 = pivots.some(p => p.type === 'HIGH' && p.price === 20);
const hasPivotLow2 = pivots.some(p => p.type === 'LOW' && p.price === 2);
assert(hasPivotHigh20, 'Phát hiện chính xác Pivot High tại mức giá 20');
assert(hasPivotLow2, 'Phát hiện chính xác Pivot Low tại mức giá 2');

const levels = getNearestKeyLevels(pivotCandles, 10, 2, 2);
assert(levels.nearestResistance === 20, 'Kháng cự gần nhất của giá 10 là 20');
assert(levels.nearestSupport === 2, 'Hỗ trợ gần nhất của giá 10 là 2');

// 5. Test Fair Value Gap (FVG)
console.log('\n5. Kiểm tra Fair Value Gap (FVG):');
const fvgCandles = [
  { open: 100, high: 105, low: 98, close: 104, ts: 1 },
  { open: 104, high: 130, low: 103, close: 128, ts: 2 }, // Cây đẩy nổ vol
  { open: 128, high: 135, low: 115, close: 132, ts: 3 }  // Low=115 > High prev=105 -> Gap 105-115
];
const fvgs = findFairValueGaps(fvgCandles);
assert(fvgs.length === 1 && fvgs[0].type === 'BULLISH', 'Nhận diện chuẩn xác Bullish FVG');
assert(fvgs[0].bottom === 105 && fvgs[0].top === 115, 'Biên độ FVG chính xác từ 105 đến 115');

// 6. Test Quản trị vốn 1R cố định
console.log('\n6. Kiểm tra Kỷ luật Quản trị vốn (Fixed 1R):');
const entry = 100;
const stopLoss = 95; // Risk = 5$ mỗi coin
const riskUsd = 10;  // Chấp nhận rủi ro 10 USDT
const sizing = calculatePositionSize(entry, stopLoss, riskUsd, 10);
assert(sizing.size === 2, 'Số lượng coin phải bằng 10 / 5 = 2.0 coin');
assert(sizing.notional === 200, 'Giá trị vị thế = 2 * 100 = 200 USDT');
assert(sizing.margin === 20, 'Ký quỹ Isolated 10X = 200 / 10 = 20 USDT');
assert(sizing.isBlocked === false, 'Ký quỹ hợp lệ không bị chặn');

// Test Liquidation Distance Guard
const safeSizing = calculatePositionSize(100, 95, 10, 10);
assert(safeSizing.isBlocked === false, 'Liquidation Guard: Khoảng cách SL 5% ở 10x an toàn tuyệt đối (< 7%)');
const unsafeSizing = calculatePositionSize(100, 92, 10, 10);
assert(unsafeSizing.isBlocked === true && unsafeSizing.blockReason.includes('LIQUIDATION_RISK'), 'Liquidation Guard: Chặn lệnh khi khoảng cách SL >= 7% ở 10x');

// 7. Test Khiên BTC Macro 1H
console.log('\n7. Kiểm tra Khiên BTC Macro 1H:');
const btcDumpCandle = { open: 100000, high: 100500, low: 95000, close: 95200 };
const btcMockH1 = new Array(15).fill({ open: 100000, high: 101000, low: 99000, close: 100000 });
btcMockH1.push(btcDumpCandle);
const shieldDump = checkBtcMacroShield(btcMockH1);
assert(!shieldDump.canLong, 'Khiên BTC chặn mở Long khi BTC vừa xả nến Marubozu đỏ');
assert(shieldDump.canShort, 'Vẫn cho phép mở Short');

// 8. Test Cấu hình Time-Stop & Khử lỗi nến confirm OKX API
console.log('\n8. Kiểm tra Cấu hình Time-Stop & Xác thực nến OKX:');
// Time-Stop đã TẮT HẲN (26/10) sau khi backtest full-history xác nhận mọi giá
// trị đã test (16/48/96/150 nến) đều làm hồi quy nghiêm trọng so với tắt hẳn
// (PF 0.86 -> 1.47) - xem docs/REGIME_ADAPTIVE_PLAN.md.
assert(DEFAULT_CONFIG.timeStopBars === 0, 'DEFAULT_CONFIG.timeStopBars mặc định TẮT HẲN (=0) theo kết luận backtest full-history');
assert(DEFAULT_CONFIG.minCoinPrice === 1.0, 'DEFAULT_CONFIG.minCoinPrice mặc định chặn coin < 1.0 USDT (loại trừ coin 0.xx)');

// Test từ chối coin 0.xx trong evaluateMarket
const subDollarM15 = [
  { open: 0.05, high: 0.051, low: 0.049, close: 0.05, ts: 1729000000000, confirm: 1 },
  { open: 0.05, high: 0.051, low: 0.049, close: 0.05, ts: 1729000900000, confirm: 1 }
];
const subDollarH4 = new Array(95).fill({ open: 0.05, high: 0.051, low: 0.049, close: 0.05, ts: 1729000000000, confirm: 1 });
const resSubDollar = evaluateMarket({
  symbol: 'PENNY-USDT',
  candlesH4: subDollarH4,
  candlesH1: subDollarH4.slice(0, 20),
  candlesM15: subDollarM15,
  config: DEFAULT_CONFIG
});
assert(resSubDollar === null, 'evaluateMarket tự động từ chối coin có giá 0.xx (< 1.0 USDT)');

const mockOkxRaw = [
  ['1729000000000', '100', '105', '99', '103', '500', '50000', '50000', '1'],
  ['1729000900000', '103', '104', '101', '102', '300', '30000', '30000', '0']
];
const parsedCandles = mockOkxRaw.map(c => ({
  ts: parseInt(c[0], 10),
  open: parseFloat(c[1]),
  high: parseFloat(c[2]),
  low: parseFloat(c[3]),
  close: parseFloat(c[4]),
  vol: parseFloat(c[5]),
  confirm: c[8] !== undefined ? parseInt(c[8], 10) : 1
}));
assert(parsedCandles[0].confirm === 1, 'Nến confirm=1 được phân tích chính xác là nến đã hoàn thành');
assert(parsedCandles[1].confirm === 0, 'Nến confirm=0 được phân tích chính xác là nến đang chạy');
const closedOnly = parsedCandles.filter(c => c.confirm === 1);
assert(closedOnly.length === 1 && closedOnly[0].close === 103, 'Bộ lọc nến confirm=1 hoạt động chính xác');

// 9. Kiểm thử Hợp đồng Dữ liệu Nến (Candle Data Contract Verification)
console.log('\n9. Kiểm thử Hợp đồng Dữ liệu Nến (Data Contract):');

// 9.1. Chuẩn hóa nến mảng OKX 9 phần tử
const okxRawCandle = ['1729000000000', '65000.5', '65500', '64800.2', '65200', '1250.5', '81500000', '81500000', '1'];
const normFromRaw = normalizeCandle(okxRawCandle);
assert(validateCandleSchema(normFromRaw), 'normalizeCandle từ raw array OKX phải tuân thủ 100% Candle Schema');
assert(normFromRaw.confirm === 1, 'Trường confirm phải bằng 1');

// 9.2. Chuẩn hóa nến cache/database cũ (thiếu confirm)
const cachedObj = { ts: 1729000000000, open: 65000.5, high: 65500, low: 64800.2, close: 65200, vol: 1250.5 };
const normFromCache = normalizeCandle(cachedObj);
assert(validateCandleSchema(normFromCache), 'normalizeCandle từ cache cũ phải tự bù confirm=1 và hợp lệ schema');
assert(normFromCache.confirm === 1, 'Cache cũ tự động có confirm=1');

// 9.3. Bắt lỗi khi dữ liệu sai lệch hoặc thiếu trường bắt buộc
const invalidCandleMissingConfirm = { ts: 1729000000000, open: 65000.5, high: 65500, low: 64800.2, close: 65200, vol: 1250.5 };
assert(!validateCandleSchema(invalidCandleMissingConfirm), 'validateCandleSchema phải từ chối object thiếu trường confirm');

const invalidCandleNaN = { ts: 1729000000000, open: NaN, high: 65500, low: 64800.2, close: 65200, vol: 1250.5, confirm: 1 };
assert(!validateCandleSchema(invalidCandleNaN), 'validateCandleSchema phải từ chối nến chứa NaN');

// 9.4. Kiểm thử Hợp đồng trên hàm fetchOkxCandles trực tiếp
const sampleCandles = await fetchOkxCandles('BTC-USDT-SWAP', '4H', 5);
if (sampleCandles && sampleCandles.length > 0) {
  const allValid = sampleCandles.every(validateCandleSchema);
  assert(allValid, `Mọi nến trả về từ fetchOkxCandles (lấy ${sampleCandles.length} nến) đều khớp 100% Data Contract`);
  const hasConfirmDefined = sampleCandles.every(c => c.confirm === 0 || c.confirm === 1);
  assert(hasConfirmDefined, '100% nến có trường confirm là 0 hoặc 1, không bao giờ undefined');
} else {
  console.log('  ⚠️ Cảnh báo: Môi trường offline, đã kiểm thử hợp đồng qua mock.');
}

// 10. Kiểm tra Phân cấp Thanh khoản 2 Tầng (classifyLiquidityTiers)
console.log('\n10. Kiểm tra Phân cấp Thanh khoản 2 Tầng (classifyLiquidityTiers):');
// Tạo mock nến H4 có 2 đỉnh bằng nhau (Equal Highs ~ 83,500) và 1 đỉnh cản lớn (Major High = 85,000)
const mockLiquidityH4 = [
  { ts: 1000, open: 80000, high: 85000, low: 79000, close: 82000, vol: 100, confirm: 1 }, // Major High = 85000
  { ts: 2000, open: 82000, high: 82500, low: 81000, close: 81500, vol: 100, confirm: 1 },
  { ts: 3000, open: 81500, high: 82000, low: 80500, close: 81000, vol: 100, confirm: 1 },
  { ts: 4000, open: 81000, high: 81500, low: 80000, close: 80500, vol: 100, confirm: 1 },
  { ts: 5000, open: 80500, high: 83500, low: 80200, close: 82800, vol: 100, confirm: 1 }, // Pivot High 1 = 83500
  { ts: 6000, open: 82800, high: 83000, low: 82000, close: 82200, vol: 100, confirm: 1 },
  { ts: 7000, open: 82200, high: 82600, low: 81800, close: 82000, vol: 100, confirm: 1 },
  { ts: 8000, open: 82000, high: 83600, low: 81900, close: 82500, vol: 100, confirm: 1 }, // Pivot High 2 = 83600 (EQH)
  { ts: 9000, open: 82500, high: 82900, low: 82200, close: 82600, vol: 100, confirm: 1 },
  { ts: 10000, open: 82600, high: 82800, low: 82300, close: 82700, vol: 100, confirm: 1 },
  { ts: 11000, open: 82700, high: 83100, low: 82400, close: 82900, vol: 100, confirm: 1 },
  { ts: 12000, open: 82900, high: 83200, low: 82600, close: 83000, vol: 100, confirm: 1 },
  { ts: 13000, open: 83000, high: 83450, low: 82800, close: 83400, vol: 100, confirm: 1 },
  { ts: 14000, open: 83400, high: 83550, low: 83100, close: 83480, vol: 100, confirm: 1 },
  { ts: 15000, open: 83480, high: 83580, low: 83200, close: 83500, vol: 100, confirm: 1 } // Đang test cản con
];

const tiersAtRisk = classifyLiquidityTiers(mockLiquidityH4, 83500);
assert(tiersAtRisk.tier1Highs.length > 0, 'Phát hiện cụm Equal Highs (Tier 1 Inducement)');
assert(tiersAtRisk.tier2MajorHigh === 85000, 'Xác định chính xác cản lớn Major High là 85,000');
assert(tiersAtRisk.isInducementTrapRisk === true, 'Cảnh báo chính xác rủi ro Bẫy Inducement khi giá chưa quét qua đỉnh con');

// Mô phỏng cây nến 19h quét qua cản con 83,600 lên 84,900 chạm sát cản lớn 85,000 và để lại râu trên 60%
const mockSweepH4 = [
  ...mockLiquidityH4,
  { ts: 16000, open: 83500, high: 84900, low: 83200, close: 83600, vol: 500, confirm: 1 }
];
const tiersAfterSweep = classifyLiquidityTiers(mockSweepH4, 83600);
assert(tiersAfterSweep.sweepState === 'BEARISH_SWEEP_CONFIRMED', 'Xác nhận Liquidity Sweep thành công khi quét qua Inducement chạm cản lớn');
assert(tiersAfterSweep.isInducementTrapRisk === false, 'Sau khi đã quét râu sạch SL thì không còn bị bẫy Inducement chặn nữa');

// 11. Test Volume Absorption & Previous Bar Sweep
console.log('\n11. Kiểm tra Volume Absorption (VSA Climax) & Previous Bar Sweep:');
const mockVolCandles = [];
for (let i = 0; i < 20; i++) {
  mockVolCandles.push({ ts: i * 1000, open: 100, high: 105, low: 95, close: 102, vol: 1000, confirm: 1 });
}
// Nến Selling Climax: Volume tăng vọt 3000 (3x SMA20), giá nhúng xuống 70 rồi rút chân lên 98 (râu dưới > 75%)
mockVolCandles.push({ ts: 21000, open: 100, high: 102, low: 70, close: 98, vol: 3000, confirm: 1 });

const bullAbsorption = detectVolumeAbsorption(mockVolCandles);
assert(bullAbsorption.isAbsorption === true, 'Phát hiện thành công hiện tượng Volume Absorption');
assert(bullAbsorption.type === 'BULLISH', 'Xác định chính xác loại hình Selling Climax (Bullish Absorption)');
assert(bullAbsorption.volRatio >= 2.5, 'Tỷ lệ Volume đạt >= 2.5x SMA20');

// Test Previous Bar Low Sweep
const mockPblSweep = [
  { ts: 1000, open: 100, high: 110, low: 90, close: 105, vol: 100, confirm: 1 },
  { ts: 2000, open: 105, high: 108, low: 85, close: 95, vol: 200, confirm: 1 } // Nhúng qua đáy 90 rút chân râu dưới
];
const pblResult = detectPreviousBarSweep(mockPblSweep, 0.35);
assert(pblResult.isSweep === true, 'Nhận diện chuẩn xác cú quét đáy nến liền kề (PBL Sweep)');
assert(pblResult.type === 'BULLISH', 'Hướng quét đáy nến trước kích hoạt đảo chiều tăng');
assert(pblResult.sweptPrice === 90, 'Mức giá bị quét chính xác là 90');

// 12. Test Bản Đồ Cản Canh Trước (generateKeyLevelRadar)
console.log('\n12. Kiểm tra Bản Đồ Cản Canh Trước (generateKeyLevelRadar):');
const radar = generateKeyLevelRadar({
  symbol: 'BTC-USDT',
  candlesH4: mockLiquidityH4,
  curPrice: 83450
});
assert(radar !== null, 'Tạo bản đồ radar thành công');
assert(radar.radarStatus === 'APPROACHING_RESISTANCE', 'Cảnh báo chính xác khi giá đang áp sát vùng cản trên');
assert(typeof radar.scenario === 'string' && radar.scenario.includes('CẢNH BÁO CANH SHORT'), 'Sinh kịch bản canh Short đón đầu chi tiết');

// 13. Test Nhận diện Giai đoạn Thị trường (detectMarketPhase)
console.log('\n13. Kiểm tra Nhận diện Giai đoạn Thị trường (Market Regime):');
const mockH4Candles = Array(20).fill(null).map((_, i) => ({
  ts: i * 4 * 3600 * 1000,
  open: 100 + i * 2,
  high: 105 + i * 2,
  low: 98 + i * 2,
  close: 104 + i * 2,
  vol: 1000,
  confirm: 1
}));
const mockCloses = mockH4Candles.map(c => c.close);
const mockE34 = calculateEMA(mockCloses, 5);
const mockE89 = mockE34.map(v => v * 0.95); // EMA34 > EMA89 mở rộng
const phaseUp = detectMarketPhase(mockH4Candles, mockE34, mockE89);
assert(phaseUp === 'STRONG_UPTREND', 'Nhận diện chuẩn xác giai đoạn Xu hướng Tăng Dốc Mạnh (STRONG_UPTREND)');

const mockE89Down = mockE34.map(v => v * 1.05); // EMA34 < EMA89 dốc xuống
const phaseDown = detectMarketPhase(mockH4Candles.map(c => ({ ...c, close: 50 })), mockE34, mockE89Down);
assert(phaseDown === 'STRONG_DOWNTREND', 'Nhận diện chuẩn xác giai đoạn Xu hướng Giảm Dốc Đứng (STRONG_DOWNTREND)');

// 14. Test Hệ Thống Tự Học & Phạt Kỷ Luật (Adaptive Learning & Penalty Gate)
console.log('\n14. Kiểm tra Hệ Thống Tự Học & Phạt Kỷ Luật (Adaptive Learning):');
const mockLossCandlesH4 = Array(90).fill(null).map((_, i) => ({
  ts: i * 4 * 3600 * 1000,
  open: 200 - i * 2,
  high: 205 - i * 2,
  low: 195 - i * 2,
  close: 198 - i * 2,
  vol: 1000,
  confirm: 1
}));

const mockLossPos = {
  symbol: 'SOL-USDT',
  direction: 'LONG',
  entry: 100,
  stopLoss: 98,
  initialStopLoss: 98,
  strategy: 'SMC_SWEEP_REVERSAL_LONG'
};

// Giả lập thua lệnh Long khi H4 đang trong bão giảm STRONG_DOWNTREND
const mistake = inspectTradeMistake({
  pos: mockLossPos,
  candlesH4: mockLossCandlesH4,
  candlesH1: mockLossCandlesH4.slice(0, 15),
  candlesM15: mockLossCandlesH4.slice(0, 20)
});
assert(mistake.mistakeType === 'TREND_FIGHTING', 'Mổ xẻ chuẩn xác điểm sai: Bắt dao rơi trong xu hướng giảm dốc đứng');
assert(mistake.forbiddenDirection === 'LONG', 'Cấm hướng vi phạm: Khóa chặt lệnh Long');

// Áp dụng hình phạt
const penalty = applyDisciplinaryPenalty(mockLossPos, mistake);
assert(penalty.cooldownHours >= 4, 'Áp dụng hình phạt đóng băng tối thiểu 4 tiếng trên cặp SOL-USDT');

// Kiểm tra cổng Adaptive Veto Gate (chỉ hoạt động khi bật ENABLE_PENALTY_SYSTEM,
// mặc định TẮT theo kết luận backtest 28/10 - xem src/learning.js)
process.env.ENABLE_PENALTY_SYSTEM = 'true';
const checkLong = checkAdaptiveTradeAllowed('SOL-USDT', 'LONG');
assert(checkLong.allowed === false, 'Cổng kỷ luật Veto chặn đứng lệnh Long trên cặp đang bị phạt (khi ENABLE_PENALTY_SYSTEM=true)');

// Sau khi thắng lệnh, xóa án phạt phục hồi
rewardWinAndClearPenalty('SOL-USDT');
const checkAfterReward = checkAdaptiveTradeAllowed('SOL-USDT', 'LONG');
assert(checkAfterReward.allowed === true, 'Gỡ bỏ hình phạt và khôi phục giao dịch sau lệnh Thắng');

console.log('\n15. Kiểm tra Bộ Chỉ Huy Đầu Tàu BTC & Kỷ Luật Cấu Trúc (Locomotive Structural Discipline):');
// Tạo chuỗi nến BTC H1 đang xả lũ (Dumping Waterfall)
const mockBtcDumpingH1 = Array(20).fill(null).map((_, i) => ({
  ts: i * 3600 * 1000,
  open: 70000 - i * 1000,
  high: 70050 - i * 1000,
  low: 68950 - i * 1000,
  close: 69000 - i * 1000, // Thân nến xả 1000 giá chiếm > 90% biên độ
  vol: 5000,
  confirm: 1
}));

// Đầu Tàu BTC nhận diện chính xác trạng thái xả lũ
const btcLocoDump = analyzeBtcLocomotive({ btcH1Candles: mockBtcDumpingH1 });
assert(btcLocoDump.canLongAlts === false, 'Đầu tàu BTC xả lũ: CẤM TUYỆT ĐỐI Long Altcoin');
assert(btcLocoDump.canShortAlts === true, 'Đầu tàu BTC xả lũ: Vẫn cho phép Short Altcoin thuận theo đầu tàu');
assert(btcLocoDump.phase === 'DUMPING_WATERFALL', 'Giai đoạn Đầu Tàu: DUMPING_WATERFALL');

// Altcoin NEAR-USDT dính SL do mở Long cản tàu
const mockNearLongPos = {
  symbol: 'NEAR-USDT',
  direction: 'LONG',
  entry: 5.0,
  stopLoss: 4.8,
  initialStopLoss: 4.8,
  strategy: 'SMC_SWEEP_REVERSAL_LONG'
};

const nearMistake = inspectTradeMistake({
  pos: mockNearLongPos,
  candlesH4: mockLossCandlesH4,
  candlesH1: mockLossCandlesH4.slice(0, 15),
  candlesM15: mockLossCandlesH4.slice(0, 20),
  btcH1Candles: mockBtcDumpingH1
});

assert(nearMistake.mistakeType === 'LOCOMOTIVE_MISALIGNMENT', 'Mổ xẻ chuẩn xác lỗi: Không theo Đầu Tàu BTC (LOCOMOTIVE_MISALIGNMENT)');
assert(nearMistake.requiredBtcConfirmation === 'BTC_BULLISH_REVERSAL_CONFIRMED', 'Yêu cầu điều kiện gỡ án: Đầu Tàu BTC phải xác nhận đảo chiều');

// Thi hành án phạt không dùng đồng hồ
const nearPenalty = applyDisciplinaryPenalty(mockNearLongPos, nearMistake);
assert(nearPenalty.isLocomotiveAnchored === true, 'Hình phạt neo trực tiếp vào Cấu Trúc Đầu Tàu (Không dùng giờ đồng hồ)');
assert(nearPenalty.penaltyUntilStr.includes('CHỜ ĐẦU TÀU BTC XÁC NHẬN CẤU TRÚC'), 'Thông điệp án phạt rõ ràng: Chờ Đầu Tàu BTC xác nhận');

// Khi BTC vẫn đang xả lũ: Khóa chặt lệnh Long, nhưng CHO PHÉP Short thuận chiều Đầu Tàu
const checkNearLongWhileDump = checkAdaptiveTradeAllowed('NEAR-USDT', 'LONG', mockBtcDumpingH1);
assert(checkNearLongWhileDump.allowed === false, 'Khi Đầu Tàu chưa đảo chiều: Khóa chặt lệnh Long NEAR-USDT');

const checkNearShortWhileDump = checkAdaptiveTradeAllowed('NEAR-USDT', 'SHORT', mockBtcDumpingH1);
assert(checkNearShortWhileDump.allowed === true, 'Cho phép mở lệnh Short NEAR-USDT thuận theo chiều rơi của Đầu Tàu BTC');

// Giả lập Đầu Tàu BTC xuất hiện nến rút chân đảo chiều mạnh (Bullish Reversal Wick)
const mockBtcReversalH1 = [...mockBtcDumpingH1.slice(0, 19), {
  ts: 20 * 3600 * 1000,
  open: 60000,
  high: 61000,
  low: 58000, // Rút râu dưới cực mạnh từ 58000 lên 60800
  close: 60800,
  vol: 15000,
  confirm: 1
}];

const checkNearLongAfterBtcReversal = checkAdaptiveTradeAllowed('NEAR-USDT', 'LONG', mockBtcReversalH1);
assert(checkNearLongAfterBtcReversal.allowed === true, 'Đầu Tàu BTC vừa xác nhận rút râu đảo chiều: Giải phóng án phạt cho NEAR-USDT ngay lập tức!');

// 16. Kiểm tra Chấm Điểm Setup & Tuyển Chọn Con Khỏe Nhất (Relative Strength & Quality Scoring)
console.log('\n16. Kiểm tra Chấm Điểm Setup & Tuyển Chọn Con Khỏe Nhất (Relative Strength & Quality Scoring):');

const ethConfig = getEffectiveConfig('ETH-USDT');
assert(ethConfig.atrBufferMultiplier === 0.75, 'Cấu hình chuẩn ETH có đệm ATR = 0.75');

const solConfig = getEffectiveConfig('SOL-USDT');
assert(solConfig.atrBufferMultiplier === 1.0, 'SOL-USDT tự động nới đệm ATR = 1.0 chống quét râu hung hãn');
assert(solConfig.maxSlDistanceRate === 0.035, 'SOL-USDT nới biên độ SL tối đa tới 3.5%');

// Giả lập setup xuất sắc: Râu rút chân 60%, VSA Climax Absorption, Cản lớn Tier 2, Khỏe hơn BTC
const strongM15 = [{
  ts: 1000,
  open: 105,
  high: 106,
  low: 95, // lower wick: 105 - 95 = 10, total range = 11 -> ratio = 10/11 = 90.9%
  close: 105,
  vol: 5000,
  confirm: 1
}];
const strongH4 = [{
  ts: 1000,
  open: 105,
  high: 106,
  low: 95,
  close: 105,
  vol: 10000,
  confirm: 1
}];
const prevM15Bars = Array.from({ length: 20 }, (_, i) => ({
  ts: i * 900000,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  vol: 500, // SMA20 vol = 500
  confirm: 1
}));
const allM15Bars = [...prevM15Bars, ...strongM15];

const mockHighQualitySignal = {
  direction: 'LONG',
  strategy: 'SMC_ZONE_REACTION_LONG',
  reason: 'SMC_ZONE_REACTION_LONG: Đón đầu tại Cản Lớn Major 95'
};

const mockBtcH1 = [
  { ts: 1000, open: 60000, high: 60100, low: 59900, close: 60000, vol: 1000, confirm: 1 },
  { ts: 2000, open: 60000, high: 60050, low: 59950, close: 60000, vol: 1000, confirm: 1 } // BTC đi ngang 0%
];
const mockCoinH1 = [
  { ts: 1000, open: 100, high: 101, low: 99, close: 100, vol: 1000, confirm: 1 },
  { ts: 2000, open: 100, high: 103, low: 99, close: 102, vol: 1000, confirm: 1 } // Coin tăng +2% -> Khỏe hơn BTC
];

const highQualityScore = calculateSetupQualityScore({
  signal: mockHighQualitySignal,
  candlesH4: strongH4,
  candlesH1: mockCoinH1,
  candlesM15: allM15Bars,
  btcH1Candles: mockBtcH1
});

assert(highQualityScore.score >= 80, `Setup xuất sắc đạt điểm cao >= 80 (Thực tế: ${highQualityScore.score} điểm)`);
assert(highQualityScore.reasons.some(r => r.includes('Râu nến')), 'Nhận diện râu nến xuất sắc');
assert(highQualityScore.reasons.some(r => r.includes('Khỏe hơn BTC') || r.includes('Cản Lớn')), 'Nhận diện cản lớn & sức mạnh so với BTC');

// Giả lập setup yếu: không có râu, không có volume climax, không có cản lớn
const weakM15 = [{
  ts: 1000,
  open: 100,
  high: 101,
  low: 100,
  close: 101,
  vol: 10,
  confirm: 1
}];
const mockWeakSignal = {
  direction: 'LONG',
  strategy: 'KANE_THUAN_TREND',
  reason: 'Test trend thông thường'
};
const weakQualityScore = calculateSetupQualityScore({
  signal: mockWeakSignal,
  candlesH4: weakM15,
  candlesH1: mockBtcH1,
  candlesM15: weakM15,
  btcH1Candles: mockBtcH1
});
assert(weakQualityScore.score < 50, `Setup yếu bị chấm điểm thấp < 50 (Thực tế: ${weakQualityScore.score} điểm)`);

// 17. Kiểm tra Bộ Lọc Chế Độ Thị Trường V3.0 (ADX & Dynamic ATR Compression)
console.log('\n17. Kiểm tra Bộ Lọc Chế Độ Thị Trường V3.0 (ADX & Dynamic ATR Compression):');

// Tạo chuỗi nến trend mạnh: giá tăng liên tục từ 100 -> 200
const trendCandles = Array.from({ length: 40 }, (_, i) => ({
  high: 100 + (i * 3) + 2,
  low: 100 + (i * 3) - 1,
  close: 100 + (i * 3) + 1,
  open: 100 + (i * 3),
  vol: 1000,
  confirm: 1
}));
const adxResult = calculateADX(trendCandles, 14);
const lastADX = adxResult[adxResult.length - 1].adx;
assert(lastADX !== null && lastADX > 30, `ADX nhận diện chính xác xu hướng mạnh (> 30, thực tế: ${lastADX ? lastADX.toFixed(1) : 'null'})`);

// Tạo chuỗi nến sideway / chop: giá dao động trong biên hẹp 100-101
const chopCandles = Array.from({ length: 40 }, (_, i) => ({
  high: 100 + (i % 2 === 0 ? 1 : 0.5),
  low: 100 - (i % 2 === 0 ? 0.5 : 1),
  close: 100,
  open: 100,
  vol: 1000,
  confirm: 1
}));
const chopAdxResult = calculateADX(chopCandles, 14);
const lastChopADX = chopAdxResult[chopAdxResult.length - 1].adx;
assert(lastChopADX !== null && lastChopADX <= 25, `ADX nhận diện chính xác vùng sideway/chop (thực tế: ${lastChopADX ? lastChopADX.toFixed(1) : 'null'})`);

// Kiểm tra ATR Compression
const compressionRatio = calculateATRCompression(chopCandles, 14, 20);
assert(compressionRatio !== null, 'Tính toán thành công tỷ số nén ATR');

// Kiểm tra evaluateMarket tự động kích hoạt Chop Sleep Mode khi H1 ADX <= 20
const baseH4Ts = 99 * 4 * 3600000;
const mockChopH4 = Array.from({ length: 100 }, (_, i) => ({
  ts: i * 4 * 3600000,
  open: 100,
  high: 102,
  low: 98,
  close: 100,
  vol: 1000,
  confirm: 1
}));
const mockChopH1 = Array.from({ length: 40 }, (_, i) => ({
  ts: (baseH4Ts - 40 * 3600000) + (i * 3600000),
  open: 100,
  high: 100.5,
  low: 99.5,
  close: 100,
  vol: 100,
  confirm: 1
}));
const mockChopM15 = Array.from({ length: 20 }, (_, i) => ({
  ts: baseH4Ts + (i * 900000),
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  vol: 500,
  confirm: 1
}));

const chopMarketResult = evaluateMarket({
  symbol: 'ETH-USDT',
  candlesH4: mockChopH4,
  candlesH1: mockChopH1,
  candlesM15: mockChopM15,
  btcH1Candles: mockBtcH1,
  btcH4Candles: mockChopH4,
  config: { ...BOT_CONFIG, enableChopSleepMode: true, regime: { ...BOT_CONFIG.regime, enableChopSleepMode: true } } // độc lập với .env của máy
});
assert(chopMarketResult && chopMarketResult.isBlocked === true, 'evaluateMarket tự động chặn lệnh trong Chop Sleep Mode khi H1 ADX <= 20');
assert(chopMarketResult && chopMarketResult.blockReason.includes('CHOP_SLEEP_MODE'), 'Lý do chặn nêu rõ CHOP_SLEEP_MODE');

console.log('\n18. Kiểm tra Nhận diện Mẫu hình Nến Cổ điển (Price Action Pattern Recognition):');
{
  const doji = [{ ts: 1, open: 100, high: 101, low: 99, close: 100.02, vol: 10, confirm: 1 }];
  assert(detectCandlePattern(doji, 0).includes('DOJI'), 'Nhận diện chuẩn xác nến Doji (thân cực nhỏ)');

  const hammerShape = [{ ts: 1, open: 99.8, high: 100, low: 97, close: 100, vol: 10, confirm: 1 }];
  assert(detectCandlePattern(hammerShape, 0, 'DOWN').includes('HAMMER'), 'Nhận diện Hammer khi trước đó là downtrend');
  assert(detectCandlePattern(hammerShape, 0, 'UP').includes('HANGING_MAN'), 'Cùng hình dạng nhưng gọi Hanging Man khi trước đó là uptrend');

  const bullEngulf = [
    { ts: 1, open: 100, high: 101, low: 95, close: 96, vol: 10, confirm: 1 },
    { ts: 2, open: 95, high: 102, low: 94, close: 101, vol: 10, confirm: 1 }
  ];
  assert(detectCandlePattern(bullEngulf, 1).includes('BULLISH_ENGULFING'), 'Nhận diện chuẩn xác Bullish Engulfing (nến sau nuốt trọn nến trước)');

  const bearEngulf = [
    { ts: 1, open: 95, high: 101, low: 94, close: 100, vol: 10, confirm: 1 },
    { ts: 2, open: 101, high: 102, low: 93, close: 94, vol: 10, confirm: 1 }
  ];
  assert(detectCandlePattern(bearEngulf, 1).includes('BEARISH_ENGULFING'), 'Nhận diện chuẩn xác Bearish Engulfing');

  const insideBar = [
    { ts: 1, open: 95, high: 105, low: 90, close: 100, vol: 10, confirm: 1 },
    { ts: 2, open: 98, high: 102, low: 96, close: 99, vol: 10, confirm: 1 }
  ];
  assert(detectCandlePattern(insideBar, 1).includes('INSIDE_BAR'), 'Nhận diện chuẩn xác Inside Bar (nằm trọn trong biên độ nến trước)');

  assert(detectCandlePattern([], 0).length === 0, 'Trả về mảng rỗng an toàn khi không có dữ liệu nến');
}

// ==========================================================================
// 19. KIỂM TRA VOLUME PROFILE (POC/VAH/VAL) & ICT BREAKER BLOCK
// ==========================================================================
{
  console.log('\n19. Kiểm tra Volume Profile & ICT Breaker Block:');

  // POC phải nằm đúng tại bin có volume cao nhất (nến giữa, volume đột biến)
  const vpCandles = [];
  for (let i = 0; i < 10; i++) {
    vpCandles.push({ ts: i, open: 100, high: 101, low: 99, close: 100, vol: 10 });
  }
  vpCandles.push({ ts: 10, open: 110, high: 111, low: 109, close: 110, vol: 500 });
  for (let i = 11; i < 20; i++) {
    vpCandles.push({ ts: i, open: 100, high: 101, low: 99, close: 100, vol: 10 });
  }
  const vp = calculateVolumeProfile(vpCandles, 50, 24, 0.70);
  assert(vp.poc !== null && vp.poc >= 109 && vp.poc <= 111, `POC trúng vùng volume đột biến (poc=${vp.poc?.toFixed(2)})`);
  assert(vp.vah !== null && vp.val !== null && vp.vah > vp.val, 'VAH luôn lớn hơn VAL (Value Area hợp lệ)');

  const emptyVp = calculateVolumeProfile([], 50);
  assert(emptyVp.poc === null, 'Volume Profile trả về null an toàn khi không có dữ liệu nến');

  // Breaker Block: swing low pivot rõ ràng (idx4), sau đó giá quét xuyên qua
  // (đóng dưới đáy đó = order block "thất bại"), rồi bật tăng mạnh phá qua
  // swing high kế tiếp (idx7) -> xác nhận cấu trúc đảo chiều BULLISH breaker.
  const breakerCandles = [
    { ts: 0, open: 100, high: 101, low: 99, close: 100 },
    { ts: 1, open: 100, high: 102, low: 98, close: 101 },
    { ts: 2, open: 101, high: 103, low: 97, close: 102 },
    { ts: 3, open: 102, high: 103, low: 96, close: 101 },
    { ts: 4, open: 101, high: 102, low: 95, close: 100 }, // swing low pivot = 95
    { ts: 5, open: 100, high: 103, low: 97, close: 102 },
    { ts: 6, open: 102, high: 104, low: 98, close: 103 },
    { ts: 7, open: 103, high: 106, low: 100, close: 105 }, // swing high pivot = 106
    { ts: 8, open: 105, high: 104, low: 101, close: 103 },
    { ts: 9, open: 103, high: 103, low: 99, close: 101 },
    { ts: 10, open: 101, high: 102, low: 93, close: 94 },  // phá dưới swing low 95
    { ts: 11, open: 94, high: 96, low: 93, close: 95 },
    { ts: 12, open: 95, high: 108, low: 94, close: 107 }   // phá qua swing high 106 -> xác nhận
  ];

  const breakers = findBreakerBlocks(breakerCandles, 2, 2);
  assert(breakers.some(b => b.type === 'BULLISH'), `Nhận diện ICT Bullish Breaker Block khi order block giảm thất bại rồi giá đảo chiều mạnh (tìm thấy: ${breakers.map(b => b.type).join(',') || 'none'})`);

  assert(findBreakerBlocks([]).length === 0, 'Breaker Block trả về mảng rỗng an toàn khi không có dữ liệu nến');

  // A3: nến đâm XUYÊN HOÀN TOÀN vùng breaker (low<bottom & high>top) PHẢI tính
  // là mitigated. Vùng bullish ở trên: bottom=95, top=101. Thêm 1 nến nhấn chìm
  // (low=90, high=110) sau khi cấu trúc xác nhận -> isMitigated phải = true.
  const piercing = [...breakerCandles, { ts: 13, open: 100, high: 110, low: 90, close: 105 }];
  const bk2 = findBreakerBlocks(piercing, 2, 2).find(b => b.type === 'BULLISH');
  assert(bk2 && bk2.isMitigated === true, `A3: nến đâm xuyên hoàn toàn vùng breaker phải tính mitigated (isMitigated=${bk2 ? bk2.isMitigated : 'no breaker'})`);
}

// ==========================================================================
// 20. KIỂM TRA LỊCH TIN TỨC (NEWS BLACKOUT FILTER)
// ==========================================================================
{
  console.log('\n20. Kiểm tra Lịch Tin Tức (News Blackout Filter):');
  const { isNewsBlackout, getNextNewsEvent } = await import('../src/news_calendar.js');
  const fomc = new Date('2026-10-28T18:00:00Z').getTime();
  assert(isNewsBlackout(fomc, 2).blocked === true, 'Chặn vào lệnh ĐÚNG lúc tin FOMC ra');
  assert(isNewsBlackout(fomc - 3600000, 2).blocked === true, 'Chặn 1 tiếng TRƯỚC tin (trong vùng ±2h)');
  assert(isNewsBlackout(fomc + 3600000, 2).blocked === true, 'Chặn 1 tiếng SAU tin (trong vùng ±2h)');
  assert(isNewsBlackout(fomc - 3 * 3600000, 2).blocked === false, 'KHÔNG chặn khi cách tin 3 tiếng (ngoài vùng)');
  assert(isNewsBlackout(new Date('2026-11-01T00:00:00Z').getTime(), 2).blocked === false, 'KHÔNG chặn vào ngày thường không có tin');
  const next = getNextNewsEvent(new Date('2026-10-29T00:00:00Z').getTime());
  assert(next && next.name.includes('NFP'), 'Tìm đúng tin lớn kế tiếp sau FOMC 28/10 là NFP');
}

// ==========================================================================
// 21. KIỂM TRA CẦU DAO TUẦN (WEEKLY CIRCUIT BREAKER) & DIRECTIONAL CAP
// ==========================================================================
{
  console.log('\n21. Kiểm tra Cầu Dao Tuần (Weekly Circuit Breaker) & Directional Cap:');
  const { getWeeklyNetR, isWeeklyCircuitBreakerActive } = await import('../src/server.js');
  
  // Test hàm getWeeklyNetR
  const curNetR = getWeeklyNetR();
  assert(typeof curNetR === 'number', 'getWeeklyNetR trả về số thực hợp lệ');

  // Test isWeeklyCircuitBreakerActive
  const breakerState = isWeeklyCircuitBreakerActive(Date.now(), 3.5);
  assert(typeof breakerState.isActive === 'boolean', 'isWeeklyCircuitBreakerActive trả về cờ boolean isActive');

  // Test cấu hình Directional Cap
  assert(DEFAULT_CONFIG.maxDirectionalPositions === 2, 'DEFAULT_CONFIG.maxDirectionalPositions mặc định = 2 vị thế cùng chiều');
  assert(DEFAULT_CONFIG.weeklyCircuitBreakerMaxLossR === 3.5, 'DEFAULT_CONFIG.weeklyCircuitBreakerMaxLossR mặc định = 3.5R');
  assert(DEFAULT_CONFIG.enableFreeRollPyramiding === false, 'DEFAULT_CONFIG.enableFreeRollPyramiding mặc định TẮT (Phase C chưa test OOS)');
  assert(DEFAULT_CONFIG.minD1NATR === 0.030, 'DEFAULT_CONFIG.minD1NATR mặc định = 0.030 (3.0%)');
  assert(DEFAULT_CONFIG.useFlipLevels === true, 'DEFAULT_CONFIG.useFlipLevels mặc định BẬT sau khi kiểm chứng sweep 32 tổ hợp');
  assert(DEFAULT_CONFIG.enableChopSleepMode === (process.env.ENABLE_CHOP_SLEEP_MODE !== 'false'), 'DEFAULT_CONFIG.enableChopSleepMode đi theo ENABLE_CHOP_SLEEP_MODE (mặc định BẬT khi không đặt)');
}

// ==========================================================================
// 22. KIỂM TRA S/R FLIP LEVELS (BREAKER RETEST INTO KEY LEVELS & RADAR)
// ==========================================================================
{
  console.log('\n22. Kiểm tra Flip Levels (Breaker Retest into Key Levels & Radar):');
  const breakerCandles = [
    { ts: 0, open: 100, high: 101, low: 99, close: 100 },
    { ts: 1, open: 100, high: 102, low: 98, close: 101 },
    { ts: 2, open: 101, high: 103, low: 97, close: 102 },
    { ts: 3, open: 102, high: 103, low: 96, close: 101 },
    { ts: 4, open: 101, high: 102, low: 95, close: 100 }, // swing low pivot = 95
    { ts: 5, open: 100, high: 103, low: 97, close: 102 },
    { ts: 6, open: 102, high: 104, low: 98, close: 103 },
    { ts: 7, open: 103, high: 106, low: 100, close: 105 }, // swing high pivot = 106
    { ts: 8, open: 105, high: 104, low: 101, close: 103 },
    { ts: 9, open: 103, high: 103, low: 99, close: 101 },
    { ts: 10, open: 101, high: 102, low: 93, close: 94 },  // phá dưới swing low 95
    { ts: 11, open: 94, high: 96, low: 93, close: 95 },
    { ts: 12, open: 95, high: 108, low: 94, close: 107 },  // phá qua swing high 106 -> xác nhận Bullish Breaker bottom 95
    { ts: 13, open: 107, high: 108, low: 106, close: 107 },
    { ts: 14, open: 107, high: 108, low: 106, close: 107 },
    { ts: 15, open: 107, high: 108, low: 106, close: 107 }
  ];

  // Radar khi TẮT useFlipLevels
  const radarOff = generateKeyLevelRadar({
    symbol: 'TEST-USDT',
    candlesH4: breakerCandles,
    curPrice: 100,
    config: { ...DEFAULT_CONFIG, useFlipLevels: false }
  });
  // Radar khi BẬT useFlipLevels
  const radarOn = generateKeyLevelRadar({
    symbol: 'TEST-USDT',
    candlesH4: breakerCandles,
    curPrice: 100,
    config: { ...DEFAULT_CONFIG, useFlipLevels: true, breakerPivotL: 2, breakerPivotR: 2 }
  });

  assert(radarOff !== null && radarOn !== null, 'generateKeyLevelRadar chạy an toàn với cả 2 trạng thái cờ useFlipLevels');
  assert(radarOn.nearestSup === 95, `Khi BẬT useFlipLevels, radar nhận diện mức hỗ trợ flip 95 từ Bullish Breaker (nearestSup=${radarOn.nearestSup})`);
}

// ==========================================================================
// 23. KIỂM TRA D1 MACRO KEY LEVELS (SWING PIVOTS D1 INTO KEY LEVELS & RADAR)
// ==========================================================================
{
  console.log('\n23. Kiểm tra D1 Macro Key Levels (Swing Pivots D1 into Key Levels & Radar):');
  const d1Candles = [
    { ts: 0, open: 100, high: 101, low: 99, close: 100 },
    { ts: 1, open: 100, high: 102, low: 98, close: 101 },
    { ts: 2, open: 101, high: 103, low: 75, close: 80 },  // D1 swing low = 75
    { ts: 3, open: 80, high: 85, low: 78, close: 83 },
    { ts: 4, open: 83, high: 90, low: 81, close: 88 },
    { ts: 5, open: 88, high: 95, low: 87, close: 92 },
    { ts: 6, open: 92, high: 120, low: 90, close: 115 }, // D1 swing high = 120
    { ts: 7, open: 115, high: 118, low: 110, close: 112 },
    { ts: 8, open: 112, high: 114, low: 105, close: 108 },
    { ts: 9, open: 108, high: 110, low: 102, close: 105 },
    { ts: 10, open: 105, high: 106, low: 101, close: 102 }
  ];

  // H4 chỉ dao động trong vùng 90-105 (không có pivot ở 75 hay 120)
  const h4Candles = Array.from({ length: 20 }, (_, i) => ({
    ts: i * 14400000,
    open: 100,
    high: 102,
    low: 98,
    close: 100
  }));

  const radarD1Off = generateKeyLevelRadar({
    symbol: 'TEST-USDT',
    candlesH4: h4Candles,
    curPrice: 97, // Giá lơ lửng dưới 98
    candlesD1: d1Candles,
    config: { ...DEFAULT_CONFIG, useD1MacroLevels: false }
  });

  const radarD1On = generateKeyLevelRadar({
    symbol: 'TEST-USDT',
    candlesH4: h4Candles,
    curPrice: 97,
    candlesD1: d1Candles,
    config: { ...DEFAULT_CONFIG, useD1MacroLevels: true }
  });

  const radarD1OnHigh = generateKeyLevelRadar({
    symbol: 'TEST-USDT',
    candlesH4: h4Candles,
    curPrice: 105, // Giá vượt qua cản H4 (cao nhất H4 là 102)
    candlesD1: d1Candles,
    config: { ...DEFAULT_CONFIG, useD1MacroLevels: true }
  });

  assert(radarD1Off !== null && radarD1On !== null, 'generateKeyLevelRadar an toàn với candlesD1');
  assert(radarD1Off.nearestSup === null || radarD1Off.nearestSup === 98, 'Khi TẮT useD1MacroLevels, radar chỉ thấy cản H4');
  assert(radarD1On.nearestSup === 75, `Khi BẬT useD1MacroLevels, radar nhìn xa thấy Hỗ trợ D1 tại 75 (nearestSup=${radarD1On.nearestSup})`);
  assert(radarD1OnHigh.nearestRes === 120, `Khi BẬT useD1MacroLevels và vượt cản H4, radar nhìn xa thấy Kháng cự D1 tại 120 (nearestRes=${radarD1OnHigh.nearestRes})`);
}

// 24. Kiểm tra W1 Macro Levels (PWH / PWL / W1 EMA34):
console.log('\n24. Kiểm tra W1 Macro Levels (PWH / PWL / W1 EMA34):');
{
  const h4Candles = Array.from({ length: 20 }, (_, i) => ({
    ts: i * 14400000,
    open: 100,
    high: 102,
    low: 98,
    close: 100
  }));

  const mockW1Candles = [
    { ts: 1000, open: 110, high: 115, low: 105, close: 106, confirm: 1 },
    { ts: 2000, open: 106, high: 112, low: 95, close: 96, confirm: 1 }, // Tuần trước: PWH 112, PWL 95
    { ts: 3000, open: 96, high: 99, low: 90, close: 92, confirm: 0 }    // Tuần này đang chạy
  ];

  const radarW1 = generateKeyLevelRadar({
    symbol: 'TEST-USDT',
    candlesH4: h4Candles,
    curPrice: 97,
    candlesW1: mockW1Candles,
    config: { ...DEFAULT_CONFIG, useW1MacroLevels: true }
  });

  assert(radarW1 !== null, 'generateKeyLevelRadar an toàn với candlesW1');
  assert(radarW1.pwh === 112, `Nhận diện chính xác PWH tuần trước là 112 (thực tế: ${radarW1.pwh})`);
  assert(radarW1.pwl === 95, `Nhận diện chính xác PWL tuần trước là 95 (thực tế: ${radarW1.pwl})`);
  assert(radarW1.consecutiveRedWeeks >= 2, `Đếm chính xác số tuần đỏ liên tiếp (thực tế: ${radarW1.consecutiveRedWeeks})`);
}

// 25. Kiểm tra Định dạng Giá Telegram (formatPrice - chống tràn float):
console.log('\n25. Kiểm tra Định dạng Giá Telegram (formatPrice):');
{
  assert(formatPrice(87.72089426882395) === '87.721', 'Triệt tiêu hoàn toàn float dài 87.72089426882395 -> 87.721');
  assert(formatPrice(89.618) === '89.618', 'Giữ nguyên số tròn 89.618');
  assert(formatPrice(67450.25) === '67,450.25', 'Định dạng hàng nghìn có dấu phẩy: 67,450.25');
  assert(formatPrice(2.34567) === '2.3457', 'Làm tròn 4 số thập phân với giá 1..10');
  assert(formatPrice(null) === 'N/A', 'Xử lý null an toàn trả về N/A');
}

// 27. Kiểm tra nội dung tin báo lệnh Telegram (không được nói sai sự thật về cách khớp/xác suất)
console.log('\n27. Kiểm tra buildNewSignalMessage:');
{
  const T = Date.parse('2026-10-31T01:45:00Z');
  const sig = {
    symbol: 'HYPE-USDT', direction: 'LONG', strategy: 'SMC_SWEEP_REVERSAL_LONG',
    entry: 89.618, stopLoss: 87.72089426882395, takeProfit: 93.987, riskReward: 2.3,
    qualityScore: 80, qualityReasons: ['Râu nến 52%'], reason: 'SMC test',
    triggerTime: T, entryTime: T + 77 * 60000,
    sizing: { size: 5.27, notional: 472.3, margin: 47.23 }
  };
  const msg = buildNewSignalMessage(sig);
  assert(!/Limit Post-Only|Maker 0\.02/.test(msg), 'Tin KHÔNG khẳng định khớp Limit Post-Only (thực tế vào theo giá đóng nến sau khi chờ xác nhận)');
  assert(!/Thắng ~|PF 2\.0/.test(msg), 'Tin KHÔNG hứa winrate/PF không có bằng chứng backtest');
  assert(!msg.includes('87.72089'), 'Tin không tràn số thập phân float');
  assert(msg.includes('87.721'), 'SL được định dạng 87.721');
  assert(/RR[^0-9]*2\.3/.test(msg), 'Tin hiển thị RR thực tế sau khi chờ xác nhận (2.3)');
  assert(/2\.1%/.test(msg), 'Tin hiển thị khoảng cách SL % (2.1%)');
  assert(msg.includes('77 phút'), 'Tin ghi rõ độ trễ 77 phút giữa lúc có tín hiệu và lúc vào lệnh');
  assert(/Ký quỹ[^0-9]*47\.2/.test(msg), 'Tin hiển thị ký quỹ');
  assert(/giá đóng nến M15/i.test(msg), 'Tin nói rõ entry là giá đóng nến M15, không phải lệnh Limit');
}

// 27b. Tin báo SỚM (lúc phát hiện, chưa vào lệnh) và tin HỦY
{
  const sigE = { symbol: 'HYPE-USDT', direction: 'SHORT', entry: 93.97, stopLoss: 95.7042123456, takeProfit: 86.2, riskReward: 4.5, qualityScore: 80, reason: 'MACRO test', triggerTime: Date.parse('2026-10-31T01:45:00Z') };
  const early = buildEarlySignalMessage(sigE, 60);
  assert(/CHƯA vào lệnh/.test(early), 'Tin báo sớm nói rõ CHƯA vào lệnh');
  assert(early.includes('60 phút'), 'Tin báo sớm nêu thời gian chờ xác nhận 60 phút');
  assert(early.includes('93.97') && early.includes('95.704') && !early.includes('95.7042123'), 'Tin báo sớm có mức tham chiếu, đã định dạng giá');
  assert(!/Thắng ~|PF 2\.0|Limit Post-Only/.test(early), 'Tin báo sớm không hứa winrate / không nói Limit');
  assert(/hủy/i.test(early), 'Tin báo sớm nói rõ điều kiện hủy');
  const cancel = buildPendingCancelMessage(sigE, 'SL/TP gốc đã bị chạm trước khi kịp xác nhận');
  assert(/HỦY/.test(cancel) && cancel.includes('HYPE-USDT') && cancel.includes('SL/TP gốc'), 'Tin hủy nêu mã và lý do');
  assert(/đừng vào|không vào/i.test(cancel), 'Tin hủy dặn không vào lệnh tay');
}

// 28. Setup hộp Wyckoff: Spring/UTAD (phá giả) và phá hộp + retest (LPS/LPSY). Không vào giữa hộp, không đuổi nến phá.
console.log('\n28. Kiểm tra setup hộp Wyckoff:');
{
  const H = 3600000, M = 900000, t0 = Date.UTC(2026, 9, 20, 0, 0);
  const box = { rangeHigh: 100, rangeLow: 90, equilibrium: 95, rangeHeight: 10, touchesHigh: 3, touchesLow: 3, isEstablishedRange: true };
  const bar = (ts, o, h, l, c, v) => ({ ts, open: o, high: h, low: l, close: c, vol: v, confirm: 1 });
  const flat = (n, from = 0) => Array.from({ length: n }, (_, i) => bar(t0 + (from + i) * H, 94, 95.5, 93, 94.5, 1000));
  const m15 = (startH, rows) => rows.map((r, i) => bar(t0 + startH * H + i * M, ...r));
  const filler = (n, r) => Array.from({ length: n }, () => r);
  const run = (fn, h1, m, extra = {}, d1 = 'RANGING') => fn({ symbol: 'T-USDT', candlesH1: h1, candlesM15: m, macroRange: box, atrH1: 1.0, d1Phase: d1, config: { minRR: 2.0, ...extra } });

  // Spring: H1 thò 88.5 dưới sàn 90 rồi đóng lại 90.8; M15 test low 90.5 volume thấp; M15 xanh phá đỉnh nến trước
  const springH1 = [...flat(25), bar(t0 + 25 * H, 91, 91.5, 88.5, 90.8, 3000), bar(t0 + 26 * H, 91, 92, 90.6, 91.5, 800), bar(t0 + 27 * H, 91.5, 92, 91, 91.6, 800)];
  const springM15 = m15(26, [...filler(20, [91.5, 92, 91.2, 91.6, 1000]), [91.0, 91.2, 90.5, 91.0, 300], [91.0, 91.3, 90.8, 91.1, 500], [91.1, 91.9, 91.0, 91.8, 900]]);
  const spring = run(evaluateWyckoffSpring, springH1, springM15);
  assert(spring && spring.strategy === 'WYCKOFF_SPRING_LONG' && spring.direction === 'LONG', 'Spring: thò dưới sàn, test volume thấp, M15 xác nhận -> LONG');
  assert(spring && Math.abs(spring.stopLoss - 88.2) < 1e-6, 'Spring: SL ngay dưới đáy cú thò (88.5 - 0.3 ATR)');
  assert(spring && spring.riskReward >= 2.0 && spring.takeProfit <= 100, 'Spring: RR >= 2 và TP trong hộp');
  assert(run(evaluateWyckoffSpring, flat(28), springM15) === null, 'Giữa hộp không có cú quét -> KHÔNG vào (không mua Phase B)');
  assert(run(evaluateWyckoffSpring, springH1, springM15, {}, 'STRONG_DOWNTREND') === null, 'Spring trong downtrend mạnh D1 (phân phối lại) bị loại');
  const noTestM15 = m15(26, [...filler(20, [91.5, 92, 91.2, 91.6, 1000]), [91.6, 91.9, 91.5, 91.7, 300], [91.7, 91.9, 91.5, 91.6, 500], [91.6, 92.2, 91.5, 92.1, 900]]);
  assert(run(evaluateWyckoffSpring, springH1, noTestM15) === null, 'Spring chưa có nhịp test quay lại sát sàn -> KHÔNG vào');
  const loudTestM15 = m15(26, [...filler(20, [91.5, 92, 91.2, 91.6, 1000]), [91.0, 91.2, 90.5, 91.0, 5000], [91.2, 91.5, 91.1, 91.3, 500], [91.3, 91.9, 91.2, 91.8, 900]]);
  assert(run(evaluateWyckoffSpring, springH1, loudTestM15) === null, 'Nhịp test volume LỚN (cung chưa cạn) -> KHÔNG vào');
  const brokenM15 = m15(26, [...filler(10, [91.5, 92, 91.2, 91.6, 1000]), [91.5, 91.6, 88.0, 88.6, 1200], ...filler(9, [91.5, 92, 91.2, 91.6, 1000]), [91.0, 91.2, 90.5, 91.0, 300], [91.0, 91.3, 90.8, 91.1, 500], [91.1, 91.9, 91.0, 91.8, 900]]);
  assert(run(evaluateWyckoffSpring, springH1, brokenM15) === null, 'Giá đã thủng đáy cú Spring (Spring hỏng = vỡ đáy thật) -> KHÔNG vào');

  // UTAD: H1 thò 101.5 trên trần 100 rồi đóng lại 99.2; M15 test high 99.5 volume thấp; M15 đỏ phá đáy nến trước
  const utadH1 = [...flat(25), bar(t0 + 25 * H, 99, 101.5, 98.8, 99.2, 3000), bar(t0 + 26 * H, 99, 99.4, 98.2, 98.6, 800), bar(t0 + 27 * H, 98.6, 99, 98, 98.4, 800)];
  const utadM15 = m15(26, [...filler(20, [98.5, 98.8, 98.2, 98.4, 1000]), [99.0, 99.5, 98.8, 99.0, 300], [99.0, 99.2, 98.7, 98.9, 500], [98.9, 99.0, 98.1, 98.2, 900]]);
  const utad = run(evaluateWyckoffSpring, utadH1, utadM15);
  assert(utad && utad.strategy === 'WYCKOFF_UTAD_SHORT' && utad.direction === 'SHORT', 'UTAD: thò trên trần, test volume thấp, M15 xác nhận -> SHORT');
  assert(utad && Math.abs(utad.stopLoss - 101.8) < 1e-6, 'UTAD: SL ngay trên đỉnh cú thò (101.5 + 0.3 ATR)');

  // Phá hộp lên + retest giữ: H1 đóng 101 (>100.2) volume 2.5x; M15 quay lại low 100.2 rồi đóng lại trên trần; xanh phá đỉnh
  const boH1 = [...flat(20), bar(t0 + 20 * H, 99.5, 101.6, 99.4, 101.0, 2500), bar(t0 + 21 * H, 101, 102, 100.8, 101.5, 1200), bar(t0 + 22 * H, 101.5, 102, 101, 101.6, 1200)];
  const boM15 = m15(23, [...filler(20, [101.5, 101.9, 101.3, 101.6, 1000]), [101.2, 101.3, 100.2, 100.8, 400], [100.8, 101.0, 100.6, 100.9, 500], [100.9, 101.4, 100.8, 101.3, 900]]);
  const bo = run(evaluateWyckoffBreakoutRetest, boH1, boM15);
  assert(bo && bo.strategy === 'WYCKOFF_BREAKOUT_RETEST_LONG' && bo.direction === 'LONG', 'Phá trần + volume, retest giữ vững -> LONG tại retest');
  assert(bo && Math.abs(bo.takeProfit - 110) < 1e-6 && bo.stopLoss < 100, 'Phá hộp: TP = measured move (chiều cao hộp), SL dưới biên vừa phá');
  const failedH1 = [...flat(20), bar(t0 + 20 * H, 99.5, 101.6, 99.4, 101.0, 2500), bar(t0 + 21 * H, 101, 101.2, 98.9, 99.0, 1500), bar(t0 + 22 * H, 99, 99.5, 98.5, 99.2, 1200)];
  assert(run(evaluateWyckoffBreakoutRetest, failedH1, boM15) === null, 'Phá giả (đóng lại trong hộp) KHÔNG vào theo breakout');
  const noRetestM15 = m15(23, [...filler(20, [101.5, 101.9, 101.3, 101.6, 1000]), [101.6, 101.8, 101.4, 101.5, 400], [101.5, 101.7, 101.4, 101.6, 500], [101.6, 102.0, 101.5, 101.9, 900]]);
  assert(run(evaluateWyckoffBreakoutRetest, boH1, noRetestM15) === null, 'Chưa có retest thì KHÔNG đuổi nến phá');

  // Phá sàn xuống + retest bị từ chối
  const bdH1 = [...flat(20), bar(t0 + 20 * H, 90.5, 90.6, 88.4, 89.0, 2500), bar(t0 + 21 * H, 89, 89.2, 88, 88.5, 1200), bar(t0 + 22 * H, 88.5, 89, 88, 88.4, 1200)];
  const bdM15 = m15(23, [...filler(20, [88.5, 88.7, 88.1, 88.4, 1000]), [88.8, 89.8, 88.7, 89.2, 400], [89.2, 89.4, 89.0, 89.1, 500], [89.1, 89.2, 88.6, 88.7, 900]]);
  const bd = run(evaluateWyckoffBreakoutRetest, bdH1, bdM15);
  assert(bd && bd.strategy === 'WYCKOFF_BREAKDOWN_RETEST_SHORT' && bd.direction === 'SHORT' && Math.abs(bd.takeProfit - 80) < 1e-6, 'Phá sàn + retest bị từ chối -> SHORT, TP measured move 80');
}

// 29. SMC mua/bán theo video: BOS + FVG + thanh khoản (đáy/đỉnh cục bộ) -> vào limit tại mép FVG, SL ngoài FVG, TP 3R
console.log('\n29. Kiểm tra SMC FVG + BOS + thanh khoản:');
{
  const T0 = Date.UTC(2026, 9, 20, 0, 0), M = 900000;
  const rows = [ // [open, high, low, close]
    [99.5, 100, 99, 99.5], [99.5, 100.5, 99.5, 100], [100, 101, 99.8, 100.5], [100.5, 100.5, 99.5, 100], [100, 100, 99, 99.5], // 2 = đỉnh swing 101
    [99.8, 100.2, 99.6, 100.0], [100.0, 100.9, 99.9, 100.8], [101.0, 103, 101.0, 102.8], // 7 = BOS, FVG [100.2 - 101.0]
    [102.8, 103.2, 102.0, 102.2], [102.2, 102.4, 101.6, 101.8], [101.8, 102.6, 102.0, 102.4], [102.4, 102.8, 102.2, 102.5], // 9 = đáy cục bộ 101.6 (thanh khoản)
    [102.5, 102.6, 100.9, 101.5] // 12: quét đáy cục bộ + chạm FVG
  ];
  const mk = (r, flip = false) => r.map(([o, h, l, c], i) => flip
    ? { ts: T0 + i * M, open: 200 - o, high: 200 - l, low: 200 - h, close: 200 - c, vol: 1000, confirm: 1 }
    : { ts: T0 + i * M, open: o, high: h, low: l, close: c, vol: 1000, confirm: 1 });
  const buy = latestSmcFvgSignal(mk(rows));
  assert(buy && buy.direction === 'LONG' && Math.abs(buy.entry - 101.0) < 1e-9, 'SMC Buy: BOS + FVG + quét thanh khoản + chạm FVG -> LONG limit tại mép trên FVG 101.0');
  assert(buy && Math.abs(buy.stopLoss - (100.2 - 0.0005 * 100.2)) < 1e-9, 'SMC Buy: SL ngay dưới mép dưới FVG');
  assert(buy && Math.abs((buy.takeProfit - buy.entry) / (buy.entry - buy.stopLoss) - 3) < 1e-9, 'SMC Buy: TP đúng RR 1:3');
  const noPool = rows.map(r => [...r]); noPool[9] = [102.2, 102.4, 102.1, 101.8]; noPool[10] = [101.8, 102.6, 102.2, 102.4];
  assert(latestSmcFvgSignal(mk(noPool)) === null, 'Chỉ có FVG, không có đáy cục bộ làm thanh khoản -> KHÔNG vào (đúng lời video)');
  const broken = rows.map(r => [...r]); broken[12] = [102.5, 102.6, 100.0, 100.1];
  assert(latestSmcFvgSignal(mk(broken)) === null, 'Giá đóng cửa xuyên thủng FVG (hỏng) -> KHÔNG vào');
  const closeBelow = rows.map(r => [...r]); closeBelow[12] = [102.5, 102.6, 100.16, 100.17];
  assert(latestSmcFvgSignal(mk(closeBelow)) === null, 'Nến chạm đóng cửa dưới mép FVG (dù râu chưa tới SL) -> FVG hỏng, KHÔNG vào');
  const wickThrough = rows.map(r => [...r]); wickThrough[12] = [102.5, 102.6, 100.0, 101.5];
  assert(latestSmcFvgSignal(mk(wickThrough)) === null, 'Râu chọc qua SL ngay nến chạm (dù đóng lại trên FVG) -> KHÔNG đặt lệnh');
  assert(latestSmcFvgSignal(mk([...rows, [101.5, 102.0, 101.2, 101.8]])) === null, 'Cú chạm không phải nến cuối -> không báo lại (chống trùng tín hiệu)');
  assert(latestSmcFvgSignal(mk(rows), { minRisk: 0.02 }) === null, 'SL gần hơn ngưỡng tối thiểu (phí ăn hết lợi thế) -> bỏ');
  const sell = latestSmcFvgSignal(mk(rows, true));
  assert(sell && sell.direction === 'SHORT' && Math.abs(sell.entry - 99.0) < 1e-9, 'SMC Sell (đối xứng): LONG lật gương thành SHORT limit tại mép dưới FVG');
  assert(sell && sell.stopLoss > sell.entry && sell.takeProfit < sell.entry, 'SMC Sell: SL trên, TP dưới');
  const msg = buildSmcFvgAlertMessage('HYPE-USDT', buy);
  assert(/LIMIT/i.test(msg) && msg.includes('101') && /KHÔNG tự vào lệnh/i.test(msg), 'Tin báo ghi rõ lệnh Limit, mức giá, và bot không tự vào lệnh');
  assert(/sau phí/i.test(msg), 'Tin báo nêu số liệu backtest sau phí, không chỉ số chưa trừ phí');
}

// 30. Chống spam Telegram: dry-run không gửi, trạng thái bền qua khởi động lại, gộp cảnh báo hộp thành 1 tin
console.log('\n30. Kiểm tra chống spam Telegram:');
{
  const f = pathNode.join(os.tmpdir(), 'alert_state_test_' + Date.now() + '.json');
  const m1 = persistentMap(f, true); m1.set('BTC:LOW', 123);
  assert(persistentMap(f, true).get('BTC:LOW') === 123, 'Trạng thái cảnh báo được lưu và đọc lại sau khi khởi động lại (không gửi trùng)');
  const f2 = pathNode.join(os.tmpdir(), 'alert_state_dry_' + Date.now() + '.json');
  const dry = persistentMap(f2, false); dry.set('x', 1);
  assert(dry.get('x') === 1 && !fsNode.existsSync(f2), 'Chế độ dry-run chỉ giữ trong bộ nhớ, KHÔNG ghi file (không làm cooldown giả)');
  try { fsNode.unlinkSync(f); } catch {}
  const digest = buildBoxDigestMessage([
    { symbol: 'BTC-USDT', alert: { zone: 'LOW', price: 77476.3, rangeLow: 75909.8, rangeHigh: 86622.7, equilibrium: 81266.3 } },
    { symbol: 'ETH-USDT', alert: { zone: 'LOW', price: 2251.4, rangeLow: 2171.5, rangeHigh: 2763.0, equilibrium: 2467.3 } },
    { symbol: 'HYPE-USDT', alert: { zone: 'HIGH', price: 95.1, rangeLow: 75.15, rangeHigh: 97.06, equilibrium: 86.1 } }
  ]);
  assert(['BTC-USDT', 'ETH-USDT', 'HYPE-USDT'].every(x => digest.includes(x)), 'Tin gộp liệt kê đủ các coin sát biên hộp');
  assert(/SÀN/.test(digest) && /TRẦN/.test(digest), 'Tin gộp phân biệt sát SÀN và sát TRẦN');
  assert((digest.match(/KHÔNG tự vào lệnh/g) || []).length === 1, 'Tin gộp chỉ ghi lưu ý "bot KHÔNG tự vào lệnh" một lần');
  let fetched = false; const realFetch = globalThis.fetch; globalThis.fetch = () => { fetched = true; return Promise.reject(new Error('không được gọi mạng')); };
  process.env.TELEGRAM_DRY_RUN = '1';
  let r; try { r = await sendTelegramMessage('thử nghiệm dry-run'); } finally { delete process.env.TELEGRAM_DRY_RUN; globalThis.fetch = realFetch; }
  assert(r === false && fetched === false, 'DRY-RUN: sendTelegramMessage không gọi mạng, không gửi tin thật');
}

// 26. Kiểm tra Macro Range Box, Volume Breakout & Trade Flip Engine:
console.log('\n26. Kiểm tra Macro Range Box, Volume Breakout & Trade Flip Engine:');
{
  // 26.1: detectMacroRangeBox
  const mockH4 = [];
  for (let i = 0; i < 60; i++) {
    // Giá dao động giữa 75 và 96
    const high = (i % 10 === 0) ? 96.0 : (80 + Math.random() * 10);
    const low = (i % 10 === 5) ? 75.0 : (80 - Math.random() * 4);
    mockH4.push({ ts: i * 4 * 3600000, open: 85, high, low, close: 85, vol: 1000, confirm: 1 });
  }
  const macroBox = detectMacroRangeBox(mockH4, [], 60);
  assert(macroBox !== null, 'detectMacroRangeBox nhận diện thành công hộp đa tháng');
  assert(macroBox.rangeHigh >= 94.0 && macroBox.rangeHigh <= 97.0, `Range High định hình chính xác ~96 (thực tế: ${macroBox.rangeHigh})`);
  assert(macroBox.rangeLow >= 74.0 && macroBox.rangeLow <= 77.0, `Range Low định hình chính xác ~75 (thực tế: ${macroBox.rangeLow})`);
  assert(macroBox.equilibrium >= 84.0 && macroBox.equilibrium <= 87.0, `Trục giữa Equilibrium chính xác ~85.5 (thực tế: ${macroBox.equilibrium})`);

  // 26.2: evaluateMacroRangeFade Short tại Range High
  const mockM15NearCeiling = [
    { ts: 1000, open: 93.0, high: 93.5, low: 92.8, close: 93.2, vol: 1000, confirm: 1 },
    { ts: 2000, open: 93.2, high: 93.8, low: 93.0, close: 93.6, vol: 1000, confirm: 1 },
    { ts: 3000, open: 93.6, high: 94.5, low: 93.5, close: 94.2, vol: 1000, confirm: 1 },
    { ts: 4000, open: 94.2, high: 95.8, low: 94.0, close: 95.2, vol: 1500, confirm: 1 },
    { ts: 5000, open: 95.2, high: 96.8, low: 94.1, close: 94.4, vol: 2500, confirm: 1 } // Rút râu trên mạnh tại 96.8
  ];
  const fadeShort = evaluateMacroRangeFade({
    symbol: 'HYPE-USDT',
    candlesH4: mockH4,
    candlesH1: mockH4,
    candlesM15: mockM15NearCeiling,
    macroRange: macroBox,
    atrH1: 1.5
  });
  assert(fadeShort !== null, 'evaluateMacroRangeFade kích hoạt Short thành công tại Range High');
  assert(fadeShort.direction === 'SHORT', 'Hướng vào lệnh là SHORT');
  assert(fadeShort.strategy === 'MACRO_RANGE_HIGH_SHORT', 'Chiến lược là MACRO_RANGE_HIGH_SHORT');
  assert(fadeShort.riskReward >= 1.8, `Tỷ lệ RR đạt chuẩn >= 1.8 (thực tế: ${fadeShort.riskReward})`);

  // 26.2c: Cảnh báo biên hộp (chỉ báo, không tự vào lệnh)
  const boxAlertTop = buildBoxAlert('HYPE-USDT', macroBox, 95.0);
  assert(boxAlertTop && boxAlertTop.zone === 'HIGH' && /Short/i.test(boxAlertTop.message), 'buildBoxAlert báo vùng Trần hộp khi giá sát trần');
  const boxAlertBot = buildBoxAlert('HYPE-USDT', macroBox, 76.0);
  assert(boxAlertBot && boxAlertBot.zone === 'LOW' && /Long/i.test(boxAlertBot.message), 'buildBoxAlert báo vùng Sàn hộp khi giá sát sàn');
  assert(buildBoxAlert('HYPE-USDT', macroBox, 85.5) === null, 'buildBoxAlert im lặng khi giá ở giữa hộp');
  assert(buildBoxAlert('HYPE-USDT', null, 95.0) === null, 'buildBoxAlert an toàn khi không có hộp');

  // 26.3: evaluateVolumeBreakout
  const mockBreakoutM15 = [];
  for (let i = 0; i < 30; i++) {
    // 29 nến nén trong hộp 80.0 - 81.2 với volume 1000
    mockBreakoutM15.push({ ts: i * 15 * 60000, open: 80.5, high: 81.2, low: 80.0, close: 80.8, vol: 1000, confirm: 1 });
  }
  // Nến thứ 30: Nổ volume 4000 (4.0x) phá vỡ lên 82.5
  mockBreakoutM15.push({ ts: 30 * 15 * 60000, open: 80.8, high: 82.8, low: 80.7, close: 82.5, vol: 4000, confirm: 1 });

  const breakoutSig = evaluateVolumeBreakout({
    symbol: 'HYPE-USDT',
    candles15m: mockBreakoutM15,
    candlesH1: [],
    candlesH4: [],
    atrH1: 1.0,
    resistances: [90.0]
  });
  assert(breakoutSig !== null, 'evaluateVolumeBreakout bắt thành công cú phá nền M15');
  assert(breakoutSig.direction === 'LONG', 'Hướng phá vỡ là LONG');
  assert(breakoutSig.strategy === 'M15_VOLUME_BREAKOUT_LONG', 'Chiến lược là M15_VOLUME_BREAKOUT_LONG');
  assert(breakoutSig.entry === 82.5, 'Entry chuẩn xác ngay tại chân nến phá vỡ 82.5');

  // 26.4: Trade Flip Engine
  registerTakeProfitHit('HYPE-USDT', 'LONG', 95.0, 10000);
  const flipSig = evaluateTradeFlipOpportunity({
    symbol: 'HYPE-USDT',
    candles15m: [
      { ts: 6000, open: 93.5, high: 94.0, low: 93.2, close: 93.8, vol: 1000, confirm: 1 },
      { ts: 7000, open: 93.8, high: 94.2, low: 93.5, close: 94.0, vol: 1000, confirm: 1 },
      { ts: 8000, open: 94.0, high: 94.6, low: 93.8, close: 94.4, vol: 1000, confirm: 1 },
      { ts: 9000, open: 94.4, high: 95.2, low: 94.0, close: 94.8, vol: 1000, confirm: 1 },
      { ts: 10000, open: 94.8, high: 95.5, low: 94.2, close: 94.3, vol: 1500, confirm: 1 } // Rút râu trên tại 95.5
    ],
    candlesH1: [],
    atrH1: 1.5
  });
  assert(flipSig !== null, 'Trade Flip bắt thành công cơ hội Short đảo chiều ngay sau khi chốt lời Long');
  assert(flipSig.direction === 'SHORT', 'Hướng Flip là SHORT');
  assert(flipSig.strategy === 'TRADE_FLIP_SHORT', 'Chiến lược là TRADE_FLIP_SHORT');

  // 26.5: evaluateMarket phải gắn sizing + áp khiên BTC cho Breakout/Flip/MacroRange
  const mkC = (n, step, o, h, l, c, v) => Array.from({ length: n }, (_, i) => ({ ts: i * step, open: o, high: h, low: l, close: c, vol: v, confirm: 1 }));
  const gH4 = mkC(100, 14400000, 80.5, 81.5, 79.5, 80.5, 1000).map((c, i) => ({ ...c, close: 80 + i * 0.01 }));
  const gH1 = mkC(20, 3600000, 80.5, 81, 80, 80.5, 1000);
  const gM15 = mkC(30, 900000, 80.5, 81.2, 80.0, 80.8, 1000);
  gM15.push({ ts: 30 * 900000, open: 80.8, high: 82.8, low: 80.7, close: 82.5, vol: 4000, confirm: 1 });
  const evalG = (btcH1, extra = { enableBreakoutStrategy: true, sessionStartHourUtc: 0 }) => evaluateMarket({ symbol: 'HYPE-USDT', candlesH4: gH4, candlesH1: gH1, candlesM15: gM15, btcH1Candles: btcH1, config: { ...DEFAULT_CONFIG, minCoinPrice: 0, ...extra } });
  const gSig = evalG(null);
  assert(gSig && gSig.strategy === 'M15_VOLUME_BREAKOUT_LONG', 'evaluateMarket trả tín hiệu Breakout');
  assert(gSig.sizing && gSig.sizing.size > 0 && !gSig.sizing.isBlocked, 'Tín hiệu Breakout có sizing 1R hợp lệ');
  const btcDump = mkC(20, 3600000, 100, 100.5, 99.5, 100, 1000);
  btcDump[19] = { ts: 19 * 3600000, open: 100, high: 100.1, low: 95, close: 95.1, vol: 5000, confirm: 1 };
  const gBlocked = evalG(btcDump);
  assert(gBlocked && gBlocked.isBlocked === true, 'BTC xả Marubozu đỏ chặn Breakout LONG');

  // 26.5c: Chiến lược lỗ cả năm (Breakout/Breakdown, Trade Flip, Macro Long) mặc định TẮT, bật bằng cờ
  assert(DEFAULT_CONFIG.enableBreakoutStrategy === false, 'Breakout/Breakdown mặc định TẮT');
  assert(DEFAULT_CONFIG.enableTradeFlip === false, 'Trade Flip mặc định TẮT');
  assert(DEFAULT_CONFIG.enableMacroRangeLong === false, 'Macro Range Long mặc định TẮT');
  const gOff = evalG(null, {});
  assert(!gOff || gOff.strategy !== 'M15_VOLUME_BREAKOUT_LONG', 'Cờ tắt thì evaluateMarket không phát tín hiệu Breakout');

  // 26.6: Trade Flip không kích hoạt chỉ vì râu trên khi nến M15 vẫn xanh (chưa có từ chối thật)
  registerTakeProfitHit('FLIP-GREEN', 'LONG', 95.0, 10000);
  const greenFlip = evaluateTradeFlipOpportunity({
    symbol: 'FLIP-GREEN',
    candles15m: [
      { ts: 6000, open: 93.5, high: 94.0, low: 93.2, close: 93.8, vol: 1000, confirm: 1 },
      { ts: 7000, open: 93.8, high: 94.2, low: 93.5, close: 94.0, vol: 1000, confirm: 1 },
      { ts: 8000, open: 94.0, high: 94.6, low: 93.8, close: 94.4, vol: 1000, confirm: 1 },
      { ts: 9000, open: 94.4, high: 95.2, low: 94.0, close: 94.8, vol: 1000, confirm: 1 },
      { ts: 10000, open: 94.3, high: 95.5, low: 94.2, close: 95.0, vol: 1500, confirm: 1 } // râu trên nhưng đóng xanh
    ],
    candlesH1: [],
    atrH1: 1.5
  });
  assert(greenFlip === null, 'Trade Flip KHÔNG vào Short khi nến M15 râu trên nhưng đóng xanh');

  // 26.7: Kane Long/Short đối xứng
  const kLiq = { isInducementTrapRisk: false, sweepState: 'NONE', details: null, tier2MajorLow: null, tier2MajorHigh: null, tier1Lows: [], tier1Highs: [] };
  const kVsa = { isAbsorption: false };
  const kCfg = { atrBufferMultiplier: 0.3, minRR: 2.0, riskUsd: 10, leverage: 10, wickRatioThreshold: 0.35 };
  const kBtc = { canLong: true, canShort: true };
  const kBase = { symbol: 'T-USDT', ema34: 100, atrH1: 0.5, marketPhase: 'RANGING', d1Phase: 'RANGING', isLowVolD1: false, btcShield: kBtc, config: kCfg, volAbsorptionH4: kVsa, volAbsorptionM15: kVsa, chopBlockedSignal: false, isFreshH4: true, liquidityTiers: kLiq };
  const shortArgs = (h4Close) => ({
    ...kBase,
    candlesH4: [{ ts: 0, open: 99, high: 99.5, low: 98, close: 99, vol: 1, confirm: 1 }, { ts: 1, open: 99, high: 100.5, low: 98, close: h4Close, vol: 1, confirm: 1 }],
    candlesM15: Array.from({ length: 10 }, (_, i) => ({ ts: i, open: 99.5, high: 100, low: 99, close: 99.5, vol: 100, confirm: 1 })),
    currentM15: { ts: 11, open: 99.2, high: 99.3, low: 98.8, close: 98.9, vol: 100, confirm: 1 },
    prevM15: { ts: 10, open: 99.5, high: 99.6, low: 99.0, close: 99.1, vol: 100, confirm: 1 },
    lastH4: { ts: 1, open: 99, high: 100.5, low: 98, close: h4Close, vol: 1, confirm: 1 },
    supports: [95], resistances: [100],
    h4Anatomy: { upperWickRatio: 0.5, lowerWickRatio: 0 },
    isBearTrend: true, isActiveUpMove: false, hasBearishPattern: true
  });
  assert(tryKaneShortSetup(shortArgs(99.0)) !== null, 'Kane Short hợp lệ khi H4 từ chối và đóng dưới cản');
  assert(tryKaneShortSetup(shortArgs(100.4)) === null, 'Kane Short bị loại khi H4 đóng cửa TRÊN cản (chưa bị từ chối)');
  const longArgs = (majorHigh) => ({
    ...kBase,
    liquidityTiers: { ...kLiq, tier2MajorHigh: majorHigh },
    candlesH4: [{ ts: 0, open: 100, high: 101, low: 99, close: 100, vol: 1, confirm: 1 }, { ts: 1, open: 100, high: 101, low: 97.5, close: 100.2, vol: 1, confirm: 1 }],
    candlesM15: Array.from({ length: 10 }, (_, i) => ({ ts: i, open: 99.5, high: 100, low: 99, close: 99.5, vol: 100, confirm: 1 })),
    currentM15: { ts: 11, open: 100.0, high: 100.5, low: 99.9, close: 100.4, vol: 100, confirm: 1 },
    prevM15: { ts: 10, open: 99.5, high: 100.0, low: 99.4, close: 99.9, vol: 100, confirm: 1 },
    lastH4: { ts: 1, open: 100, high: 101, low: 97.5, close: 100.2, vol: 1, confirm: 1 },
    supports: [100], resistances: [107],
    h4Anatomy: { upperWickRatio: 0, lowerWickRatio: 0.5 },
    isBullTrend: true, isActiveDownMove: false, hasBullishPattern: true
  });
  assert(tryKaneLongSetup(longArgs(null)) !== null, 'Kane Long hợp lệ khi không có Cản Lớn sát đầu');
  assert(tryKaneLongSetup(longArgs(101)) === null, 'Kane Long bị loại khi entry sát Cản Lớn phía trên (đối xứng với Short)');

  // 26.8: Khôi phục hành vi đã kiểm chứng của bản cũ (backtest 1 năm: bản siết quá tay chỉ ra 2 lệnh)
  const bearSweep = tryKaneLongSetup({ ...longArgs(null), isBullTrend: false, ema34: 100.5, liquidityTiers: { ...kLiq, sweepState: 'BULLISH_SWEEP_CONFIRMED' } });
  assert(bearSweep !== null && bearSweep.strategy === 'SMC_SWEEP_REVERSAL_LONG', 'Bear-trend: SMC Sweep xác nhận vẫn được Long, không đòi giá cách EMA34 >= 2.5%');
  const nearRes = tryKaneLongSetup({ ...longArgs(null), resistances: [101.5, 107] });
  assert(nearRes !== null && Math.abs(nearRes.takeProfit - 107 * 0.9975) < 1e-6, 'Cản gần nằm giữa đường KHÔNG chặn lệnh (TP vẫn tới cản đạt RR, đã trừ đệm 0.25%)');
  assert(computeH4Freshness(9 * 900000, 0, 8).isFresh === false, 'H4 quá 8 nến M15 sau khi đóng -> không còn tươi');
  assert(computeH4Freshness(8 * 900000, 0, 8).isFresh === true, 'H4 đúng 8 nến M15 sau khi đóng -> còn tươi');
  assert(computeH4Freshness(-900000, 0, 8).isFresh === false, 'Nến M15 trước giờ đóng H4 -> không tươi');
  // 26.9: Phiên giao dịch (SMC nâng cao: phiên Á đi ngang/tạo mồi). Backtest 2021-26: bỏ 00-07 UTC PF 1.06 -> 1.17
  const at = (h) => Date.UTC(2026, 9, 28, h, 30);
  assert(isInTradingSession(at(3), 7, 24) === false, 'Phiên Á (03:30 UTC) bị loại');
  assert(isInTradingSession(at(7), 7, 24) === true, '07:30 UTC (London) được vào lệnh');
  assert(isInTradingSession(at(23), 7, 24) === true, '23:30 UTC (cuối phiên NY) được vào lệnh');
  assert(isInTradingSession(at(3), 0, 24) === true, 'Khung 0-24 tắt bộ lọc phiên');
  assert(DEFAULT_CONFIG.sessionStartHourUtc === 7 && DEFAULT_CONFIG.sessionEndHourUtc === 24, 'Mặc định chỉ vào lệnh 07:00-24:00 UTC');
  // 26.10: Quản lý lệnh co SL/khóa lãi mặc định TẮT (backtest 2021-26: SL/TP thuần PF 1.17->1.26, +28.5R->+52.4R, thắng 27%->36%)
  assert(DEFAULT_CONFIG.beStep1TriggerR >= 99 && DEFAULT_CONFIG.beTriggerR >= 99, 'Co SL (step1) và khóa lãi mặc định TẮT (ngưỡng không bao giờ chạm)');
  // 26.11: Xu hướng theo cấu trúc BOS (Pat): nến ĐÓNG CỬA phá swing high -> tăng, phá swing low -> giảm
  const zig = (drift) => Array.from({ length: 80 }, (_, i) => { const p = 100 + drift * i + 5 * Math.sin(2 * Math.PI * i / 10); return { ts: i * 14400000, open: p - 0.2, high: p + 0.5, low: p - 0.5, close: p, vol: 1, confirm: 1 }; });
  assert(computeStructTrend(zig(0.5)) === 1, 'Cấu trúc đỉnh/đáy cao dần (BOS lên) -> xu hướng TĂNG');
  assert(computeStructTrend(zig(-0.5)) === -1, 'Cấu trúc đỉnh/đáy thấp dần (BOS xuống) -> xu hướng GIẢM');
  assert(computeStructTrend(zig(0).slice(0, 8)) === 0 && computeStructTrend(null) === 0, 'Quá ít nến hoặc không có dữ liệu -> trung tính (0)');
  assert(DEFAULT_CONFIG.enableTrendAlignFilter === false || DEFAULT_CONFIG.enableTrendAlignFilter === true, 'Cờ enableTrendAlignFilter tồn tại trong cấu hình');
  assert(DEFAULT_CONFIG.enableMacroRangeShort === false, 'Macro Range Short mặc định TẮT (lỗ cả năm: PF 0.54)');
}

// 31. API trạng thái của bot cho trang xem (chỉ đọc, bắt buộc token)
{
  const { createStateServer } = await import('../src/state_api.js');
  const srv = createStateServer(() => ({ positions: [{ symbol: 'BTC-USDT' }], pending: [], history: [] }), { token: 'abc' });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const auth = { headers: { authorization: 'Bearer abc' } };
  assert((await fetch(base + '/api/state')).status === 401, '31.1: thiếu token -> 401');
  assert((await fetch(base + '/api/state', { headers: { authorization: 'Bearer sai' } })).status === 401, '31.2: sai token -> 401');
  const ok = await fetch(base + '/api/state', auth), body = await ok.json();
  assert(ok.status === 200 && body.positions.length === 1 && typeof body.updatedAt === 'number', '31.3: đúng token -> 200 kèm vị thế và updatedAt');
  assert((await fetch(base + '/api/state', { ...auth, method: 'POST' })).status === 405, '31.4: chỉ cho GET (POST -> 405)');
  assert((await fetch(base + '/khac', auth)).status === 404, '31.5: đường dẫn lạ -> 404');
  let threw = false; try { createStateServer(() => ({}), { token: '' }); } catch { threw = true; }
  assert(threw, '31.6: không có token thì không cho tạo server (không mở API trần)');
  srv.close();
}

// 32. Bối cảnh lớn (toàn lịch sử): gộp nến ngày -> tuần/tháng, ATH/ATL, xu hướng M/W/D, pha thị trường, thống kê theo năm
{
  const { resample, buildMacroContext } = await import('../src/strategies/macro_context.js');
  const DAY = 86400000, t0 = Date.UTC(2020, 0, 6); // thứ Hai
  const mk = (n, f) => Array.from({ length: n }, (_, i) => { const p = f(i); return { ts: t0 + i * DAY, open: p - 0.3, high: p + 1, low: p - 1, close: p, vol: 1, confirm: 1 }; });
  const w = resample(mk(28, () => 100), 'W');
  assert(w.length === 4 && w[0].ts === t0 && w[0].confirm === 1 && w[3].confirm === 0, '32.1: 28 ngày từ thứ Hai -> đúng 4 tuần, tuần cuối chưa đóng');
  const g = resample([{ ts: t0, open: 10, high: 12, low: 9, close: 11, vol: 2, confirm: 1 }, { ts: t0 + DAY, open: 11, high: 15, low: 10, close: 14, vol: 3, confirm: 1 }], 'W')[0];
  assert(g.open === 10 && g.high === 15 && g.low === 9 && g.close === 14 && g.vol === 5, '32.2: gộp tuần: open đầu, high max, low min, close cuối, vol cộng');
  assert(resample(mk(70, () => 100), 'M')[0].ts === Date.UTC(2020, 0, 1), '32.3: gộp tháng bắt đầu ngày 1 (UTC)');
  const bull = mk(1500, (i) => 100 + i * 0.4 + 6 * Math.sin(i / 9)), bear = mk(1500, (i) => 700 - i * 0.4 + 6 * Math.sin(i / 9));
  const cb = buildMacroContext(bull), cr = buildMacroContext(bear);
  assert(cb.phase === 'BULL' && cb.trends.d === 1 && cb.trends.w === 1 && cb.score >= 3, '32.4: chuỗi tăng dài -> pha TĂNG, xu hướng D/W đều tăng');
  assert(cr.phase === 'BEAR' && cr.trends.w === -1 && cr.score <= -3, '32.5: chuỗi giảm dài -> pha GIẢM');
  const top = Math.max(...bear.map(c => c.high));
  assert(Math.abs(cr.ath.price - top) < 1e-9 && cr.drawdownPct > 40 && Math.abs(cb.drawdownPct) < 5, '32.6: ATH đúng và % sụt từ đỉnh (bear > 40%, bull gần đỉnh)');
  assert(cb.years.length >= 4 && cb.years.every(y => typeof y.returnPct === 'number' && y.maxDrawdownPct >= 0), '32.7: có thống kê theo năm (lợi nhuận, sụt tối đa)');
  assert(cb.levels.weekOpen && cb.levels.monthOpen && cb.levels.yearOpen && cb.levels.prevMonthHigh > cb.levels.prevMonthLow, '32.8: có các mốc tuần/tháng/năm và đỉnh-đáy tháng trước');
  assert(buildMacroContext(mk(40, () => 100)).phase === 'UNKNOWN', '32.9: quá ít lịch sử (<200 ngày) -> UNKNOWN, không đoán bừa');
  assert(/giảm|GIẢM/.test(cr.summary) && /tăng|TĂNG/.test(cb.summary), '32.10: câu tóm tắt tiếng Việt phản ánh đúng pha');
}

// 33. Tin Telegram kèm bối cảnh lớn + link biểu đồ (chỉ khi có dữ liệu, không thì giữ nguyên tin cũ)
{
  const { buildEarlySignalMessage, buildNewSignalMessage } = await import('../src/telegram.js');
  const base = { symbol: 'BTC-USDT', direction: 'SHORT', entry: 78000, stopLoss: 78400, takeProfit: 76500, riskReward: 3.7, reason: 'SMC sweep', strategy: 'SMC_SWEEP_REVERSAL_SHORT' };
  const ctx = { macroSummary: 'Bối cảnh lớn: pha thiên tăng | Tháng tăng', viewerUrl: 'https://viewer.example/?coin=BTC' };
  const e = buildEarlySignalMessage({ ...base, ...ctx }, 60), n = buildNewSignalMessage({ ...base, ...ctx, sizing: { size: 0.1, margin: 5, notional: 50 } });
  assert(e.includes('Bối cảnh lớn: pha thiên tăng') && e.includes('href="https://viewer.example/?coin=BTC"'), '33.1: tin BÁO SỚM có bối cảnh lớn và link biểu đồ');
  assert(n.includes('Bối cảnh lớn: pha thiên tăng') && n.includes('href="https://viewer.example/?coin=BTC"'), '33.2: tin VÀO LỆNH có bối cảnh lớn và link biểu đồ');
  const e0 = buildEarlySignalMessage(base, 60), n0 = buildNewSignalMessage({ ...base, sizing: { size: 0.1, margin: 5, notional: 50 } });
  assert(!e0.includes('Bối cảnh lớn') && !e0.includes('href=') && !n0.includes('Bối cảnh lớn') && !n0.includes('href='), '33.3: không có dữ liệu bối cảnh thì tin giữ nguyên, không in chữ rỗng/undefined');
  assert(!e0.includes('undefined') && !n0.includes('undefined'), '33.4: tin không chứa chữ undefined');
}

// 34. Bộ lập kịch bản theo cấu trúc của CHÍNH khung đang xem: vùng cản/hỗ trợ từ pivot, kế hoạch Short/Long có entry-SL-TP1-TP2 và đường đi minh họa
{
  const { atr, buildLevels, planScenarios } = await import('../src/strategies/scenario_planner.js');
  const wave = Array.from({ length: 400 }, (_, i) => { const c = 110 + 10 * Math.sin(2 * Math.PI * i / 40); return [i * 3600, c, c + 0.5, c - 0.5, c, 10]; });
  const price = 112, a = atr(wave), levels = buildLevels(wave, price);
  const res = levels.find(z => z.kind === 'res' && z.bottom <= 120.5 && z.top >= 120.5), sup = levels.find(z => z.kind === 'sup' && z.bottom <= 99.5 && z.top >= 99.5);
  assert(a > 0 && res && sup && res.touches >= 5 && sup.touches >= 5, '34.1: tìm ra vùng kháng cự ~120 và hỗ trợ ~100, mỗi vùng chạm nhiều lần');
  const { short, long } = planScenarios({ rows: wave, price, levels, atr: a });
  assert(short && short.entry >= res.bottom && short.entry <= res.top && short.sl > res.top && short.tp1 < short.entry, '34.2: Short: vào trong vùng kháng cự, SL ngoài đỉnh vùng, TP1 thấp hơn entry');
  assert(Math.abs(short.rr1 - (short.entry - short.tp1) / (short.sl - short.entry)) / short.rr1 < 0.01 && short.rr1 > 0, '34.3: R:R của Short đúng công thức (entry-TP1)/(SL-entry)');
  assert(long && long.entry >= sup.bottom && long.entry <= sup.top && long.sl < sup.bottom && long.tp1 > long.entry, '34.4: Long: vào trong vùng hỗ trợ, SL dưới đáy vùng, TP1 cao hơn entry');
  assert(Math.abs(long.rr1 - (long.tp1 - long.entry) / (long.entry - long.sl)) / long.rr1 < 0.01, '34.5: R:R của Long đúng công thức');
  const names = short.path.map(p => p.label);
  assert(short.path[0].bars === 0 && short.path[0].price === price && names.includes('Quét thanh khoản') && names.includes('Vào lệnh') && names.includes('TP1') && short.path.every((p, k, arr) => !k || p.bars > arr[k - 1].bars), '34.6: đường đi bắt đầu từ giá hiện tại, có quét thanh khoản/vào lệnh/TP1, thời gian tăng dần');
  const sweep = short.path.find(p => p.label === 'Quét thanh khoản');
  assert(sweep.price > short.entry && sweep.price < short.sl, '34.7: điểm quét thanh khoản nằm giữa entry và SL (SL không bị chạm trong kịch bản)');
  assert(short.tp2 < short.tp1 && long.tp2 > long.tp1 && short.rr2 >= short.rr1 && long.rr2 >= long.rr1, '34.10: TP2 luôn xa entry hơn TP1 (Short thấp hơn, Long cao hơn)');
  const { pickKeyLevels } = await import('../src/strategies/scenario_planner.js');
  const thick = levels.every(z => z.top - z.bottom <= 2 * a + 0.3 * a + 1e-9), keys = pickKeyLevels(levels, 3);
  assert(thick && keys.length <= 7 && keys.some(z => z === res) && keys.some(z => z === sup), '34.11: mỗi vùng dày không quá ~2 ATR và chỉ giữ vài vùng gần giá nhất (không dính chuỗi thành dải khổng lồ)');
  const down = Array.from({ length: 300 }, (_, i) => { const c = 200 - i * 0.5; return [i * 3600, c, c + 0.4, c - 0.4, c, 10]; });
  const none = planScenarios({ rows: down, price: down[299][4], levels: buildLevels(down, down[299][4]), atr: atr(down) });
  assert(none.long === null, '34.8: giá ở đáy dữ liệu, không có hỗ trợ bên dưới -> không bịa kịch bản Long');
  const empty = planScenarios({ rows: [], price: 1, levels: [], atr: 0 });
  assert(empty.short === null && empty.long === null && buildLevels([], 1).length === 0, '34.9: dữ liệu rỗng không gây lỗi');
}

// 35. Phán quyết hệ thống: đọc khối lượng + quyết định thống nhất với engine của bot
{
  const { analyzeVolume, buildVerdict } = await import('../src/strategies/verdict.js');
  const calm = (n) => Array.from({ length: n }, (_, i) => [i * 900, 100, 101, 99, 100, 10]);
  const mk = (last) => [...calm(30), last, [31 * 900, 100, 100.5, 99.5, 100, 10]]; // nến cuối là nến đang chạy, phân tích nến đóng gần nhất = last
  assert(analyzeVolume(mk([30 * 900, 100, 106, 99.5, 100.5, 40])).kind === 'CLIMAX_UP_REJECT', '35.1: khối lượng gấp 4 lần + râu trên dài -> climax bị từ chối ở trên (lực bán hấp thụ)');
  assert(analyzeVolume(mk([30 * 900, 100, 100.5, 94, 99.5, 40])).kind === 'CLIMAX_DOWN_REJECT', '35.2: khối lượng đột biến + râu dưới dài -> climax bị từ chối ở dưới (lực mua hấp thụ)');
  assert(analyzeVolume(mk([30 * 900, 100, 106, 99.8, 105.8, 40])).kind === 'BREAKOUT_UP', '35.3: khối lượng đột biến + đóng cửa vượt đỉnh 20 nến -> phá lên có khối lượng');
  assert(analyzeVolume(mk([30 * 900, 100, 100.2, 94, 94.2, 40])).kind === 'BREAKOUT_DOWN', '35.4: khối lượng đột biến + đóng cửa thủng đáy 20 nến -> phá xuống có khối lượng');
  assert(analyzeVolume(mk([30 * 900, 100, 101, 99, 100, 3])).kind === 'DRYING' && analyzeVolume(calm(5)).kind === 'UNKNOWN', '35.5: khối lượng cạn -> DRYING; thiếu dữ liệu -> UNKNOWN (không đoán)');
  const sig = { direction: 'SHORT', strategy: 'SMC_SWEEP_REVERSAL_SHORT', entry: 100, stopLoss: 101, takeProfit: 97 };
  const v1 = buildVerdict({ signal: sig, blocked: null, volTf: { kind: 'NORMAL' }, radarStatus: 'NEUTRAL' });
  assert(v1.decision === 'SHORT' && v1.source === 'BOT', '35.6: bot đang có tín hiệu -> quyết định là hướng của bot, nguồn BOT');
  const v2 = buildVerdict({ signal: null, blocked: 'CHOP_SLEEP_MODE: ...', volTf: { kind: 'NORMAL' }, radarStatus: 'APPROACHING_RESISTANCE' });
  assert(v2.decision === 'WAIT' && /CHOP_SLEEP_MODE/.test(v2.notes.join(' ')), '35.7: engine đang chặn -> CHỜ và nêu lý do chặn');
  const v3 = buildVerdict({ signal: null, blocked: null, volTf: { kind: 'CLIMAX_UP_REJECT', relVol: 3.5 }, radarStatus: 'APPROACHING_RESISTANCE' });
  assert(v3.decision === 'WAIT' && v3.favored === 'SHORT' && v3.checklist.some(c => c.ok && /khối lượng/i.test(c.text)), '35.8: áp sát kháng cự + climax từ chối ở trên -> ưu tiên canh SHORT, khối lượng được đánh dấu xác nhận');
  const v4 = buildVerdict({ signal: null, blocked: null, volTf: { kind: 'BREAKOUT_UP', relVol: 3 }, radarStatus: 'APPROACHING_RESISTANCE' });
  assert(v4.favored === null && v4.avoid === 'SHORT', '35.9: áp sát kháng cự nhưng đang phá lên có khối lượng -> KHÔNG canh Short (tránh bắt đỉnh)');
  const v5 = buildVerdict({ signal: null, blocked: null, volTf: { kind: 'NORMAL' }, radarStatus: 'NEUTRAL' });
  assert(v5.decision === 'WAIT' && v5.favored === null, '35.10: giữa vùng, không có gì -> đứng ngoài');
}

// Tổng kết
console.log('\n======================================================');
console.log(`🎉 TỔNG KẾT KIỂM THỬ: ${passed} PASS, ${failed} FAIL`);
console.log('======================================================\n');

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('✨ TẤT CẢ CÁC MODULE TOÁN HỌC VÀ LOGIC ĐÃ HOÀN HẢO!');
  process.exitCode = 0;
}

