"""Scan all 21 coins on OKX live market right now according to the new disciplined rules:
1. 4H: BOS LONG & Double Top SHORT (triggered & pending)
2. 1H: Double Top SHORT (just triggered at recent closed bars)
"""
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from service.backtest.data import Candle
from service.backtest.patterns import STYLES, build

COINS = [
    "BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK",
    "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"
]
VN = timezone(timedelta(hours=7))


def okx(path):
    req = urllib.request.Request("https://www.okx.com/api/v5" + path, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.load(res)["data"]


def closed_candles(coin, bar, limit=200):
    rows = okx(f"/market/candles?instId={coin}-USDT-SWAP&bar={bar}&limit={limit}")[::-1]
    return [Candle(int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[6])) for r in rows if r[8] == "1"]


def scan_live():
    print("==========================================================================")
    print(f"🔎 QUÉT THỊ TRƯỜNG TRỰC TIẾP OKX LÚC {datetime.now(VN).strftime('%H:%M:%S %d/%m/%Y')}")
    print("==========================================================================")

    # 1. Quét nến 1H cho Hai đỉnh SHORT
    print("\n--- ⚡ [KHUNG 1H]: TÌM SETUP HAI ĐỈNH SHORT (LƯỚT NHANH MEXC) ---")
    h1_hits = []
    for coin in COINS:
        try:
            cs = closed_candles(coin, "1H", 150)
            if not cs:
                continue
            ctx = build(cs)
            i = len(cs) - 1
            # Check last 2 closed 1h bars
            for ago in range(2):
                det = STYLES["double_top_bottom"][1]
                s = det(ctx, i - ago)
                if s and s["side"] < 0:
                    entry = s.get("entry") or cs[i - ago].c
                    stop = s["stop"]
                    risk = abs(entry - stop) / entry
                    r = abs(entry - stop)
                    tp05 = entry - 0.5 * r
                    tp075 = entry - 0.75 * r
                    h1_hits.append({
                        "coin": coin, "ago": ago, "close_time": datetime.fromtimestamp(cs[i - ago].t / 1000, VN).strftime('%H:%M %d/%m'),
                        "price": cs[i].c, "entry": entry, "stop": stop, "risk_pct": risk * 100,
                        "tp05": tp05, "tp075": tp075
                    })
            time.sleep(0.08)
        except Exception as e:
            pass

    if h1_hits:
        for hit in h1_hits:
            print(f"🔥 {hit['coin']} HAI ĐỈNH 🔴 SHORT (Nến đóng lúc {hit['close_time']})")
            print(f"   • Giá hiện tại: {hit['price']:.4f} | Entry chuẩn: {hit['entry']:.4f} | SL: {hit['stop']:.4f} ({hit['risk_pct']:.2f}%)")
            print(f"   • TP 0.5R: {hit['tp05']:.4f} | TP 0.75R: {hit['tp075']:.4f}\n")
    else:
        print("-> Hiện tại không có coin nào có Hai đỉnh SHORT vừa kích hoạt ở nến 1h gần nhất.")

    # 2. Quét nến 4H cho BOS LONG & Hai đỉnh SHORT
    print("\n--- 🏹 [KHUNG 4H]: TÌM SETUP BOS LONG & HAI ĐỈNH SHORT ---")
    h4_hits = []
    h4_pending = []

    for coin in COINS:
        try:
            cs = closed_candles(coin, "4H", 200)
            if not cs:
                continue
            ctx = build(cs)
            i = len(cs) - 1
            cur_price = cs[i].c

            # Check triggered in last 2 closed 4h bars (7h hoặc 11h sáng nay)
            for ago in range(2):
                # BOS LONG
                s_bos = STYLES["bos"][1](ctx, i - ago)
                if s_bos and s_bos["side"] > 0:
                    entry = s_bos.get("entry") or cs[i - ago].c
                    stop = s_bos["stop"]
                    risk = abs(entry - stop) / entry
                    h4_hits.append({
                        "coin": coin, "type": "BOS 🟢 LONG", "ago": ago,
                        "time": datetime.fromtimestamp(cs[i - ago].t / 1000, VN).strftime('%H:%M %d/%m'),
                        "price": cur_price, "entry": entry, "stop": stop, "risk": risk * 100
                    })

                # Double Top SHORT
                s_dt = STYLES["double_top_bottom"][1](ctx, i - ago)
                if s_dt and s_dt["side"] < 0:
                    entry = s_dt.get("entry") or cs[i - ago].c
                    stop = s_dt["stop"]
                    risk = abs(entry - stop) / entry
                    h4_hits.append({
                        "coin": coin, "type": "Hai đỉnh 🔴 SHORT", "ago": ago,
                        "time": datetime.fromtimestamp(cs[i - ago].t / 1000, VN).strftime('%H:%M %d/%m'),
                        "price": cur_price, "entry": entry, "stop": stop, "risk": risk * 100
                    })

            time.sleep(0.08)
        except Exception as e:
            pass

    if h4_hits:
        for hit in h4_hits:
            print(f"🎯 {hit['coin']} {hit['type']} (Nến 4h đóng lúc {hit['time']})")
            print(f"   • Giá hiện tại: {hit['price']:.4f} | Entry: {hit['entry']:.4f} | SL: {hit['stop']:.4f} ({hit['risk']:.2f}%)\n")
    else:
        print("-> Nến 4h đóng gần nhất (lúc 11h trưa) không có coin nào xuất hiện BOS LONG hoặc Hai đỉnh SHORT.")

    # 3. Xem xét các coin chủ đạo: BTC, SOL, ETH hiện trạng
    print("\n--- 📊 HIỆN TRẠNG 3 ĐỒNG CHÍNH (BTC, ETH, SOL) ---")
    for coin in ["BTC", "ETH", "SOL"]:
        ticker = okx(f"/market/ticker?instId={coin}-USDT-SWAP")[0]
        cs4 = closed_candles(coin, "4H", 60)
        c4 = cs4[-1]
        print(f"• {coin}: Giá {ticker['last']} | 24h {float(ticker['last'])/float(ticker['open24h'])*100 - 100:+.2f}% | Nến 4h gần nhất đóng {c4.c:.2f}")


if __name__ == "__main__":
    scan_live()

