import os, json

with open("quant_lab/data/TIA_15m.json") as f:
    tia_cs = json.load(f)
with open("quant_lab/data/LTC_15m.json") as f:
    ltc_cs = json.load(f)
with open("quant_lab/data/AVAX_15m.json") as f:
    avax_cs = json.load(f)

def eval_coin(name, cs):
    for i, c in enumerate(cs):
        if c["t"] == 1792072800000: # 15/10 21:00 VN
            last = c
            rng = last["h"] - last["l"]
            prev20 = cs[i-20:i]
            avg_vol = sum(x["v"] for x in prev20) / len(prev20)
            rvol = last["v"] / avg_vol
            pct_gain = (last["c"] - last["o"]) / last["o"]
            score = rvol * (1.0 + pct_gain * 10)
            upper_wick = last["h"] - last["c"]
            body = abs(last["c"] - last["o"])
            print(f"{name}: rvol={rvol:.2f}, pct_gain={pct_gain*100:.2f}%, score={score:.2f}")
            print(f"   upper_wick={upper_wick:.4f}, 0.25*rng={0.25*rng:.4f} (<= 0.25: {upper_wick <= 0.25*rng})")
            print(f"   body={body:.4f}, 0.60*rng={0.60*rng:.4f} (>= 0.60: {body >= 0.60*rng})")

eval_coin("TIA", tia_cs)
eval_coin("LTC", ltc_cs)
eval_coin("AVAX", avax_cs)

