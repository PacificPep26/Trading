# 🗺️ CODEBASE KNOWLEDGE MAP (Tự động tạo bởi codebase-mind)

> **Mục đích**: File này tóm tắt toàn bộ kiến trúc, exports, API và biến môi trường của dự án. AI trợ lý hãy đọc file này trước tiên để hiểu trọn vẹn dự án mà không cần đọc mò mẫm hàng nghìn dòng code.

- **Cập nhật lúc:** `2026-10-10T08:05:00.338Z`
- **Tổng số files mã nguồn:** `97` files

### 🔑 Biến môi trường cốt lõi (`process.env`)
`CRON_SECRET`, `MEXC_API_KEY`, `MEXC_SECRET_KEY`, `MEXC_LIVE_TRADING`, `MEXC_DRY_RUN`, `ALERT_CAPITAL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `NEXT_RUNTIME`, `PAPER_LEDGER_FILE`, `PAPER_SLIPPAGE_RATE`, `PAPER_FEE_RATE`

### 🌐 Các Endpoint API ngoài / Sàn
• `/api/watchlist`
• `https://api.mexc.com`
• `https://www.okx.com/api/v5`

### 📦 Bảng phân bố Module & Exports quan trọng

#### 📁 `app/api/cron/telegram/route.ts`
  - `const runtime`
  - `GET(request: Request): void`

#### 📁 `app/api/live/levels/route.ts`
  - `const runtime`
  - `GET(): void`

#### 📁 `app/api/mexc-check/route.ts`
  - `const runtime`
  - `GET(request: Request): void`

#### 📁 `app/api/paper/route.ts`
  - `const runtime`
  - `GET(): void`

#### 📁 `app/api/telegram/webhook/route.ts`
  - `POST(req: NextRequest): void`
  - `GET(): void`

#### 📁 `app/api/watchlist/route.ts`
  - `const runtime`
  - `GET(): void`

#### 📁 `app/layout.tsx`
  - `const metadata`
  - `const viewport`

#### 📁 `instrumentation.ts`
  - `register(): void`

#### 📁 `lib/capital-tier.ts`
  - `type CapitalTier`
  - `const CAPITAL_TIERS`
  - `getCapitalTier(equity: number): CapitalTier`
  - `checkTierChange(prevEquity: number, currentEquity: number): `
  - `type TierSizing`
  - `calculateTierSizing(equity: number, stopDistancePct: number): TierSizing`

#### 📁 `lib/decision-engine.ts`
  - `type DecisionContext`
  - `type OrderPlan`
  - `type SignalDecision`
  - `evaluateSetup(setup: Setup, ctx: DecisionContext): SignalDecision`

#### 📁 `lib/live-levels.ts`
  - `trendFor(coin: string): Promise<`

#### 📁 `lib/mexc-client.ts`
  - `type MexcPosition`
  - `type MexcAssetInfo`
  - `type MexcOrderResult`
  - `type MexcTpSlResult`
  - `loadContracts(): Record<string,`
  - `getContractSize(symbol: string): number`
  - `calculateContractVol(symbol: string, notional: number, price: number): `
  - `signMexcRequest(secretKey: string, apiKey: string, timestamp: string, paramStr = ""): string`
  - `getMexcAccountAsset(defaultEquity = 100): Promise<MexcAssetInfo>`
  - `getMexcOpenPositions(): Promise<MexcPosition[]>`
  - `closeMexcPosition(params: { symbol: string; side: 1 | -1; vol: number }): Promise<void>`
  - `moveStopsToBreakeven(): Promise<string[]>`
  - `updateMexcStopLossPrice(symbol: string, newStopPrice: number): Promise<boolean>`
  - *Gọi API:* `https://api.mexc.com`

