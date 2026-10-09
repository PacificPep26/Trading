"""Long the bounce after a crash (4h): does it pay? Usage: python -m service.scripts.bounce_long_study"""
import math
from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import build, rejection
from service.scripts.styles_study import resample, execute
FEE=0.0004+0.0004
def stats(name,v):
    n=len(v); m=sum(a for a,_ in v)/n; sd=math.sqrt(sum((a-m)**2 for a,_ in v)/(n-1))
    t26=[a for a,y in v if y>=2026]
    print(f"{name:58s} n={n:5d} thắng {sum(a>0 for a,_ in v)/n:.0%} TB {m:+.3f}R t={m/(sd/math.sqrt(n)):+.1f} 2026 {sum(t26)/max(1,len(t26)):+.3f}R")
res={k:[] for k in ("A","B","C")}
for f in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
    cs=resample(load(f.name.split("_")[0],"1h",include_holdout=True),4); x=build(cs); busy={k:0 for k in res}
    for i in range(260,len(cs)-2):
        c=cs[i]; drop=cs[i].c/max(b.h for b in cs[i-12:i+1])-1   # fall from 48h high
        oversold = x.rsi[i-1]<25 or x.rsi[i]<25
        conds={
          "A": oversold and c.c>c.o,                               # RSI4h<25 then first green 4h candle
          "B": drop<=-0.08 and rejection(c,1),                      # fell >=8% in 48h, 4h rejection (long wick)
          "C": drop<=-0.08 and c.c>cs[i-1].h,                       # fell >=8%, 4h close above previous candle high
        }
        for k,ok in conds.items():
            if not ok or i<=busy[k]: continue
            low=min(b.l for b in cs[i-3:i+1]); s={"side":1,"stop":low-0.1*x.atr[i]}
            ref=cs[i+1].o; R=ref-s["stop"]
            r=execute(cs,i,s,ref+1.5*R,12,(0.004,0.08))
            if r: res[k].append(((r[0]-FEE)/r[1],r[3])); busy[k]=r[4]
stats("A: RSI 4h < 25 rồi nến 4h xanh đầu tiên → LONG",res["A"])
stats("B: giảm ≥8% trong 48h + nến 4h rút râu dưới → LONG",res["B"])
stats("C: giảm ≥8% trong 48h + nến 4h đóng trên đỉnh nến trước → LONG",res["C"])
