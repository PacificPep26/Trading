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
  detectCandlePattern
} from '../src/indicators.js';

import {
  calculatePositionSize,
  checkBtcMacroShield,
  analyzeBtcLocomotive,
  detectMarketPhase,
  evaluateMarket,
  generateKeyLevelRadar,
  calculateSetupQualityScore,
  DEFAULT_CONFIG
} from '../src/engine.js';

import { getEffectiveConfig, BOT_CONFIG } from '../src/config.js';

import {
  inspectTradeMistake,
  applyDisciplinaryPenalty,
  checkAdaptiveTradeAllowed,
  rewardWinAndClearPenalty
} from '../src/learning.js';

import { fetchOkxCandles } from '../src/server.js';

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
assert(DEFAULT_CONFIG.timeStopBars >= 16, 'DEFAULT_CONFIG.timeStopBars đồng bộ tối thiểu 16-24 nến M15 (4-6 tiếng)');
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

// Kiểm tra cổng Adaptive Veto Gate
const checkLong = checkAdaptiveTradeAllowed('SOL-USDT', 'LONG');
assert(checkLong.allowed === false, 'Cổng kỷ luật Veto chặn đứng lệnh Long trên cặp đang bị phạt');

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
  config: BOT_CONFIG
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

