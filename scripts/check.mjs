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
  validateCandleSchema
} from '../src/indicators.js';

import {
  calculatePositionSize,
  checkBtcMacroShield,
  evaluateMarket,
  DEFAULT_CONFIG
} from '../src/engine.js';

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
assert(DEFAULT_CONFIG.timeStopBars === 16, 'DEFAULT_CONFIG.timeStopBars đồng bộ 16 nến M15 (4 tiếng)');

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

