"""
quant_lab/fetch_data.py
Script tải dữ liệu lịch sử nến 1H và 15m từ sàn OKX/MEXC cho AI Training Lab.
Tải tự động phân trang (pagination) để lấy 10.000 - 30.000 nến.
"""
import os
import json
import time
import requests
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)

COINS = [
    "TIA", "SUI", "SOL", "NEAR",
    "APT", "ARB", "INJ", "OP", "AVAX", "LINK", "DOT", "LTC", "BTC"
]

def fetch_okx_candles(inst_id: str, bar: str, total_bars: int = 4000):
    url = "https://www.okx.com/api/v5/market/candles"
    all_candles = []
    after = None
    
    print(f"[*] Fetching {inst_id} {bar} (Target: {total_bars} candles)...")
    
    while len(all_candles) < total_bars:
        params = {"instId": inst_id, "bar": bar, "limit": "100"}
        if after:
            params["after"] = str(after)
            
        try:
            res = requests.get(url, params=params, timeout=10)
            data = res.json()
            if data.get("code") != "0" or not data.get("data"):
                break
                
            batch = data["data"]
            if not batch:
                break
                
            for row in batch:
                all_candles.append({
                    "t": int(row[0]),
                    "o": float(row[1]),
                    "h": float(row[2]),
                    "l": float(row[3]),
                    "c": float(row[4]),
                    "v": float(row[5]),
                    "volCcy": float(row[6]) if len(row) > 6 else 0.0,
                })
                
            after = batch[-1][0]
            time.sleep(0.08) # Rate limit protection
            print(f"    -> Loaded {len(all_candles)}/{total_bars} candles...", end="\r")
        except Exception as e:
            print(f"\n[!] Connection error: {e}")
            break
            
    print(f"\n[+] Completed {inst_id} {bar}: {len(all_candles)} candles.")
    all_candles.sort(key=lambda x: x["t"])
    return all_candles

def main():
    print(f"[*] Starting download for {len(COINS)} coins...")
    for coin in COINS:
        inst_id = f"{coin}-USDT-SWAP"
        for bar in ["1H", "15m"]:
            out_path = os.path.join(DATA_DIR, f"{coin}_{bar}.json")
            if os.path.exists(out_path):
                print(f"    [SKIP] {coin}_{bar}.json already exists.")
                continue
            candles = fetch_okx_candles(inst_id, bar, total_bars=4000)
            if candles:
                with open(out_path, "w", encoding="utf-8") as f:
                    json.dump(candles, f)
                print(f"    -> Saved successfully to {out_path} ({len(candles)} candles)")

if __name__ == "__main__":
    main()

