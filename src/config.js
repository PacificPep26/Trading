/**
 * CONFIG.JS
 * BẢN ĐẶC TẢ CẤU HÌNH TRUNG TÂM (CENTRAL MASTER CONFIGURATION)
 * Crypto Futures Quant Bot - Chiến Lược SMC & Dr. Kane Sonic R
 * 
 * Toàn bộ tham số quản trị vốn, chiến lược, chỉ báo, bộ lọc đầu tàu BTC,
 * và kỷ luật tự học được quy tụ tại file duy nhất này để dễ dàng kiểm toán,
 * tham vấn chuyên gia và tinh chỉnh tham số định lượng.
 */

import dotenv from 'dotenv';
dotenv.config();

// ====================================================================
// 1. QUẢN TRỊ VỐN & ĐÒN BẨY (CAPITAL & RISK MANAGEMENT)
// ====================================================================
export const CAPITAL_CONFIG = {
  // Rủi ro cố định 1R trên mỗi lệnh (USD). Mặc định $10.0
  riskUsdPerTrade: parseFloat(process.env.RISK_USD_PER_TRADE || '10.0'),

  // Đòn bẩy tài khoản (Isolated Margin 10X)
  leverage: parseInt(process.env.LEVERAGE || '10', 10),

  // Tỷ lệ phí giao dịch Taker khứ hồi (0.08% trên sàn OKX Futures)
  feeRate: parseFloat(process.env.FEE_RATE || '0.0008'),

  // Số lượng vị thế mở tối đa cùng một thời điểm (Tránh phân tán Margin)
  maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || '2', 10)
};

// ====================================================================
// 2. QUY TẮC VÀO LỆNH, CHỐT LỜI & CẮT LỖ (TRADE & RISK-REWARD RULES)
// ====================================================================
export const EXIT_CONFIG = {
  // Tỷ lệ Lợi nhuận / Rủi ro tối thiểu để chấp nhận vào lệnh (Tối thiểu 1:2.0)
  minRR: parseFloat(process.env.MIN_RR_RATIO || '2.0'),

  // Mốc lãi để kích hoạt dời Stop Loss (Nâng lên +1.4R theo khuyến nghị Chuyên gia để tránh bị quét khi retest)
  beTriggerR: parseFloat(process.env.BE_TRIGGER_R || '1.4'),

  // Mức khóa lợi nhuận dương (Đưa về Hòa Vốn thực tế +0.05R đệm trượt giá, không khóa non 0.5R để giá thở tới 2R)
  lockProfitR: parseFloat(process.env.LOCK_PROFIT_R || '0.05'),

  // Đệm bù phí sàn khi dời hòa vốn (0.12% để gánh trọn vẹn phí Taker + trượt giá)
  beBufferRate: 0.0012,

  // Time-stop: Sau 24 nến M15 (6 tiếng) cho SMC M15 đủ thời gian phát triển trọn vẹn sóng
  timeStopBars: parseInt(process.env.TIME_STOP_BARS || '24', 10),

  // Quy tắc SMC Không Đuổi Giá (No-Chasing Rule): Không mở lệnh nếu khoảng cách SL > 2.5% giá vào
  maxSlDistanceRate: 0.025,

  // Đệm ATR cộng thêm vào đỉnh/đáy để đặt Stop Loss (Tăng lên 0.75 * ATR M15 để loại bỏ 90% râu nến giả)
  atrBufferMultiplier: 0.75
};

