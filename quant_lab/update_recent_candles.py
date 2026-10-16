import os
import json
import time
import sys
import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
COINS = ["BTC", "SOL", "TIA", "SUI", "LTC", "AVAX", "NEAR", "APT", "ARB", "INJ", "OP", "LINK", "DOT"]

def fetch_latest(coin: str):
    inst_id = f"{coin}-USDT-SWAP"
    url = "https://www.okx.com/api/v5/market/candles"
    params = {"instId": inst_id, "bar": "15m", "limit": "100"}
    try:
        res = requests.get(url, params=params, timeout=5)
        data = res.json()
        if data.get("code") == "0" and data.get("data"):
            rows = data["data"]
            candles = []
            for r in reversed(rows):
                candles.append({
                    "t": int(r[0]),
                    "o": float(r[1]),
                    "h": float(r[2]),
                    "l": float(r[3]),
                    "c": float(r[4]),
                    "v": float(r[5]),
                    "volCcy": float(r[6]) if len(r) > 6 else 0.0,
                })
            
            # Đọc file hiện tại và merge
            fpath = os.path.join(DATA_DIR, f"{coin}_15m.json")
            if os.path.exists(fpath):
                with open(fpath, "r", encoding="utf-8") as f:
                    old_cs = json.load(f)
                # Ghép theo timestamp
                existing_ts = {c["t"]: c for c in old_cs}
                for c in candles:
                    existing_ts[c["t"]] = c
                merged = sorted(list(existing_ts.values()), key=lambda x: x["t"])
                with open(fpath, "w", encoding="utf-8") as f:
                    json.dump(merged, f)
                print(f"[✓] {coin}: Cập nhật nến tới {time.strftime('%Y-%m-%d %H:%M', time.gmtime(merged[-1]['t']/1000 + 7*3600))} VN ({len(merged)} nến)")
    except Exception as e:
        print(f"[!] {coin} lỗi: {e}")

if __name__ == "__main__":
    print("[*] Đang cập nhật nến mới nhất tới 12:00 trưa nay...")
    for c in COINS:
        fetch_latest(c)
        time.sleep(0.05)
