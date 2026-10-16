import os
import json
import time

DATA_DIR = "quant_lab/data"
with open(os.path.join(DATA_DIR, "TIA_15m.json"), "r", encoding="utf-8") as f:
    cs = json.load(f)

with open(os.path.join(DATA_DIR, "BTC_15m.json"), "r", encoding="utf-8") as f:
    btc_cs = json.load(f)

def test_time(target_day, target_hour, target_min):
    for i, c in enumerate(cs):
        vn_t = c["t"]/1000 + 7*3600
        d = time.gmtime(vn_t)
        if d.tm_mday == target_day and d.tm_hour == target_hour and d.tm_min == target_min:
            cur_t = c["t"]
            last = c
            rng = last["h"] - last["l"]
            
            # Check BTC
            btc_history = [b for b in btc_cs if b["t"] <= cur_t]
            btc_dumping = False
            if len(btc_history) >= 20:
                last_btc = btc_history[-1]
                if (last_btc["c"] - last_btc["o"]) / last_btc["o"] <= -0.005:
                    btc_dumping = True
            
            prev20 = cs[i-20:i]
            avg_vol = sum(x["v"] for x in prev20) / len(prev20) if prev20 else 1.0
            rvol = last["v"] / avg_vol
            
            box = cs[i-36:i]
            box_hi = max(b["h"] for b in box)
            box_lo = min(b["l"] for b in box)
            box_range = box_hi - box_lo
            
            prior_hi = max(b["h"] for b in cs[max(0, i-144):i])
            body = abs(last["c"] - last["o"])
            upper_wick = last["h"] - last["c"]
            dist_to_res = (prior_hi - last["c"]) / last["c"]
            
            print(f"=== CHECKING TIA AT {target_day}/10 {target_hour:02d}:{target_min:02d} VN ===")
            print(f"BTC dumping: {btc_dumping}")
            print(f"Candle: O:{last['o']} H:{last['h']} L:{last['l']} C:{last['c']} Vol:{last['v']}")
            
            # KÈO 1: BREAKOUT
            cond_box = 0.003 <= (box_range / box_lo) <= 0.055
            cond_rvol = rvol >= 2.0
            cond_c_gt_box_hi = last["c"] > box_hi
            cond_body = body >= 0.60 * rng
            cond_wick_020 = upper_wick <= 0.20 * rng
            cond_wick_025 = upper_wick <= 0.25 * rng
            cond_dist = dist_to_res >= 0.020
            print(f"--- Kèo 1 Breakout ---")
            print(f"  box_range/box_lo: {box_range/box_lo:.4f} -> {cond_box}")
            print(f"  rvol: {rvol:.2f} -> {cond_rvol}")
            print(f"  c > box_hi ({box_hi}): {cond_c_gt_box_hi}")
            print(f"  dist_to_res: {dist_to_res:.4f} -> {cond_dist}")
            print(f"  body >= 0.60*rng: {cond_body}")
            print(f"  wick <= 0.20*rng: {cond_wick_020}")
            print(f"  wick <= 0.25*rng: {cond_wick_025}")
            
            # KÈO 2: SUPPORT BOUNCE
            recent_high = max(b["h"] for b in cs[i-40:i])
            is_pullback = (recent_high - last["c"]) / recent_high >= 0.03
            lower_wick = min(last["o"], last["c"]) - last["l"]
            cond_reversal = (lower_wick >= 0.35 * rng or (last["c"] > last["o"] and last["c"] > cs[i-1]["c"]))
            local_swing_low = min(b["l"] for b in cs[i-8:i])
            cond_near_low = last["l"] <= local_swing_low + 0.003 * local_swing_low
            entry = last["c"]
            sl = min(local_swing_low, last["l"]) - 0.002 * last["l"]
            risk = entry - sl
            cond_risk = 0.004 <= risk / entry <= 0.025
            print(f"--- Kèo 2 Support Bounce ---")
            print(f"  recent_high: {recent_high}")
            print(f"  is_pullback >= 3%: {is_pullback} ({(recent_high - last['c']) / recent_high * 100:.2f}%)")
            print(f"  cond_reversal: {cond_reversal} (c_gt_o: {last['c'] > last['o']}, c_gt_prev: {last['c'] > cs[i-1]['c']})")
            print(f"  local_swing_low: {local_swing_low}, last['l']: {last['l']}")
            print(f"  cond_near_low: {cond_near_low}")
            print(f"  entry: {entry}, sl: {sl:.4f}, risk: {risk:.4f} ({risk/entry*100:.2f}%) -> {cond_risk}")

test_time(15, 21, 0)
test_time(16, 9, 0)
test_time(16, 9, 15)
test_time(16, 9, 30)
