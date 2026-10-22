/**
 * LEARNING.JS
 * Hệ thống Tự Học, Phạt Kỷ Luật & Mổ Xẻ Điểm Sai Sau Lệnh Thua (Adaptive Post-Loss Inspector)
 * 
 * Triết lý cốt lõi:
 * "Đánh phải khiến bot sợ thua, phải phạt nó, tìm ra điểm sai của từng giai đoạn nến
 * để nó hiểu và tự học hỏi, không bao giờ lặp lại cùng một sai lầm!"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateEMA, calculateSMA, calculateATR, analyzeCandle } from './indicators.js';
import { detectMarketPhase, analyzeBtcLocomotive } from './engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_FILE = path.join(__dirname, '../data/trade_memory.json');

// Cấu hình Hình phạt Kỷ luật
export const PENALTY_CONFIG = {
  cooldownHoursAfterSL: 4,          // Đóng băng tối thiểu 4 tiếng trên cặp bị thua
  trendFightingCooldownHours: 8,    // Đóng băng 8 tiếng nếu phạm lỗi bắt dao rơi / cản tàu
  consecutiveSlThreshold: 2,        // 2 lệnh thua liên tiếp -> Giảm 50% rủi ro ($10 -> $5)
  circuitBreakerThreshold: 3,       // 3 lệnh thua liên tiếp -> Đóng băng toàn bộ hệ thống 12 tiếng
  circuitBreakerHours: 12
};

// Trạng thái bộ nhớ sống của bot
let tradeMemory = {
  penalties: {},                  // { symbol: { untilTs, forbiddenDirection, reason, mistakeType } }
  consecutiveLosses: 0,
  recentMistakes: [],             // Lịch sử các lỗi gần nhất để AI và bot học hỏi
  currentRiskMultiplier: 1.0,     // 1.0 = 100% ($10), 0.5 = 50% ($5)
  systemCircuitBreakerUntil: 0
};

/**
 * Tải bộ nhớ học tập từ file
 */
export function loadTradeMemory() {
  if (fs.existsSync(MEMORY_FILE)) {
    try {
      tradeMemory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    } catch (err) {
      console.error('[LEARNING] Lỗi đọc trade_memory.json:', err.message);
    }
  }
  return tradeMemory;
}

/**
 * Lưu bộ nhớ học tập ra file
 */
export function saveTradeMemory() {
  try {
    const dir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(tradeMemory, null, 2), 'utf8');
  } catch (err) {
    console.error('[LEARNING] Lỗi lưu trade_memory.json:', err.message);
  }
}

// Khởi tạo nạp bộ nhớ
loadTradeMemory();

/**
 * Mổ xẻ Điểm Sai Sau Lệnh Thua (Forensic Post-Loss Analyzer)
 * @param {object} params
 * @returns {object} Chi tiết lỗi và khuyến nghị kỷ luật
 */
