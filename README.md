# Northstar Crypto Lab

Personal research lab for crypto perpetuals (SOL, BTC, ETH, HYPE and ~20 altcoins): live OKX dashboard, backtests of common chart-analysis styles, and a knowledge base built from trading videos. Research only, not investment advice. Nothing here places orders.

Start with [PLAN.md](PLAN.md) (current conclusions, what was tested, open plans). Daily logs: [docs/nhat-ky-giao-dich.md](docs/nhat-ky-giao-dich.md), [docs/nhat-ky-nghien-cuu.md](docs/nhat-ky-nghien-cuu.md).

## Web (Next.js)

One page: a live scanner for 21 OKX perpetuals. The browser streams OKX public WebSocket data (tickers, 5-level books, trades, 15m candles); `/api/watchlist` finds the two tested 4h setups (BOS, double top/bottom) and `/api/live/levels` gives 4h/1h trend context. Each row shows VÀO NGAY / CHỜ / BỎ QUA with entry, stop, targets and position size; optional browser notifications. No API key, no orders.

```powershell
npm install
npm run dev
```

Deployed on Railway with `npm run build` / `npm run start`.

## Research scripts (Python, local)

```powershell
python -m pip install -r service\requirements-dev.txt
python service\scripts\download_klines.py SOLUSDT --interval 15m --start 2023-01 --market futures
python -m service.scripts.run_backtest trend_volume --symbols SOLUSDT --interval 4h --fee 0
python -m service.scripts.intraday_study --interval 15m
python -m service.scripts.btc_lead_study --interval 1h
python -m service.scripts.styles_study --fee-market 0.0004 --fee-limit 0.0002   # 10 chart styles, MEXC-like fees
python -m service.scripts.trend_ride_study --lev 20
python -m service.scripts.market_brief SOL   # live multi-timeframe brief used in chat
python service\scripts\fetch_transcripts.py --delay 30
python -m pytest tests\test_backtest.py
```

`data/` (candles, transcripts database) is git-ignored and rebuilt by the scripts. Transcripts are for personal study only.