#### 📁 `lib/okx.ts`
  - `type Candle`
  - `candles(instId: string, bar: string, limit = 120): Promise<Candle[]>`
  - `ticker(instId: string): void`
  - `funding(instId: string): void`
  - `openInterest(instId: string): void`
  - `longShortRatio(ccy: string, period = "1H"): void`
  - `openInterestHistory(ccy: string, period = "1H"): void`
  - *Gọi API:* `https://www.okx.com/api/v5`

#### 📁 `lib/paper-ledger.ts`
  - `type PaperState`
  - `type PaperEvent`
  - `appendPaperEvent(event: PaperEvent): void`
  - `readPaperEvents(): PaperEvent[]`
  - `paperSummary(defaultEquity = 40): void`
  - `openPaperPlan(id: string, decision: SignalDecision, bars: Candle[], defaultEquity = 40): void`
  - `reconcilePaperPositions(coin: string, bars: Candle[], defaultEquity = 40): void`

#### 📁 `lib/patterns.ts`
  - `type Setup`
  - `swings(cs: Candle[]): void`
  - `trendOf(cs: Candle[], highs: number[], lows: number[]): -1 | 0 | 1`
  - `analyse(all: Candle[]): void`
  - `analyseDaily(all: Candle[]): void`

#### 📁 `lib/telegram-alerts.ts`
  - `send(text: string): Promise<boolean>`
  - `scanAndAlert(): Promise<string[]>`
  - `preAlert(now = Date.now(): void`
  - `proximityRadarAlert(): Promise<string | null>`

#### 📁 `lib/trading-policy.ts`
  - `const STRATEGY_VERSION`
  - `const MAX_LEVERAGE`
  - `const RISK_PER_TRADE`
  - `const MAX_DRAWDOWN`
  - `const MIN_STOP_DISTANCE`
  - `const MAX_STOP_DISTANCE`
  - `const MAX_PRICE_DRIFT`
  - `type StrategyStatus`
  - `type Timeframe`
  - `type DecisionCode`
  - `const STRATEGY_REGISTRY`
  - `type TradeSizing`
  - `isAllowedSetup(style: string, side: 1 | -1, tf: Timeframe, btcDaily = 0, ownDaily = 0): boolean`
  - `isWatchSetup(style: string, side: 1 | -1, tf: Timeframe): boolean`
  - `isStarSetup(side: 1 | -1, ownDaily: number, btcDaily: number): boolean`
  - `isFundingSafe(rate?: number): boolean`
  - `calculateSizing(equity: number, stopDistancePct: number): TradeSizing`
  - `calculatePartialPnL(riskUsd: number): void`
  - `isDrawdownLocked(equity: number, peakEquity: number): boolean`

#### 📁 `service/backtest/data.py`
  - `class Candle`
  - `def load(symbol: str, interval: str = "1h", include_holdout: bool = False) -> list[Candle]`
  - `def ts(ms: int) -> str`

#### 📁 `service/backtest/engine.py`
  - `class Params`
  - `class Trade`
  - `class Result`
  - `def atr(candles: list[Candle], i: int, n: int) -> float | None`
  - `def simulate_trade(candles: list[Candle], signal_i: int, side: int, p: Params, end: int | None = None) -> Trade | None`

#### 📁 `service/backtest/metrics.py`
  - `def summary(res: Result) -> dict`
  - `def buy_and_hold(candles: list[Candle], start: int = 0, end: int | None = None, fee: float = 0.001) -> float`

#### 📁 `service/backtest/patterns.py`
  - `class Ctx`
  - `def build(cs: list[Candle]) -> Ctx`
  - `def confirmed(idx: list[int], i: int, count: int) -> list[int]`
  - `def trend(ctx: Ctx, i: int) -> int`
  - `def rejection(c: Candle, side: int) -> bool`
  - `def fib_confirm(ctx, i) -> any`
  - `def rsi_divergence(ctx, i) -> any`
  - `def sr_bounce(ctx, i) -> any`
  - `def sr_break_retest(ctx, i) -> any`
  - `def double_top_bottom(ctx, i) -> any`
  - `def fvg(ctx, i) -> any`
  - `def order_block(ctx, i) -> any`
  - `def vwap_reversion(ctx, i) -> any`
  - `def bos(ctx, i) -> any`
  - `def ema_pullback(ctx, i) -> any`

