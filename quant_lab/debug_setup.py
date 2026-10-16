import os
import json
import time

DATA_DIR = "quant_lab/data"

with open(os.path.join(DATA_DIR, "TIA_15m.json"), "r", encoding="utf-8") as f:
    cs = json.load(f)

# Find 15/10 21:00 VN candle
# 15/10 21:00 VN = 15/10 14:00 UTC = 1792072800000 ms
for i, c in enumerate(cs):
    vn_t = c["t"]/1000 + 7*3600
    d = time.gmtime(vn_t)
    if d.tm_mday == 15 and d.tm_hour == 21 and d.tm_min == 0:
        last = c
        prev20 = cs[i-20:i]
        avg_vol = sum(x["v"] for x in prev20) / len(prev20)
        rvol = last["v"] / avg_vol
        box = cs[i-36:i]
        box_hi = max(b["h"] for b in box)
        box_lo = min(b["l"] for b in box)
        box_range = box_hi - box_lo
        prior_hi = max(b["h"] for b in cs[max(0, i-144):i])
        dist_to_res = (prior_hi - last["c"]) / last["c"]
        rng = last["h"] - last["l"]
        body = abs(last["c"] - last["o"])
        upper_wick = last["h"] - last["c"]
        print(f"TIA at 15/10 21:00 VN:")
        print(f"  O: {last['o']}, H: {last['h']}, L: {last['l']}, C: {last['c']}, Vol: {last['v']}")
        print(f"  box_hi: {box_hi}, box_lo: {box_lo}, box_range: {box_range:.4f}")
        print(f"  box_range/box_lo: {box_range/box_lo:.4f} (0.003 - 0.055: {0.003 <= box_range/box_lo <= 0.055})")
        print(f"  rvol: {rvol:.2f} (>= 2.0: {rvol >= 2.0})")
        print(f"  prior_hi (144 bars): {prior_hi}")
        print(f"  dist_to_res: {dist_to_res:.4f} (>= 0.020: {dist_to_res >= 0.020})")
        print(f"  upper_wick: {upper_wick:.4f}, 0.20*rng: {0.20*rng:.4f} (wick <= 0.20*rng: {upper_wick <= 0.20*rng})")
        print(f"  body: {body:.4f}, 0.60*rng: {0.60*rng:.4f} (body >= 0.60*rng: {body >= 0.60*rng})")
        print(f"  last['c'] > box_hi: {last['c'] > box_hi}")

    # Also check 16/10 09:00 - 09:30 VN
    if d.tm_mday == 16 and d.tm_hour == 9 and d.tm_min in [0, 15, 30]:
        last = c
        rng = last["h"] - last["l"]
        recent_high = max(b["h"] for b in cs[i-40:i])
        is_pullback = (recent_high - last["c"]) / recent_high >= 0.03
        lower_wick = min(last["o"], last["c"]) - last["l"]
        local_swing_low = min(b["l"] for b in cs[i-8:i])
        print(f"\nTIA at 16/10 {d.tm_hour:02d}:{d.tm_min:02d} VN:")
        print(f"  O: {last['o']}, H: {last['h']}, L: {last['l']}, C: {last['c']}")
        print(f"  recent_high: {recent_high}, is_pullback >= 3%: {is_pullback}")
        print(f"  lower_wick: {lower_wick:.4f}, 0.35*rng: {0.35*rng:.4f} (wick >= 0.35*rng: {lower_wick >= 0.35*rng})")
        print(f"  local_swing_low: {local_swing_low}")
        print(f"  last['l'] <= local_swing_low + 0.003*local_swing_low: {last['l'] <= local_swing_low + 0.003*local_swing_low}")
