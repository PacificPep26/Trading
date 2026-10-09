"""Scan and display full status of all 21 coins on OKX live market.
"""
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from service.backtest.data import Candle
from service.backtest.patterns import STYLES, build, trend, confirmed

COINS = [
    "BTC", "ETH", "SOL", "HYPE", "LINK", "XRP", "DOGE", "BNB", "ADA", "AVAX",
    "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"
]
VN = timezone(timedelta(hours=7))


def okx(path):
    req = urllib.request.Request("https://www.okx.com/api/v5" + path, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.load(res)["data"]


def closed_candles(coin, bar="4H", limit=120):
    rows = okx(f"/market/candles?instId={coin}-USDT-SWAP&bar={bar}&limit={limit}")[::-1]
    return [Candle(int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[6])) for r in rows if r[8] == "1"]


def main():
    print("=================================================================================================")
    print(f"📊 BẢNG THEO DÕI TOÀN BỘ 21 COIN TRỰC TIẾP TRÊN OKX ({datetime.now(VN).strftime('%H:%M %d/%m/%Y')})")
    print("=================================================================================================")
    print(f"{'Coin':<6} | {'Giá Live':<11} | {'24h %':<8} | {'Xu hướng 4h':<12} | {'Đỉnh 4h gần':<11} | {'Đáy 4h gần':<11} | {'Ghi chú / Setup'}")
    print("-" * 97)

    for coin in COINS:
        try:
            t = okx(f"/market/ticker?instId={coin}-USDT-SWAP")[0]
            price = float(t["last"])
            chg24 = (price / float(t["open24h"]) - 1) * 100

            cs = closed_candles(coin, "4H", 120)
            if not cs:
                continue
            ctx = build(cs)
            i = len(cs) - 1
            tr = trend(ctx, i)
            tr_str = {1: "🟢 TĂNG", -1: "🔴 GIẢM", 0: "⚪ ĐI NGANG"}[tr]

            hs = confirmed(ctx.highs, i, 3)
            ls = confirmed(ctx.lows, i, 3)
            last_h = cs[hs[-1]].h if hs else None
            last_l = cs[ls[-1]].l if ls else None

            # Kiểm tra khoảng cách tới BOS hoặc Neckline
            status = "-"
            if last_h and tr == 1:
                dist_bos = (last_h - price) / price * 100
                if 0 <= dist_bos <= 4.0:
                    status = f"Cách BOS Long {dist_bos:.1f}%"
            elif last_l and tr == -1:
                dist_bos = (price - last_l) / price * 100
                if 0 <= dist_bos <= 4.0:
                    status = f"Gần đáy {last_l:.4g}"

            h_str = f"{last_h:.4g}" if last_h else "-"
            l_str = f"{last_l:.4g}" if last_l else "-"

            print(f"{coin:<6} | {price:<11.4g} | {chg24:+7.2f}% | {tr_str:<12} | {h_str:<11} | {l_str:<11} | {status}")
            time.sleep(0.08)
        except Exception as e:
            print(f"{coin:<6} | Lỗi tải dữ liệu")

    print("=" * 97)


if __name__ == "__main__":
    main()

