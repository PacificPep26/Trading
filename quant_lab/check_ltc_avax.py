import os
import json
import time

DATA_DIR = "quant_lab/data"

def check_coin(coin):
    with open(os.path.join(DATA_DIR, f"{coin}_15m.json"), "r") as f:
        data = json.load(f)
    print(f"=== {coin} FROM 15/10 21:00 TO 16/10 12:00 ===")
    for c in data:
        vn_t = c["t"]/1000 + 7*3600
        d = time.gmtime(vn_t)
        if (d.tm_mday == 15 and d.tm_hour >= 21) or (d.tm_mday == 16 and d.tm_hour <= 12):
            if d.tm_min == 0 or d.tm_hour in [21, 22, 23, 8, 9, 10, 11, 12]:
                print(f"{d.tm_mday}/10 {d.tm_hour:02d}:{d.tm_min:02d} | O:{c['o']} H:{c['h']} L:{c['l']} C:{c['c']}")

check_coin("LTC")
check_coin("AVAX")

