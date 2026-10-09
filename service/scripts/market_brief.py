"""Live market brief for chat analysis (no AI API needed): OKX candles -> structure, trend, tested setups.

Usage: python -m service.scripts.market_brief [COIN ...]   (default: scan the 21-coin watchlist, detail SOL)
Uses the same detectors that were backtested (service/backtest/patterns.py).
"""
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

from service.backtest.data import Candle
from service.backtest.patterns import STYLES, build, confirmed, trend

# the one agreed rule (PLAN.md): only these two styles, only on the 4h frame
TESTED = {"bos", "double_top_bottom"}

VN = timezone(timedelta(hours=7))
COINS = ["BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK", "DOT", "LTC", "SUI", "ARB", "OP",
         "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"]
BAR = {"15m": "15m", "1h": "1H", "4h": "4H"}


def okx(path):
    req = urllib.request.Request("https://www.okx.com/api/v5" + path, headers={"User-Agent": "Mozilla/5.0"})
    return json.load(urllib.request.urlopen(req, timeout=20))["data"]


def closed_candles(coin, tf, limit=300):
    rows = okx(f"/market/candles?instId={coin}-USDT-SWAP&bar={BAR[tf]}&limit={limit}")[::-1]
    return [Candle(int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[6])) for r in rows if r[8] == "1"]


def fmt(x):
    return f"{x:.6g}"


def frame(coin, tf):
    cs = closed_candles(coin, tf)
    ctx = build(cs)
    i = len(cs) - 1
    t = trend(ctx, i)
    hs, ls = confirmed(ctx.highs, i, 3), confirmed(ctx.lows, i, 3)
    fired = []
    for ago in range(3):
        for key, (title, det) in STYLES.items():
            if key not in TESTED:
                continue
            s = det(ctx, i - ago)
            if s:
                fired.append(f"{title} {'LONG' if s['side'] > 0 else 'SHORT'} ({ago} nến trước) stop {fmt(s['stop'])}"
                             + (f" entry-limit {fmt(s['entry'])}" if s.get("entry") else "")
                             + (f" mục tiêu {fmt(s['target'])}" if s.get("target") else ""))
    c = cs[i]
    return {
        "tf": tf, "close": c.c, "time": datetime.fromtimestamp(c.t / 1000, VN).strftime("%d/%m %H:%M"),
        "trend": {1: "TĂNG (HH+HL)", -1: "GIẢM (LH+LL)", 0: "ĐI NGANG"}[t],
        "ema200": ctx.ema200[i], "ema20": ctx.ema20[i], "rsi": ctx.rsi[i], "atr_pct": ctx.atr[i] / c.c * 100,
        "swing_highs": [fmt(cs[k].h) for k in hs], "swing_lows": [fmt(cs[k].l) for k in ls],
        "vol_ratio": c.v / ctx.vol_avg[i] if ctx.vol_avg[i] else None, "setups": fired,
    }


def detail(coin):
    print(f"\n######## {coin}-USDT-SWAP")
    t = okx(f"/market/ticker?instId={coin}-USDT-SWAP")[0]
    f = okx(f"/public/funding-rate?instId={coin}-USDT-SWAP")[0]
    print(f"giá {t['last']} | 24h {float(t['last']) / float(t['open24h']) * 100 - 100:+.2f}% | cao/thấp 24h {t['high24h']}/{t['low24h']} | funding {float(f['fundingRate']) * 100:.4f}%")
    for tf in ("4h", "1h", "15m"):
        fr = frame(coin, tf)
        print(f"[{tf}] nến đóng {fr['time']} close {fmt(fr['close'])} | xu hướng {fr['trend']} | EMA20 {fmt(fr['ema20'])} EMA200 {fmt(fr['ema200'])} "
              f"| RSI {fr['rsi']:.0f} | ATR {fr['atr_pct']:.2f}% | KL {fr['vol_ratio'] or 0:.1f}x")
        print(f"      đỉnh swing gần: {fr['swing_highs']} | đáy swing gần: {fr['swing_lows']}")
        if tf == "4h":
            print("      setup 4h: " + ("; ".join(fr["setups"]) if fr["setups"] else "không → đứng ngoài"))


def scan():
    print("== Quét 4h (BOS / hai đỉnh-hai đáy = 2 kiểu gần lãi nhất)")
    for coin in COINS:
        try:
            fr = frame(coin, "4h")
        except Exception as e:  # noqa: BLE001 - keep scanning the other coins
            print(f"{coin:5s} lỗi {e}")
            continue
        hits = fr["setups"]
        print(f"{coin:5s} {fmt(fr['close']):>10s} {fr['trend']:13s} RSI {fr['rsi']:3.0f} | " + ("; ".join(hits) if hits else "-"))


if __name__ == "__main__":
    coins = [a.upper() for a in sys.argv[1:]]
    if not coins:
        scan()
        coins = ["SOL"]
    for c in coins:
        detail(c)
