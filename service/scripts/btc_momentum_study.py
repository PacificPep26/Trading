"""Owner's idea (2026-10-13): BTC prints a few long, strong 15m candles in a row -> trade the continuation (BTC + alts).

Usage: python -m service.scripts.btc_momentum_study

Trigger on BTC 15m: N consecutive same-colour bars (N = 2, 3), each body >= 60% of its range and >= K x ATR14(15m)
(K = 0.8, 1.2), total move over the N bars >= 0.6%. Cooldown 8 bars. Direction = the bars' colour.
Measured for BTC and the 20 alts the bot scans: forward move in that direction from the next 15m open after
15m / 30m / 1h / 2h, and fixed TP/SL scalps (max 2h, stop first) after costs 0.2% round trip.
"""
from service.backtest.data import DATA_DIR, load
from service.backtest.structure import atr_series
from service.scripts import trailing_study as T
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.styles_study import year_of


def triggers(b, n, k):
    atr, out, cool = atr_series(b), [], 0
    for i in range(20, len(b)):
        if i < cool:
            continue
        bars = b[i - n + 1 : i + 1]
        side = 1 if bars[0].c > bars[0].o else -1
        ok = all((c.c > c.o) == (side > 0) and abs(c.c - c.o) >= 0.6 * (c.h - c.l) and abs(c.c - c.o) >= k * atr[i - n] for c in bars)
        if ok and side * (bars[-1].c / bars[0].o - 1) >= 0.006:
            out.append((i, side)); cool = i + 8
    return out


def main():
    btc = load("BTCUSDT-PERP", "15m", include_holdout=True)
    data = {}
    for fp in sorted(DATA_DIR.glob("*-PERP_15m.csv")):
        name = fp.name.split("_")[0]
        if name.replace("USDT-PERP", "") in LIVE_COINS:
            cs = load(name, "15m", include_holdout=True)
            data[name.replace("USDT-PERP", "")] = (cs, {c.t: j for j, c in enumerate(cs)})
    avg = lambda xs: sum(xs) / len(xs) * 100 if xs else 0.0
    for n in (2, 3):
        for k in (0.8, 1.2):
            trig = triggers(btc, n, k)
            fwd = {m: {"old": [], "new": []} for m in (1, 2, 4, 8)}
            grid = {(tp, sl): {"old": [], "new": []} for tp in (0.004, 0.008) for sl in (0.004, 0.008)}
            for i, side in trig:
                t, per = btc[i].t, ("old" if year_of(btc[i].t) <= 2024 else "new")
                for cs, idx in data.values():
                    j = idx.get(t)
                    if j is None or j + 9 >= len(cs):
                        continue
                    e = cs[j + 1].o
                    for m in fwd:
                        fwd[m][per].append(side * (cs[j + m].c / e - 1))
                    for (tp, sl), acc in grid.items():
                        g = side * (cs[j + 8].c / e - 1)
                        for c in cs[j + 1 : j + 9]:
                            if ((c.h / e - 1) if side < 0 else (1 - c.l / e)) >= sl:
                                g = -sl; break
                            if ((1 - c.l / e) if side < 0 else (c.h / e - 1)) >= tp:
                                g = tp; break
                        acc[per].append(g - T.COST)
            print(f"== {n} nến mạnh liên tiếp, thân ≥ {k} ATR: {len(trig)} lần ({sum(s < 0 for _, s in trig)} rơi / {sum(s > 0 for _, s in trig)} tăng)")
            print("  đi tiếp (chưa phí): " + " | ".join(f"{m * 15}p {avg(v['old']):+.3f}%/{avg(v['new']):+.3f}%" for m, v in fwd.items()))
            print("  lướt sau phí 0.2%:  " + " | ".join(f"TP{tp * 100:.1f}/SL{sl * 100:.1f} {avg(v['old']):+.3f}%/{avg(v['new']):+.3f}%" for (tp, sl), v in grid.items()))


if __name__ == "__main__":
    main()
