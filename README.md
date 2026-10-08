# Northstar Crypto Lab

Personal research lab for crypto perpetuals (SOL, BTC, ETH, HYPE and ~20 altcoins): live OKX dashboard, backtests of common chart-analysis styles, and a knowledge base built from trading videos. Research only, not investment advice. Nothing here places orders.

Start with [PLAN.md](PLAN.md) (current conclusions, what was tested, open plans). Daily logs: [docs/nhat-ky-giao-dich.md](docs/nhat-ky-giao-dich.md), [docs/nhat-ky-nghien-cuu.md](docs/nhat-ky-nghien-cuu.md).

## Web dashboard (Next.js)

The dashboard refreshes every 60 seconds and combines 15m/1h/4h context, OI history, long/short ratio, conditional TP-before-SL statistics, entry timing, a setup scanner, and optional Postgres-backed position tracking. Configure `DATABASE_URL` to save positions; market analysis remains available when Postgres is unavailable.

Also: a 4h watchlist of the two best-tested setups (BOS, double top/bottom) across 21 coins with entry/stop/targets and leverage sized from the amount you accept to lose; an optional Claude analysis panel (needs `ANTHROPIC_API_KEY`). Live OKX public data (no API key): candles 15m/1h/4h, funding, open interest, BTC 1h move, alerts (volume spike ≥3×, BTC 1h move ≥1%, funding ≥0.03%), and a position calculator (PnL at TP/SL with fees, risk/reward, break-even win rate, estimated liquidation).

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
python -m service.scripts.build_analysis_stats
python -m service.scripts.styles_study --fee-market 0.0004 --fee-limit 0.0002   # 10 chart styles, MEXC-like fees
python -m service.scripts.trend_ride_study --lev 20
python -m service.scripts.market_brief SOL   # live multi-timeframe brief used in chat
python service\scripts\fetch_transcripts.py --delay 30
python -m pytest tests\test_backtest.py
```

`data/` (candles, transcripts database) is git-ignored and rebuilt by the scripts. Transcripts are for personal study only.
