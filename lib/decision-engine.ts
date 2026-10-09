import type { Setup } from "./patterns.ts";
import {
  calculateSizing,
  isAllowedSetup,
  isDrawdownLocked,
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
  btcDaily: -1 | 0 | 1;
  ownDaily: -1 | 0 | 1;
  equity: number;
  peakEquity: number;
  lastBarTime: number;
  livePrice?: number;
  now?: number;
  dataValid?: boolean;
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
  if (isDrawdownLocked(ctx.equity, ctx.peakEquity)) {
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

  // 5. Kiểm tra trạng thái nến kích hoạt
  if (setup.state !== "triggered") {
    return reject("PENDING_CONFIRMATION");
  }

  // 6. Kiểm tra tín hiệu quá hạn (> 8 tiếng)
  if (now - ctx.lastBarTime > 8 * 60 * 60_000 || ctx.lastBarTime > now + 5 * 60_000) {
    return reject("STALE_SIGNAL");
  }

  // 7. Kiểm tra khoảng cách Dừng lỗ (SL): Bắt buộc từ 1.5% đến 6.0%
  const riskPct = Math.abs(setup.entry - setup.stop) / setup.entry;
  if (
    riskPct < MIN_STOP_DISTANCE ||
    riskPct > MAX_STOP_DISTANCE ||
    (setup.side > 0 ? setup.stop >= setup.entry : setup.stop <= setup.entry)
  ) {
    return reject("INVALID_STOP");
  }

  // 8. Chống trôi giá / vào lệnh trễ: nếu giá live đã chạy quá 0.25% so với entry
  if (ctx.livePrice && Number.isFinite(ctx.livePrice)) {
    const drift = Math.abs(ctx.livePrice - setup.entry) / setup.entry;
    if (drift > MAX_PRICE_DRIFT) {
      return reject("RUNAWAY_PRICE");
    }
  }

  // 9. Tính toán kế hoạch lệnh chuẩn: TP1 ở 1.0R (dời hòa), TP2 ở 2.0R
  const r = Math.abs(setup.entry - setup.stop);
  const tp1 = setup.entry + setup.side * 1.0 * r;
  const tp2 = setup.entry + setup.side * 2.0 * r;

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
      sizing: calculateSizing(ctx.equity, riskPct),
      level: setup.level,
    },
  };
}
