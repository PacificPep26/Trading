import os, json, time

with open("quant_lab/data/BTC_15m.json", "r") as f:
    btc_cs = json.load(f)

print("=== BTC ON 15/10 FROM 10:00 TO 22:00 VN ===")
for c in btc_cs:
    vn_t = c["t"]/1000 + 7*3600
    d = time.gmtime(vn_t)
    if d.tm_mday == 15 and 10 <= d.tm_hour <= 22:
        tstr = f"{d.tm_hour:02d}:{d.tm_min:02d}"
        ret = (c['c'] - c['o']) / c['o'] * 100
        print(f"{tstr} | O:{c['o']:<8} H:{c['h']:<8} L:{c['l']:<8} C:{c['c']:<8} | Change: {ret:>+5.2f}% | Vol: {c['v']:>8,.1f}")