export function inspectTradeMistake({ pos, candlesH4, candlesH1, candlesM15, btcH4Candles = null, btcH1Candles = null }) {
  const isLong = pos.direction === 'LONG';
  const symbol = pos.symbol;
  const isAltcoin = !symbol.includes('BTC');

  // 1. Kiểm tra LỖI KHÔNG THEO ĐẦU TÀU BTC (LOCOMOTIVE MISALIGNMENT):
  // Đây là điểm sai cốt lõi: Nếu đầu tàu BTC đang cắm đầu rơi mà Altcoin dám Long,
  // hoặc đầu tàu BTC đang bơm dốc đứng mà Altcoin dám Short -> Phạt gắn chặt vào cấu trúc BTC!
  let btcLoco = null;
  let isFoughtLocomotive = false;
  if (btcH1Candles && btcH1Candles.length >= 15) {
    btcLoco = analyzeBtcLocomotive({ btcH4Candles, btcH1Candles });
    if (isAltcoin) {
      if (isLong && !btcLoco.canLongAlts) isFoughtLocomotive = true;
      if (!isLong && !btcLoco.canShortAlts) isFoughtLocomotive = true;
    }
  }

  // 2. Kiểm tra Giai đoạn Thị trường của chính cặp coin
  let marketPhase = 'RANGING';
  if (candlesH4 && candlesH4.length >= 20) {
    const closesH4 = candlesH4.map(c => c.close);
    const ema34Arr = calculateEMA(closesH4, 34);
    const ema89Arr = calculateEMA(closesH4, 89);
    marketPhase = detectMarketPhase(candlesH4, ema34Arr, ema89Arr);
  }

  // 3. Kiểm tra lỗi Bắt Dao Rơi / Cản Tàu (Trend Fighting Trap)
  const isTrendFighting = 
    (isLong && marketPhase === 'STRONG_DOWNTREND') ||
    (!isLong && marketPhase === 'STRONG_UPTREND');

  // 4. Kiểm tra lỗi Thiếu Khối lượng Hấp thụ VSA (No Volume Fakeout)
  let isLowVolumeTrap = false;
  let volRatio = 1.0;
  if (candlesM15 && candlesM15.length >= 20) {
    const volumes = candlesM15.map(c => c.vol);
    const smas = calculateSMA(volumes, 20);
    const lastVol = volumes[volumes.length - 1];
    const lastSma = smas[smas.length - 1] || 1;
    volRatio = lastVol / lastSma;
    if (volRatio < 1.3) {
      isLowVolumeTrap = true;
    }
  }

  // 5. Kiểm tra lỗi Bị Quét Râu Do Stop Loss Quá Chặt / Cản Rác
  const riskDist = Math.abs(pos.entry - pos.initialStopLoss);
  const riskPct = (riskDist / pos.entry) * 100;
  const isTooTightOrChop = riskPct < 0.25;

  // Phân loại Lỗi Trọng Tâm & Yêu Cầu Cấu Trúc Đầu Tàu (Locomotive Requirement)
  let mistakeType = 'STRUCTURE_FAILED';
  let mistakeTitle = 'Vùng Cản Thất Bại (Cấu trúc bị phá vỡ)';
  let rootCause = 'Giá kiểm tra cản nhưng Market Maker hấp thụ xuyên qua, quét Stop Loss.';
  let penaltyDurationHours = PENALTY_CONFIG.cooldownHoursAfterSL;
  let forbiddenDirection = null;
  let requiredBtcConfirmation = isLong ? 'BTC_BULLISH_REVERSAL_CONFIRMED' : 'BTC_BEARISH_REJECTION_CONFIRMED';

  if (isFoughtLocomotive) {
    mistakeType = 'LOCOMOTIVE_MISALIGNMENT';
    mistakeTitle = isLong
      ? 'Đánh Long Cản Tàu Khi Đầu Tàu BTC Đang Rơi Tự Do'
      : 'Đánh Short Chặn Đầu Khi Đầu Tàu BTC Đang Bơm Dựng Cột';
    rootCause = `Toa tàu ${symbol} mở lệnh ${pos.direction} khi Đầu Tàu BTC đang ${btcLoco.phase}! Lỗi không theo đầu tàu dẫn dắt là lỗi chết người!`;
    penaltyDurationHours = PENALTY_CONFIG.trendFightingCooldownHours;
    forbiddenDirection = pos.direction;
    requiredBtcConfirmation = isLong ? 'BTC_BULLISH_REVERSAL_CONFIRMED' : 'BTC_BEARISH_REJECTION_CONFIRMED';
  } else if (isTrendFighting) {
    mistakeType = 'TREND_FIGHTING';
    mistakeTitle = isLong ? 'Bắt Dao Rơi Trong Xu Hướng Giảm Dốc Đứng' : 'Chặn Đầu Xe Lửa Trong Xu Hướng Tăng Dốc Mạnh';
    rootCause = `Vào lệnh ${pos.direction} khi thị trường đang ở giai đoạn ${marketPhase}. Nến dốc đứng một chiều nghiền nát mọi hỗ trợ/kháng cự con!`;
    penaltyDurationHours = PENALTY_CONFIG.trendFightingCooldownHours;
    forbiddenDirection = pos.direction; // Cấm mở tiếp hướng này!
    requiredBtcConfirmation = isLong ? 'BTC_BULLISH_REVERSAL_CONFIRMED' : 'BTC_BEARISH_REJECTION_CONFIRMED';
  } else if (isLowVolumeTrap) {
    mistakeType = 'LOW_VOLUME_FAKEOUT';
    mistakeTitle = 'Bẫy Thanh Khoản Thiếu Khối Lượng (Fakeout)';
    rootCause = `Vào lệnh đón đầu nhưng Volume chỉ đạt ${volRatio.toFixed(1)}x SMA20 (thiếu lực hấp thụ thực sự của Smart Money).`;
    penaltyDurationHours = 4;
  } else if (isTooTightOrChop) {
    mistakeType = 'CHOP_ZONE_TRAP';
    mistakeTitle = 'Bị Bào Mòn Trong Vùng Đi Ngang Nhiễu (Chop Zone)';
    rootCause = `Biên độ rủi ro quá hẹp (${riskPct.toFixed(2)}%), thị trường đang nén không có lực đẩy.`;
    penaltyDurationHours = 6;
  }

  return {
    symbol,
    direction: pos.direction,
    entry: pos.entry,
    exitPrice: pos.stopLoss,
    marketPhase,
    mistakeType,
    mistakeTitle,
    rootCause,
    penaltyDurationHours,
    forbiddenDirection,
    requiredBtcConfirmation,
    volRatio: parseFloat(volRatio.toFixed(2)),
    analyzedAt: Date.now()
  };
}