#### 📁 `service/backtest/setups.py`
  - `class Indicators`
  - `def indicators(cs: list[Candle]) -> Indicators`
  - `def sweep_reclaim(cs, ind, i) -> any`
  - `def breakout_volume(cs, ind, i) -> any`
  - `def trend_pullback(cs, ind, i) -> any`
  - `def engulfing_extreme(cs, ind, i) -> any`

#### 📁 `service/backtest/strategies.py`
  - `def sma(candles: list[Candle], i: int, n: int) -> float`
  - `def sma_cross(fast: int = 20, slow: int = 50) -> any`
  - `def f(candles: list[Candle], i: int) -> int`
  - `def engulfing_trend(trend_len: int = 50) -> any`
  - `def f(candles: list[Candle], i: int) -> int`
  - `def trend_volume(trend_len: int = 200, vol_len: int = 20, vol_mult: float = 1.5) -> any`
  - `def f(candles: list[Candle], i: int) -> int`

#### 📁 `service/backtest/structure.py`
  - `class Plan`
  - `def atr_series(cs: list[Candle], n: int = 14) -> list[float]`
  - `def swings(cs: list[Candle], i: int) -> tuple[list[int], list[int]]`
  - `def trend_of(cs, highs, lows) -> str`
  - `def plan_at(cs: list[Candle], atr: list[float], i: int, lookback: int = 120) -> Plan | None`

#### 📁 `service/backtest/walkforward.py`
  - `def year_folds(candles: list[Candle]) -> list[tuple[str, int, int]]`

#### 📁 `service/scripts/bos_exit_study.py`
  - `def walk(c1, j, side, entry, stop, tp, half_tp=None) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/bounce_long_study.py`
  - `def stats(name,v) -> any`

#### 📁 `service/scripts/btc_lead_study.py`
  - `def rets(cs) -> any`
  - `def corr(x, y) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/build_playbook.py`
  - `def simulate(cs, i, side, stop, m) -> any`
  - `def summarize(rows, fee) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/check_watchlist.py`
  - `def check() -> any`

#### 📁 `service/scripts/download_klines.py`
  - `def months(start: str) -> any`
  - `def fetch_month(symbol: str, interval: str, month: str, base: str = BASE) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/early_exit_study.py`
  - `def run(early, tp_r) -> any`
  - `def stats(name, v) -> any`
  - `def account(v, start, risk_usd) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/expand_study.py`
  - `def report(name, tr) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/fast_styles_evaluation.py`
  - `def pinbar_reversal(ctx, i) -> any`

#### 📁 `service/scripts/fetch_transcripts.py`
  - `def now() -> any`
  - `def list_videos(channel) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/h1_study.py`
  - `def run() -> any`

#### 📁 `service/scripts/intraday_study.py`
  - `def day_end(t: int) -> int`
  - `def trade(cs, i, side, tp, sl, fee) -> any`
  - `def stats(rets, notional) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/live_check.py`
  - `def okx(path) -> any`
  - `def closed_candles(coin, bar, limit=200) -> any`
  - `def scan_live() -> any`

#### 📁 `service/scripts/live_simulation_study.py`
  - `def daily_trend(c1) -> any`
  - `def trend_at(tr, t) -> any`
  - `def simulate_live_exit(cs, fill_i, side, entry, stop, tp1, tp2, hold_bars) -> any`
  - `def run_full_simulation() -> any`
  - `def net_r(tr, fee_round_trip) -> any`
  - `def print_stats(trades, fee_name, fee_val) -> any`
  - `def simulate_account(trades, fee_val, start_eq=52.0, risk_usd=2.5) -> any`