// ====================================================================
// 3. DANH MỤC COIN & BỘ LỌC CHẤT LƯỢNG (UNIVERSE & BLACKLIST)
// ====================================================================
export const UNIVERSE_CONFIG = {
  // Chế độ quét: 'WATCHLIST' (Tập trung danh mục coin có Expectancy dương)
  scanMode: process.env.SCAN_MODE || 'WATCHLIST',

  // Danh mục Coin tinh hoa chuẩn nến và cấu trúc tôn trọng SMC nhất sàn OKX
  // Mặc định chạy 2 cỗ máy sinh lời thực dương mạnh nhất: ETH-USDT (+12.58R) và NEAR-USDT (+10.97R)
  // (Loại bỏ SOL-USDT, có thể tùy biến thêm LINK, BTC qua biến môi trường WATCHLIST)
  premierWatchlist: (process.env.WATCHLIST || 'ETH-USDT,NEAR-USDT')
    .split(',')
    .map(s => s.trim().toUpperCase()),

  // Bộ lọc giá tối thiểu: Chặn triệt để coin rác có giá 0.xx (< 1.0 USDT)
  minCoinPrice: parseFloat(process.env.MIN_COIN_PRICE || '1.0'),

  // Giới hạn số lượng coin top thanh khoản được phân tích
  topCoinsLimit: parseInt(process.env.TOP_COINS_LIMIT || '20', 10),

  // Danh sách Memecoin / Coin rác cấm giao dịch tuyệt đối vì râu nến giật ảo
  memecoinBlacklist: new Set([
    'FLOKI-USDT', 'BONK-USDT', 'SHIB-USDT', 'PEPE-USDT', 'MEME-USDT',
    'BOME-USDT', 'NEIRO-USDT', 'PENGU-USDT', 'APR-USDT', 'HMSTR-USDT',
    'TURBO-USDT', 'DOGS-USDT', '1000SATS-USDT', 'SATS-USDT', 'BABYDOGE-USDT',
    'BILL-USDT', 'AKE-USDT', 'DOOD-USDT', 'PUMP-USDT', 'DOGE-USDT'
  ]),

  // Danh sách Tài sản truyền thống / Cổ phiếu CFD không phải Crypto trên OKX SWAP
  nonCryptoBlacklist: new Set([
    'XAU-USDT', 'XAG-USDT', 'CL-USDT', 'SOXL-USDT', 'SOXS-USDT', 'SPCX-USDT',
    'SNDK-USDT', 'SKHYNIX-USDT', 'SKHY-USDT', 'MU-USDT', 'KORU-USDT', 'SNXX-USDT',
    'TSLA-USDT', 'NVDA-USDT', 'QQQ-USDT', 'MSTR-USDT', 'CRCL-USDT', 'UNITREE-USDT', 'BZ-USDT'
  ])
};

// ====================================================================
// 4. BỘ CHỈ HUY ĐẦU TÀU BTC (LOCOMOTIVE LEADER ENGINE)
// ====================================================================
export const LOCOMOTIVE_CONFIG = {
  // Cặp tiền Đầu Tàu dẫn dắt toàn thị trường
  leaderSymbol: 'BTC-USDT-SWAP',

  // Tỷ lệ thân nến Marubozu trên ATR H1 để xác định pha xả lũ hoặc bơm dựng cột
  marubozuMinBodyAtrRatio: 0.8,
  marubozuMinBodyRatio: 0.65,

  // Tỷ lệ râu nến tối thiểu trên H1 (35%) để xác nhận Đầu Tàu đảo chiều cấu trúc
  reversalWickRatioThreshold: 0.35,

  // Quy tắc cấm Altcoins theo Đầu Tàu:
  // - Khi BTC đang lao dốc (Dumping Waterfall): CẤM TUYỆT ĐỐI Long Altcoin, chỉ cho phép Short!
  // - Khi BTC đang bơm dốc (Pumping Parabolic): CẤM TUYỆT ĐỐI Short Altcoin!
  forbidAltsLongOnBtcDump: true,
  forbidAltsShortOnBtcPump: true
};

// ====================================================================
// 5. CẤU TRÚC THỊ TRƯỜNG & CHỈ BÁO KỸ THUẬT (SMC & INDICATORS)
// ====================================================================
export const INDICATOR_CONFIG = {
  // Hệ thống Sonic R Fibonacci EMA
  emaFastPeriod: 34,      // Đường EMA 34 (Xu hướng ngắn/trung)
  emaSlowPeriod: 89,      // Đường EMA 89 (Trục xu hướng dài hạn H4)

  // Chỉ báo đo lường biến động
  atrPeriod: 14,          // Chu kỳ ATR chuẩn 14 nến

  // Cấu trúc Fractal Pivots nhận diện Swing High / Swing Low
  pivotLeftBars: 2,       // Số nến bên trái đỉnh/đáy
  pivotRightBars: 2,      // Số nến bên phải đỉnh/đáy

  // Tỷ lệ râu nến rút chân / từ chối giá tối thiểu để xác nhận Pinbar / Absorption
  wickRatioThreshold: 0.35,

  // Tỷ lệ khối lượng VSA Climax Absorption (Lớn hơn hoặc bằng 2.5 lần SMA 20 của Volume)
  volumeAbsorptionMultiplier: 2.5,

  // Khoảng cách nhận diện 2 đỉnh/đáy bằng nhau (Equal Highs/Lows) tạo bẫy Inducement
  equalLevelTolerancePct: 0.15
};

