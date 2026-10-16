import json
import time

with open('quant_lab/data/TIA_15m.json', 'r', encoding='utf-8') as f:
    candles = json.load(f)

print('=== TIA YESTERDAY EVENING (15/10 20:00 - 23:30 VN) ===')
for c in candles:
    vn_t = c['t']/1000 + 7*3600
    d = time.gmtime(vn_t)
    if d.tm_mday == 15 and 20 <= d.tm_hour <= 23:
        tstr = time.strftime('%H:%M', d)
        print(f"{tstr} | O:{c['o']:<7} H:{c['h']:<7} L:{c['l']:<7} C:{c['c']:<7} | Vol: {c['v']:>9,.0f}")

print('\n=== TIA TODAY MORNING (16/10 08:00 - 12:00 VN) ===')
for c in candles:
    vn_t = c['t']/1000 + 7*3600
    d = time.gmtime(vn_t)
    if d.tm_mday == 16 and 8 <= d.tm_hour <= 12:
        tstr = time.strftime('%H:%M', d)
        print(f"{tstr} | O:{c['o']:<7} H:{c['h']:<7} L:{c['l']:<7} C:{c['c']:<7} | Vol: {c['v']:>9,.0f}")