/**
 * Áp dụng Hình Phạt Kỷ Luật lên Bot (Enforce Penalty Matrix)
 * @param {object} pos 
 * @param {object} mistake 
 * @returns {object} Chi tiết hình phạt đang thi hành
 */
export function applyDisciplinaryPenalty(pos, mistake) {
  loadTradeMemory();

  const now = Date.now();
  const symbol = pos.symbol;
  const isLocomotiveAnchored = Boolean(mistake.requiredBtcConfirmation);
  const penaltyUntil = isLocomotiveAnchored
    ? null // Không dùng hạn thời gian, neo chặt vào cấu trúc Đầu Tàu BTC!
    : now + (mistake.penaltyDurationHours * 3600 * 1000);

  const penaltyUntilStr = isLocomotiveAnchored
    ? `CHỜ ĐẦU TÀU BTC XÁC NHẬN CẤU TRÚC (${mistake.requiredBtcConfirmation})`
    : new Date(penaltyUntil).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  // 1. Phạt Đóng Băng Cặp Coin vi phạm
  tradeMemory.penalties[symbol] = {
    penaltyUntil,
    penaltyUntilStr,
    forbiddenDirection: mistake.forbiddenDirection,
    requiredBtcConfirmation: mistake.requiredBtcConfirmation || null,
    mistakeType: mistake.mistakeType,
    rootCause: mistake.rootCause,
    appliedAt: now
  };

  // 2. Tăng số lệnh thua liên tiếp & Phạt Quản lý vốn
  tradeMemory.consecutiveLosses = (tradeMemory.consecutiveLosses || 0) + 1;

  let riskAction = 'GIỮ NGUYÊN 100% RISK ($10)';
  if (tradeMemory.consecutiveLosses >= PENALTY_CONFIG.circuitBreakerThreshold) {
    // Thua 3 lệnh liên tiếp -> Circuit Breaker đóng băng toàn hệ thống 12 tiếng!
    tradeMemory.systemCircuitBreakerUntil = now + (PENALTY_CONFIG.circuitBreakerHours * 3600 * 1000);
    tradeMemory.currentRiskMultiplier = 0.5;
    riskAction = `🚨 KÍCH HOẠT CIRCUIT BREAKER: ĐÓNG BĂNG TOÀN HỆ THỐNG ${PENALTY_CONFIG.circuitBreakerHours} TIẾNG!`;
  } else if (tradeMemory.consecutiveLosses >= PENALTY_CONFIG.consecutiveSlThreshold) {
    // Thua 2 lệnh liên tiếp -> Phạt cắt giảm 50% rủi ro ($10 -> $5)
    tradeMemory.currentRiskMultiplier = 0.5;
    riskAction = '📉 PHẠT CẮT 50% VOLUME ($10 -> $5) CHO LỆNH TIẾP THEO ĐỂ BẢO VỆ TÀI KHOẢN';
  }

  // 3. Ghi vào lịch sử bài học
  tradeMemory.recentMistakes.unshift({
    symbol,
    direction: pos.direction,
    strategy: pos.strategy,
    mistakeType: mistake.mistakeType,
    mistakeTitle: mistake.mistakeTitle,
    rootCause: mistake.rootCause,
    lossUsd: pos.sizing ? -(pos.sizing.riskPerUnit * Math.abs(pos.entry - pos.stopLoss)) : -10,
    timestamp: now
  });

  if (tradeMemory.recentMistakes.length > 30) {
    tradeMemory.recentMistakes = tradeMemory.recentMistakes.slice(0, 30);
  }

  saveTradeMemory();

  return {
    symbol,
    cooldownHours: mistake.penaltyDurationHours,
    isLocomotiveAnchored,
    penaltyUntilStr,
    consecutiveLosses: tradeMemory.consecutiveLosses,
    currentRiskMultiplier: tradeMemory.currentRiskMultiplier,
    riskAction,
    isSystemFrozen: tradeMemory.systemCircuitBreakerUntil > now,
    systemFreezeUntilStr: tradeMemory.systemCircuitBreakerUntil > now ? new Date(tradeMemory.systemCircuitBreakerUntil).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : null
  };
}

