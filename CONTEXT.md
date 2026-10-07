# Project context for AI assistants

> Hướng hiện tại là crypto (không còn forex/MT5). Kế hoạch và tiến độ mới nhất nằm trong [PLAN.md](PLAN.md); nội dung bên dưới có thể đã cũ.

## Purpose

This repository is the starting point for a local-first Forex research and simulator platform. Its initial scope is one instrument, EUR/USD, with MetaTrader 5 demo data. The long-term product may ingest authorized trading material, explain charts, and evaluate an AI strategy. It is not intended to promise returns or provide financial advice.

## Current implementation

- `app/` is a Next.js dashboard in Vietnamese.
- `service/app/main.py` is a FastAPI service intended to run on the same Windows machine as the MetaTrader 5 terminal.
- The bridge exposes `/health`, `/api/v1/mt5/status`, and `/api/v1/market/EURUSD`.
- Market endpoints are GET-only, bound operationally to loopback as documented in the README, and CORS is restricted to the local Next.js development origins.
- The bridge rejects accounts unless the connected MT5 server name contains `demo` or `practice`.
- The browser displays actual candles returned by MT5 or an explicit unavailable state. It must never substitute fabricated prices.
- The AI simulator, knowledge ingestion, persistence, chart-image analysis, and all order execution are not implemented. The order control is intentionally disabled.

## Development conventions

- Keep market data and any future decisions grounded in real, timestamped data; show explicit errors or unavailable states.
- Treat OHLC/tick data as the source of truth for machine-readable analysis. Image interpretation may explain a chart but should not independently authorize trades.
- Use a separate risk-management layer for all future simulated executions; strategy output is never a direct broker command.
- Keep the README aligned with behavior. Do not claim features are implemented when only planned.

## Immediate next work

1. Validate the web build and Python bridge syntax/tests (`python -m pytest` with `service/requirements-dev.txt`).
2. Test MT5 connectivity read-only with a demo terminal; do not use credentials shared in chat.
3. Before order execution, get explicit risk limits and implement/test server checks, order-size limits, stop-loss requirements, daily drawdown limits, connection-loss behavior, and an emergency stop.
4. Design the authorized-source knowledge base and decision journal before choosing model training or automated promotion behavior.
