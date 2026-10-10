import type { Setup } from "./patterns.ts";
import { CAPITAL_TIERS, calculateTierSizing } from "./capital-tier.ts";
import {
  isAllowedSetup,
  isDrawdownLocked,
  isFundingSafe,
  isBtcMomentumBlocked,
  MAX_STOP_DISTANCE,
  MIN_STOP_DISTANCE,
  MAX_PRICE_DRIFT,
  STRATEGY_REGISTRY,
  STRATEGY_VERSION,
  type DecisionCode,
  type Timeframe,
  type TradeSizing,
} from "./trading-policy.ts";

export interface DecisionContext {
  coin: string;
  timeframe: Timeframe;
  btcDaily: -1 | 0 | 1 | number;
  ownDaily: -1 | 0 | 1 | number;
  equity: number;
  peakEquity: number;
  lastBarTime: number;
  livePrice?: number;
  now?: number;
  dataValid?: boolean;
  btc1hBars?: { o: number; c: number; h: number; l: number }[];
  fundingRate?: number;
}

export interface OrderPlan {
  strategyVersion: string;
  coin: string;
  timeframe: Timeframe;
  style: string;
  side: 1 | -1;
  signalTime: number;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  riskPct: number;
  sizing: TradeSizing;
  level: number;
}

export interface SignalDecision {
  accepted: boolean;
  code: DecisionCode;
  strategyVersion: string;
  plan?: OrderPlan;
}

const reject = (code: DecisionCode): SignalDecision => ({
  accepted: false,
  code,
  strategyVersion: STRATEGY_VERSION,
});

export function evaluateSetup(setup: Setup, ctx: DecisionContext): SignalDecision {
  const now = ctx.now ?? Date.now();

  // 1. Kiểm tra tính toàn vẹn dữ liệu
  if (
    ctx.dataValid === false ||
    !Number.isFinite(ctx.lastBarTime) ||
    !Number.isFinite(setup.entry) ||
    !Number.isFinite(setup.stop)
  ) {
    return reject("INVALID_DATA");
  }

  // 2. Cầu dao an toàn (Circuit Breaker)
  // Dưới tầng vốn thấp nhất: rủi ro cố định 2.5$ sẽ là 30-50% tài khoản → khóa
  if (isDrawdownLocked(ctx.equity, ctx.peakEquity) || ctx.equity < CAPITAL_TIERS[0].minEquity) {
    return reject("BOT_LOCKED");
  }

  // 3. Kiểm tra tính hợp lệ của chiến lược trong Registry
  const registryKey =
    ctx.timeframe === "1H"
      ? (`${setup.style}_1h` as keyof typeof STRATEGY_REGISTRY)
      : (setup.style as keyof typeof STRATEGY_REGISTRY);

  const reg = STRATEGY_REGISTRY[registryKey] ?? STRATEGY_REGISTRY[setup.style as keyof typeof STRATEGY_REGISTRY];
  if (!reg || reg.status !== "paper") {
    return reject("STRATEGY_NOT_PAPER");
  }

  // 4. Kiểm tra xu hướng & bối cảnh
  if (!isAllowedSetup(setup.style, setup.side, ctx.timeframe, ctx.btcDaily, ctx.ownDaily)) {
    return reject("TREND_MISMATCH");
  }

  // 4b. Kiểm tra Quán tính động lượng ngắn hạn của BTC (BTC Intraday Momentum)
  if (isBtcMomentumBlocked(setup.side, ctx.btc1hBars)) {
    return reject("BTC_MOMENTUM_BLOCKED");
  }

  // 4c. Kiểm tra Lệ phí Funding Rate bất thường
  if (!isFundingSafe(ctx.fundingRate)) {
    return reject("EXTREME_FUNDING");
  }

  // 4d. Kiểm tra Khối lượng kiệt quệ (Volume Ratio < 0.75x)
  if (setup.volumeRatio !== undefined && setup.volumeRatio < 0.75) {
    return reject("LOW_VOLUME");
  }

  // 4e. Kiểm tra Bẫy phá vỡ giả thân nến (Fakeout Wick Trap cho BOS)
  if (setup.style === "bos" && setup.isCleanBody === false) {
    return reject("FAKEOUT_WICK_TRAP");
  }

  // 5. Kiểm tra trạng thái nến kích hoạt
  if (setup.state !== "triggered") {
    return reject("PENDING_CONFIRMATION");
  }

  // 6. Kiểm tra tín hiệu quá hạn (> 36 tiếng cho 1D, > 8 tiếng cho 4H)
  const maxStaleMs = ctx.timeframe === "1D" ? 36 * 60 * 60_000 : 8 * 60 * 60_000;
  if (now - ctx.lastBarTime > maxStaleMs || ctx.lastBarTime > now + 5 * 60_000) {
    return reject("STALE_SIGNAL");
  }

  // 7. Kiểm tra khoảng cách Dừng lỗ (SL): 1.5% đến 6.0% (cho 4H), tối đa 15% (cho 1D)
  const riskPct = Math.abs(setup.entry - setup.stop) / setup.entry;
  const maxStopDistance = ctx.timeframe === "1D" ? 0.15 : MAX_STOP_DISTANCE;
  if (
    riskPct < MIN_STOP_DISTANCE ||
    riskPct > maxStopDistance ||
    (setup.side > 0 ? setup.stop >= setup.entry : setup.stop <= setup.entry)
  ) {
    return reject("INVALID_STOP");
  }

  // 8. Chống trôi giá / vào lệnh trễ: nếu có giá live thì kiểm tra không để đu giá
  if (ctx.livePrice !== undefined && Number.isFinite(ctx.livePrice)) {
    const drift = Math.abs(ctx.livePrice - setup.entry) / setup.entry;
    const maxDrift = ctx.timeframe === "1D" ? 0.015 : MAX_PRICE_DRIFT;
    if (drift > maxDrift) {
      return reject("RUNAWAY_PRICE");
    }
  }

  // 9. Tính toán kế hoạch lệnh chuẩn:
  // - Đối với 1D Donchian Trend Following: KHÔNG CÓ TP CỐ ĐỊNH (gồng lãi theo xu hướng, thoát lệnh theo đáy 10D)
  // - Đối với 4H: Cơ chế Đệm Chốt Lời (TP1 ở 0.90R khóa hòa vốn, TP2 ở 1.85R đón đầu cản)
  const r = Math.abs(setup.entry - setup.stop);
  const isDailyDonchian = ctx.timeframe === "1D" && setup.style === "daily_trend_donchian";
  const tp1 = isDailyDonchian ? 0 : setup.entry + setup.side * 0.90 * r;
  const tp2 = isDailyDonchian ? 0 : setup.entry + setup.side * 1.85 * r;

  return {
    accepted: true,
    code: "ACCEPTED",
    strategyVersion: STRATEGY_VERSION,
    plan: {
      strategyVersion: STRATEGY_VERSION,
      coin: ctx.coin,
      timeframe: ctx.timeframe,
      style: setup.style,
      side: setup.side,
      signalTime: ctx.lastBarTime,
      entry: setup.entry,
      stop: setup.stop,
      tp1,
      tp2,
      riskPct,
      sizing: calculateTierSizing(ctx.equity, riskPct),
      level: setup.level,
    },
  };
}