/**
 * Xóa án phạt khi có lệnh Thắng (Rehabilitation on Win)
 * @param {string} symbol 
 */
export function rewardWinAndClearPenalty(symbol) {
  loadTradeMemory();
  tradeMemory.consecutiveLosses = 0;
  tradeMemory.currentRiskMultiplier = 1.0; // Phục hồi 100% rủi ro chuẩn
  if (tradeMemory.penalties[symbol]) {
    delete tradeMemory.penalties[symbol];
  }
  saveTradeMemory();
  console.log(`[LEARNING REWARD] ${symbol} THẮNG LỆNH! Đã xóa án phạt và khôi phục 100% hạn mức giao dịch!`);
}

/**
 * Cổng Kiểm Tra Điều Kiện Trước Khi Vào Lệnh (Adaptive Penalty Gate)
 * Bot tự kiểm tra xem có đang bị phạt hoặc vi phạm bài học cũ hay không!
 * @param {string} symbol 
 * @param {string} direction 'LONG' | 'SHORT'
 * @returns {{ allowed: boolean, reason: string|null }}
 */
export function checkAdaptiveTradeAllowed(symbol, direction, btcH1Candles = null, btcH4Candles = null) {
  loadTradeMemory();
  const now = Date.now();

  // 1. Kiểm tra Circuit Breaker toàn hệ thống
  if (tradeMemory.systemCircuitBreakerUntil && tradeMemory.systemCircuitBreakerUntil > now) {
    const unfreezeTime = new Date(tradeMemory.systemCircuitBreakerUntil).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    return {
      allowed: false,
      reason: `CIRCUIT_BREAKER_ACTIVE: Toàn hệ thống đang bị phạt đóng băng sau ${tradeMemory.consecutiveLosses} lệnh thua liên tiếp. Mở lại lúc ${unfreezeTime}.`
    };
  }

  // 2. Kiểm tra án phạt của cặp coin
  const penalty = tradeMemory.penalties[symbol];
  if (!penalty) {
    return { allowed: true, reason: null };
  }

  // 2.1. NẾU LÀ ÁN PHẠT NEO THEO CẤU TRÚC ĐẦU TÀU BTC (KHÔNG DÙNG ĐỒNG HỒ THỜI GIAN)
  if (penalty.requiredBtcConfirmation) {
    // Nếu có dữ liệu nến Đầu Tàu BTC để kiểm tra
    if (btcH1Candles && btcH1Candles.length >= 15) {
      const btcLoco = analyzeBtcLocomotive({ btcH4Candles, btcH1Candles });
      const isLongPenalty = penalty.requiredBtcConfirmation === 'BTC_BULLISH_REVERSAL_CONFIRMED';
      const isStructureConfirmed = isLongPenalty ? btcLoco.hasBullishReversal : btcLoco.hasBearishRejection;

      if (isStructureConfirmed) {
        // ĐẦU TÀU ĐÃ HOÀN TẤT CẤU TRÚC XÁC NHẬN! GỠ BỎ ÁN PHẠT NGAY LẬP TỨC!
        delete tradeMemory.penalties[symbol];
        saveTradeMemory();
        console.log(`[LOCOMOTIVE ALIGNED] Đầu Tàu BTC đã xác nhận cấu trúc ${penalty.requiredBtcConfirmation}! Gỡ bỏ án phạt cho ${symbol} ngay lập tức!`);
        return { allowed: true, reason: null };
      }
    }

    // Nếu Đầu Tàu BTC vẫn chưa xác nhận cấu trúc:
    if (penalty.forbiddenDirection) {
      // Chỉ cấm hướng vi phạm (ví dụ cấm LONG), không cấm hướng thuận theo Đầu Tàu (ví dụ SHORT)!
      if (direction === penalty.forbiddenDirection) {
        return {
          allowed: false,
          reason: `LOCOMOTIVE_STRUCTURE_LOCKED: Cặp ${symbol} bị PHẠT KHÓA CHẶT lệnh ${penalty.forbiddenDirection}. Đang đợi Đầu Tàu BTC hoàn tất cấu trúc (${penalty.requiredBtcConfirmation})!`
        };
      }
      // Cho phép hướng đối diện hoặc cho phép quét sơ bộ ban đầu (direction=null) để evaluateMarket tìm kèo thuận Đầu Tàu!
      return { allowed: true, reason: null };
    }

    // Nếu là án phạt đóng băng toàn diện không phân biệt hướng
    return {
      allowed: false,
      reason: `LOCOMOTIVE_STRUCTURE_LOCKED: Cặp ${symbol} bị ĐÓNG BĂNG TOÀN DIỆN. Đang đợi Đầu Tàu BTC hoàn tất cấu trúc (${penalty.requiredBtcConfirmation})!`
    };
  }

  // 2.2. Án phạt thường (nếu có hướng cấm)
  if (penalty.forbiddenDirection) {
    if (direction === penalty.forbiddenDirection) {
      if (!penalty.penaltyUntil || penalty.penaltyUntil > now) {
        return {
          allowed: false,
          reason: `MISTAKE_PENALTY_VETO: Cặp ${symbol} đang bị PHẠT CẤM ${penalty.forbiddenDirection} đến ${penalty.penaltyUntilStr} do bài học: ${penalty.rootCause}`
        };
      }
    }
    return { allowed: true, reason: null };
  }

  // 2.3. Cooldown chung (cho các lỗi kỹ thuật khác nếu có)
  if (!penalty.forbiddenDirection && penalty.penaltyUntil && penalty.penaltyUntil > now) {
    return {
      allowed: false,
      reason: `COOLDOWN_ACTIVE: ${symbol} đang trong thời gian làm nguội đến ${penalty.penaltyUntilStr} (Lỗi: ${penalty.mistakeType})`
    };
  }

  return { allowed: true, reason: null };
}

/**
 * Lấy hệ số điều chỉnh Risk hiện tại của bot ($10 * multiplier)
 */
export function getAdaptiveRiskMultiplier() {
  loadTradeMemory();
  return tradeMemory.currentRiskMultiplier || 1.0;
}

