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

  // Chế độ khớp lệnh: 'LIMIT_MAKER' (Post-Only) hoặc 'MARKET'
  orderType: process.env.ORDER_TYPE || 'LIMIT_MAKER',

  // Tỷ lệ phí giao dịch: Maker 0.02% (tiết kiệm 75%) vs Taker 0.08%
  makerFeeRate: 0.0002,
  takerFeeRate: 0.0008,
  feeRate: process.env.ORDER_TYPE === 'MARKET' ? 0.0008 : 0.0002,

  // Số lượng vị thế mở tối đa cùng một thời điểm (Tránh phân tán Margin)
  maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || '2', 10)
};

// ====================================================================
// 1.1. BỘ LỌC CHẾ ĐỘ THỊ TRƯỜNG V3.0 (MARKET REGIME & VOLATILITY COMPRESSION)
// Triệt tiêu tử huyệt Sideway / Summer Chop làm thua lỗ các tháng mùa hè
// ====================================================================
export const REGIME_CONFIG = {
  // Ngưỡng tối thiểu H1 ADX(14) để xác nhận thị trường có xu hướng động lực
  minH1ADX: parseFloat(process.env.MIN_H1_ADX || '20.0'),

  // Ngưỡng tỷ số nén ATR: ATR(14) / SMA(ATR, 50). < 0.70 là biến động co thắt kiệt quệ
  minAtrCompressionRatio: parseFloat(process.env.MIN_ATR_COMPRESSION_RATIO || '0.70'),

  // Kích hoạt trạng thái ngủ đông khi thị trường Sideway / Chop
  enableChopSleepMode: process.env.ENABLE_CHOP_SLEEP_MODE !== 'false'
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

  // Time-stop: TẮT HẲN theo mặc định (0). Backtest full-history xác nhận: mọi
  // giá trị Time-Stop đã test (16/48/96/150 nến) đều làm hồi quy nghiêm trọng
  // so với tắt hẳn (16 nến: PF 0.86/-7.48R, 150 nến: PF 1.20/+29.10R, TẮT: PF
  // 1.47/+60.32R) - cắt cụt setup H4 đang tích lũy lành mạnh trước khi có đủ
  // 2-4 nến H4 (8-16h) để phát triển. Xem docs/REGIME_ADAPTIVE_PLAN.md.
  timeStopBars: parseInt(process.env.TIME_STOP_BARS || '0', 10),

  // CHẾ ĐỘ TIME-STOP: 'BARS' (mặc định, đếm nến M15 cố định - hành vi cũ) hoặc
  // 'H4_CONDITION' (thử nghiệm: đóng khi nến H4 gần nhất đảo hướng HOẶC giá
  // chưa di chuyển đủ 0.5xATR(H4), không đếm nến cố định - xem
  // docs/ENGINE_LOGIC_GUIDE.md Phần 7). timeStopMinBars = sàn tối thiểu trước
  // khi xét điều kiện H4_CONDITION (mặc định 16 = ~1 nến H4/4h).
  timeStopMode: process.env.TIME_STOP_MODE || 'BARS',
  timeStopMinBars: parseInt(process.env.TIME_STOP_MIN_BARS || '16', 10),

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

  // Danh mục Coin tinh hoa được theo dõi: Quét đồng thời toàn bộ danh mục,
  // Đánh giá điểm chất lượng & Sức mạnh tương đối để chỉ vào "CON KHỎE NHẤT"
  // Hỗ trợ phân cách bằng dấu phẩy (,), dấu cách hoặc xuống dòng linh hoạt
  premierWatchlist: (process.env.WATCHLIST || 'ETH-USDT,NEAR-USDT,BTC-USDT,SOL-USDT,LINK-USDT,HYPE-USDT')
    .split(/[,\s]+/)
    .map(s => s.trim().toUpperCase())
    .filter(Boolean),

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
// 3.1. CẤU HÌNH TÙY BIẾN RIÊNG CHO TỪNG TÀI SẢN (ASSET-SPECIFIC CONFIG)
// Giúp xử lý các coin có biên độ dao động mạnh như SOL mà không cần loại bỏ
// ====================================================================
export const ASSET_CONFIG = {
  'SOL-USDT': {
    atrBufferMultiplier: 1.0,  // Nới đệm ATR từ 0.75 lên 1.0 để chống săn thanh khoản M15 hung hãn
    maxSlDistanceRate: 0.035   // Cho phép biên độ SL tới 3.5% cho SOL
  }
};

/**
 * Trả về cấu hình hiệu dụng cho từng cặp coin, kết hợp cấu hình tổng và override theo tài sản
 */
export function getEffectiveConfig(symbol, baseConfig) {
  const base = baseConfig || BOT_CONFIG;
  const cleanSymbol = (symbol || '').replace('-SWAP', '').trim().toUpperCase();
  const override = ASSET_CONFIG[cleanSymbol] || {};
  return { ...base, ...override };
}

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
  equalLevelTolerancePct: 0.15,

  // Ngưỡng điểm chất lượng tối thiểu để xét duyệt vào lệnh (Thang điểm 0 - 100)
  // Kết hợp: Râu nến + VSA Climax + Vùng Cản Tier 2/FVG + Sức mạnh tương đối so với BTC
  minSetupQualityScore: parseInt(process.env.MIN_SETUP_QUALITY_SCORE || '75', 10),

  // QUY TẮC ĐỘ TƯƠI MỚI: Số nến M15 tối đa kể từ lúc H4 đóng nến để Kane Long/Short
  // còn được coi là "mới" (trong khoảng này mới chạy chiến lược H4 truyền thống,
  // qua khỏi mốc này chỉ còn SMC Zone Reaction hoạt động). Mặc định 4 (1 tiếng).
  freshH4Bars: parseInt(process.env.FRESH_H4_BARS || '8', 10),

  // CHỈ BÁO BIẾN ĐỘNG NHANH (RECENT MOMENTUM): detectMarketPhase() dùng EMA34/89
  // phản ứng chậm, có thể bỏ sót cú trượt giá nhanh (vd giảm 4%+ chỉ trong vài
  // ngày) chưa kịp làm EMA doãng ra đủ để báo STRONG_UPTREND/DOWNTREND. Bổ sung
  // kiểm tra % thay đổi giá trong N nến H4 gần nhất để cấm bắt dao rơi/cản tàu
  // đúng lúc ngay cả khi EMA-phase còn báo RANGING.
  momentumLookbackBars: parseInt(process.env.MOMENTUM_LOOKBACK_BARS || '12', 10),
  momentumThresholdPct: parseFloat(process.env.MOMENTUM_THRESHOLD_PCT || '4', 10),

  // XÁC NHẬN MẪU HÌNH NẾN + KHỐI LƯỢNG: yêu cầu nến M15 kích hoạt entry phải
  // khớp 1 mẫu hình nến cổ điển cùng hướng (Engulfing/Hammer/Morning Star...)
  // VÀ có khối lượng >= SMA20 mới cho vào lệnh. Mặc định TẮT (giữ hành vi cũ)
  // - PHẢI backtest trước khi bật mặc định. Xem detectCandlePattern() trong
  // src/indicators.js và docs/REGIME_ADAPTIVE_PLAN.md.
  requirePricePattern: process.env.REQUIRE_PRICE_PATTERN === 'true',

  // ĐỒNG BỘ TIÊU CHÍ QUÉT CẢN Long vs Short: Kane Long bắt buộc lastH4.low<sup
  // (xuyên qua hỗ trợ), Kane Short trước đây chỉ cần chạm hờ 0.8% (bất đối
  // xứng, phát hiện qua review kỹ thuật). Backtest full-history xác nhận bật
  // (đòi Short cũng phải lastH4.high>res) cải thiện: PF 1.47->1.52, Tổng R
  // +60.32R->+62.92R, Net +$569->+$596 (DD hơi tệ hơn -13.20R->-15.55R, chấp
  // nhận được vì 3/4 chỉ số chính đều tốt lên). BẬT mặc định.
  strictShortSweep: process.env.STRICT_SHORT_SWEEP !== 'false',

  // VOLUME PROFILE (POC/VAH/VAL) làm cản bổ sung cho SMC Zone Reaction. Mặc
  // định TẮT - PHẢI backtest trước khi bật, xem calculateVolumeProfile() trong
  // src/indicators.js và docs/strategies/VOLUME_PROFILE_BREAKER.md.
  useVolumeProfile: process.env.USE_VOLUME_PROFILE === 'true',
  volumeProfileMode: process.env.VOLUME_PROFILE_MODE || 'RANGING_ONLY',
  volumeProfileLookback: parseInt(process.env.VOLUME_PROFILE_LOOKBACK || '50', 10),
  volumeProfileValueAreaPct: parseFloat(process.env.VOLUME_PROFILE_VA_PCT || '0.70'),
  volumeProfileNumBins: parseInt(process.env.VOLUME_PROFILE_NUM_BINS || '24', 10),

  // ICT BREAKER BLOCK RETEST làm bộ lọc xác nhận thêm (AND) cho các cản SMC
  // Zone Reaction đã có. Kiểm chứng chặt (Parameter Sweep 38 tổ hợp + backtest
  // đa năm 2021-2026, >1.1 triệu nến M15 - xem docs/strategies/VOLUME_PROFILE_BREAKER.md
  // Phần 7-9): bộ pivotL=1/pivotR=1 + AND_FILTER thắng baseline trên CẢ 1-năm
  // (PF 1.52->1.59, Tổng R +62.92R->+62.21R gần như ngang) VÀ multi-year
  // (PF 1.10->1.13, Tổng R +50.45R->+61.81R, +11.36R thật trên 5 năm, cả 5/5
  // năm bằng hoặc tốt hơn, 2021 lật từ âm sang dương). Đánh đổi duy nhất: Max
  // DD 1-năm tệ hơn -15.55R->-17.74R (~+14%, chấp nhận được, cùng mức đánh đổi
  // đã chấp nhận trước đó với strictShortSweep). BẬT mặc định.
  useBreakerBlocks: process.env.USE_BREAKER_BLOCKS !== 'false',
  breakerBlockMode: process.env.BREAKER_BLOCK_MODE || 'AND_FILTER',
  breakerPivotL: parseInt(process.env.BREAKER_PIVOT_L || '1', 10),
  breakerPivotR: parseInt(process.env.BREAKER_PIVOT_R || '1', 10)
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
  timeStopMode: EXIT_CONFIG.timeStopMode,
  timeStopMinBars: EXIT_CONFIG.timeStopMinBars,
  maxSlDistanceRate: EXIT_CONFIG.maxSlDistanceRate,
  atrBufferMultiplier: EXIT_CONFIG.atrBufferMultiplier,

  scanMode: UNIVERSE_CONFIG.scanMode,
  minCoinPrice: UNIVERSE_CONFIG.minCoinPrice,
  topLimit: UNIVERSE_CONFIG.topCoinsLimit,
  topCoinsLimit: UNIVERSE_CONFIG.topCoinsLimit,
  watchlist: UNIVERSE_CONFIG.premierWatchlist,

  wickRatioThreshold: INDICATOR_CONFIG.wickRatioThreshold,
  freshH4Bars: INDICATOR_CONFIG.freshH4Bars,
  momentumLookbackBars: INDICATOR_CONFIG.momentumLookbackBars,
  momentumThresholdPct: INDICATOR_CONFIG.momentumThresholdPct,
  requirePricePattern: INDICATOR_CONFIG.requirePricePattern,
  strictShortSweep: INDICATOR_CONFIG.strictShortSweep,
  useVolumeProfile: INDICATOR_CONFIG.useVolumeProfile,
  volumeProfileMode: INDICATOR_CONFIG.volumeProfileMode,
  volumeProfileLookback: INDICATOR_CONFIG.volumeProfileLookback,
  volumeProfileValueAreaPct: INDICATOR_CONFIG.volumeProfileValueAreaPct,
  volumeProfileNumBins: INDICATOR_CONFIG.volumeProfileNumBins,
  useBreakerBlocks: INDICATOR_CONFIG.useBreakerBlocks,
  breakerBlockMode: INDICATOR_CONFIG.breakerBlockMode,
  breakerPivotL: INDICATOR_CONFIG.breakerPivotL,
  breakerPivotR: INDICATOR_CONFIG.breakerPivotR,
  minSetupQualityScore: INDICATOR_CONFIG.minSetupQualityScore,
  minH1ADX: REGIME_CONFIG.minH1ADX,
  minAtrCompressionRatio: REGIME_CONFIG.minAtrCompressionRatio,
  orderType: CAPITAL_CONFIG.orderType,
  pollIntervalSec: RUNTIME_CONFIG.pollIntervalSeconds,
  okxBaseUrl: RUNTIME_CONFIG.okxBaseUrl,

  // Nhúng các nhóm cấu hình chi tiết
  capital: CAPITAL_CONFIG,
  regime: REGIME_CONFIG,
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