// ====================================================================
// 6. HỆ THỐNG TỰ HỌC & KỶ LUẬT KỶ CƯƠNG (ADAPTIVE DISCIPLINE)
// ====================================================================
export const LEARNING_CONFIG = {
  // Cơ chế gỡ án phạt: 'LOCOMOTIVE_STRUCTURAL' (Neo vào cấu trúc Đầu Tàu BTC, KHÔNG DÙNG ĐỒNG HỒ)
  unfreezeMode: 'LOCOMOTIVE_STRUCTURAL',

  // BỎ phạt giảm size vốn để triệt tiêu bẫy sụt giảm vốn bất đối xứng (Asymmetric Recovery Trap)
  consecutiveLossThreshold: 999, // Vô hiệu hóa tính năng giảm size lẻ tẻ
  reducedRiskMultiplier: 1.0,    // Luôn giữ nguyên 1R ($10) để bảo toàn lực gỡ hòa

  // Cầu Dao Tổng (Circuit Breaker): Sau 3 lệnh thua liên tiếp -> Tạm dừng quét 8 tiếng
  circuitBreakerThreshold: 3,
  circuitBreakerHours: 8,

  // Thời gian làm nguội cơ bản cho các lỗi kỹ thuật thông thường (tiếng)
  baseCooldownHours: 4,
  trendFightingCooldownHours: 8,

  // Tự động xóa án phạt và phục hồi 100% volume khi có lệnh Thắng
  rehabilitateOnWin: true
};

// ====================================================================
// 7. HỆ THỐNG VẬN HÀNH & KẾT NỐI (RUNTIME & SYSTEM)
// ====================================================================
export const RUNTIME_CONFIG = {
  // Chu kỳ quét thị trường định kỳ (giây)
  pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SEC || '60', 10),

  // Endpoint OKX Public REST API
  okxBaseUrl: process.env.OKX_BASE_URL || 'https://www.okx.com',

  // File lưu trữ trạng thái vị thế sống
  positionsFile: process.env.STATE_FILE || 'positions.json',

  // File bộ nhớ tự học và lịch sử sai lầm
  tradeMemoryFile: 'data/trade_memory.json'
};

// ====================================================================
// TỔNG HỢP MASTER CONFIGURATION (TƯƠNG THÍCH HOÀN TOÀN TẤT CẢ MODULES)
// ====================================================================
export const BOT_CONFIG = {
  // Phẳng hóa các trường chính để tương thích 100% với DEFAULT_CONFIG & CONFIG cũ
  riskUsd: CAPITAL_CONFIG.riskUsdPerTrade,
  fixedRiskUsd: CAPITAL_CONFIG.riskUsdPerTrade,
  leverage: CAPITAL_CONFIG.leverage,
  feeRate: CAPITAL_CONFIG.feeRate,
  maxOpenPositions: CAPITAL_CONFIG.maxOpenPositions,

  minRR: EXIT_CONFIG.minRR,
  beTriggerR: EXIT_CONFIG.beTriggerR,
  lockProfitR: EXIT_CONFIG.lockProfitR,
  beBufferRate: EXIT_CONFIG.beBufferRate,
  timeStopBars: EXIT_CONFIG.timeStopBars,
  maxSlDistanceRate: EXIT_CONFIG.maxSlDistanceRate,
  atrBufferMultiplier: EXIT_CONFIG.atrBufferMultiplier,

  scanMode: UNIVERSE_CONFIG.scanMode,
  minCoinPrice: UNIVERSE_CONFIG.minCoinPrice,
  topLimit: UNIVERSE_CONFIG.topCoinsLimit,
  topCoinsLimit: UNIVERSE_CONFIG.topCoinsLimit,
  watchlist: UNIVERSE_CONFIG.premierWatchlist,

  wickRatioThreshold: INDICATOR_CONFIG.wickRatioThreshold,
  pollIntervalSec: RUNTIME_CONFIG.pollIntervalSeconds,
  okxBaseUrl: RUNTIME_CONFIG.okxBaseUrl,

  // Nhúng các nhóm cấu hình chi tiết
  capital: CAPITAL_CONFIG,
  exit: EXIT_CONFIG,
  universe: UNIVERSE_CONFIG,
  locomotive: LOCOMOTIVE_CONFIG,
  indicator: INDICATOR_CONFIG,
  learning: LEARNING_CONFIG,
  runtime: RUNTIME_CONFIG
};

// Giữ bí danh tương thích ngược
export const DEFAULT_CONFIG = BOT_CONFIG;
export default BOT_CONFIG;