#### 📁 `service/scripts/market_brief.py`
  - `def okx(path) -> any`
  - `def closed_candles(coin, tf, limit=300) -> any`
  - `def fmt(x) -> any`
  - `def frame(coin, tf) -> any`
  - `def detail(coin) -> any`
  - `def scan() -> any`

#### 📁 `service/scripts/regime_study.py`
  - `def daily_state(c1) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/rule_study.py`
  - `def daily_trend(c1) -> any`
  - `def trend_at(tr, t) -> any`
  - `def signals(hours=4, tp=1.5, only=None, exclude=None) -> any`
  - `def net_r(tr, fee) -> any`
  - `def stats(rs) -> any`
  - `def account(trades, fee, mode, value) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/run_backtest.py`
  - `def fmt(v) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/scan_all_21.py`
  - `def okx(path) -> any`
  - `def closed_candles(coin, bar="4H", limit=120) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/short_exit_study.py`
  - `def main() -> any`

#### 📁 `service/scripts/structure_study.py`
  - `def run_symbol(cs, retrace=RETRACE) -> any`
  - `def random_trades(cs, risks, count, rng) -> any`
  - `def summarize(rows, fee) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/styles_study.py`
  - `def resample(cs: list[Candle], hours: int) -> list[Candle]`
  - `def year_of(t) -> any`
  - `def execute(cs, i, sig, target, hold, risk_range) -> any`
  - `def stats(rows) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/support_bounce_study.py`
  - `def resample(cs: list[Candle], hours: int) -> list[Candle]`
  - `def support_pinbar_detector(ctx, i) -> any`
  - `def run_study() -> any`

#### 📁 `service/scripts/support_target_study.py`
  - `def bounce(c1, j, side, level) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/sync_knowledge.py`
  - `def main() -> any`

#### 📁 `service/scripts/test_15m.py`
  - `def run_15m_test() -> any`

#### 📁 `service/scripts/test_daily_trend_following.py`
  - `def run_daily_trend_study(lookback_entry=20, lookback_exit=10, atr_mult=2.0) -> any`
  - `def evaluate(trades) -> any`

#### 📁 `service/scripts/trend_daily_study.py`
  - `def atr(cs, i, n=20) -> any`
  - `def run_symbol(cs, n_in, n_out) -> any`
  - `def stats(rows) -> any`
  - `def account(rows, start=50.0, risk=0.01, max_open=5) -> any`
  - `def fmt(s) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/trend_ride_study.py`
  - `def index_by_time(cs) -> any`
  - `def last_closed(idx_map, t_close, period) -> any`
  - `def run(sym, lev, margin_cap, max_stop) -> any`
  - `def main() -> any`

#### 📁 `service/scripts/zero_fee_study.py`
  - `def resample(cs: list[Candle], hours: int) -> list[Candle]`
  - `def run_zero_fee_test() -> any`

#### 📁 `service/scripts/zone_volume_study.py`
  - `def show(name, rows) -> any`
  - `def main() -> any`

#### 📁 `tests/test_backtest.py`
  - `def flat(n, px=100.0, rng=1.0) -> any`
  - `def test_entry_is_next_open_not_signal_close() -> any`
  - `def test_stop_loss_wins_when_both_hit_in_same_bar() -> any`
  - `def test_gap_through_stop_fills_at_open() -> any`
  - `def test_short_take_profit_and_costs() -> any`
  - `def test_time_exit_and_no_trade_past_end() -> any`
  - `def test_strategy_only_sees_closed_bars() -> any`
  - `def spy(candles, i) -> any`
  - `def test_summary() -> any`
  - `def test_funding_cost_is_charged_per_held_bar() -> any`

#### 📁 `tests/test_parity.py`
  - `def py_signals(win) -> any`
  - `def test_ts_matches_python(sym) -> any`

#### 📁 `tests/test_trend_daily.py`
  - `def c(t, o, h, l, cl) -> any`
  - `def base() -> any`
  - `def test_stop_loss_is_minus_one_r() -> any`
  - `def test_channel_exit_next_open() -> any`

