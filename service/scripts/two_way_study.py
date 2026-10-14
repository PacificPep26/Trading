"""Owner's two-way plan (2026-10-14): short the top in a short-term downtrend, cover at support, then
long the bounce at support, or short again if support breaks.

Usage: python -m service.scripts.two_way_study

1H, 21 bot coins, coin daily trend down (EMA50) and 1H structure down (lower high + lower low), 2025–2026,
fee 0 (manual trading), slippage 0.04% round trip + funding 0.01%/8h, 2.5$/trade, stop first, max 48 bars.
  leg 1  short: swing high just confirmed (W bars later). S = last confirmed swing low = support (TP), needs >= 1R.
         1a limit at the swing high (wait 24 bars, cancel if price reaches S first), SL high + 0.5 ATR
         1b market at the next open,                                                  SL high + 0.5 ATR
  after leg 1a reaches S, within 12 bars, whichever comes first:
  leg 2  long : a green 1H bar closes back above S -> next open, SL lowest low since the touch - 0.1 ATR,
                TP = halfway back to the swing high (needs >= 1R)
  leg 3  short: a 1H bar closes below S -> next open, SL max(bar high, S) + 0.1 ATR, TP 1.5R
Each leg is compared with random entries (same coin/year/daily trend/side, same SL% and TP%).
"""
from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import W, build, confirmed, trend
from service.scripts import fee0_shootout as X
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import year_of

H1 = 3_600_000
COST, FUND_8H, MAX_BARS = 0.0004, 0.0001, 48


def sim(cs, f, side, entry, stop, tp):
    """Gross return fraction and exit index; stop first inside a bar, from bar f on."""
    last = min(f + MAX_BARS - 1, len(cs) - 1)
    for k in range(f, last + 1):
        b = cs[k]
        if (b.l <= stop) if side > 0 else (b.h >= stop):
            px = b.o if ((b.o < stop) if side > 0 else (b.o > stop)) else stop
            return side * (px / entry - 1), k
        if (b.h >= tp) if side > 0 else (b.l <= tp):
            return side * (tp / entry - 1), k
    return side * (cs[last].c / entry - 1), last


def rec(out, leg, sym, cs, f, side, entry, stop, tp, own_tr):
    risk = abs(entry - stop) / entry
    if not 0.003 <= risk <= 0.06:
        return None
    g, k = sim(cs, f, side, entry, stop, tp)
    net = g - COST - FUND_8H * (k - f + 1) / 8
    out.append({"leg": leg, "sym": sym, "year": year_of(cs[f].t), "side": side, "risk": risk,
                "tp": abs(tp / entry - 1), "trend": own_tr, "r": net / risk})
    return g, k


def run():
    out = []
    for fp in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        sym = fp.name.split("_")[0]
        if sym.replace("USDT-PERP", "") not in LIVE_COINS:
            continue
        cs = load(sym, "1h", include_holdout=True)
        own, x = daily_trend(cs), build(cs)
        busy_a = busy_b = 0
        for sw in x.highs:
            start = sw + W  # the bar that confirms the swing high has just closed
            if start + 2 >= len(cs) or year_of(cs[start].t) < 2025:
                continue
            t = cs[start].t + H1
            if trend_at(own, t) != -1 or trend(x, start) != -1:
                continue
            lows = confirmed(x.lows, start, 1)
            if not lows:
                continue
            S, top, a = cs[lows[0]].l, cs[sw].h, x.atr[start]
            stop = top + 0.5 * a

            # 1b: market at the next open
            if start + 1 > busy_b:
                e = cs[start + 1].o
                if e < stop and e - S >= stop - e:
                    res = rec(out, "1b", sym, cs, start + 1, -1, e, stop, S, -1)
                    if res:
                        busy_b = res[1]

            # 1a: resting limit at the swing high
            if start + 1 <= busy_a or top - S < stop - top:
                continue
            fill = None
            for j in range(start + 1, min(start + 25, len(cs))):
                b = cs[j]
                if b.h >= top:
                    fill = j
                    break
                if b.l <= S:
                    break  # reached support without us
            if fill is None:
                continue
            e = max(top, cs[fill].o)
            res = rec(out, "1a", sym, cs, fill, -1, e, stop, S, -1)
            if not res:
                continue
            g, k = res
            busy_a = k
            if cs[k].l > S:
                continue  # leg 1 did not reach support (stopped or timed out)

            # legs 2 / 3: first event within 12 bars after the touch
            low = cs[k].l
            for j in range(k + 1, min(k + 13, len(cs) - 1)):
                b, aj = cs[j], x.atr[j]
                low = min(low, b.l)
                if b.c > S and b.c > b.o:
                    e = cs[j + 1].o
                    sl, tp = low - 0.1 * aj, S + (top - S) / 2
                    if e > sl and tp - e >= e - sl:
                        rec(out, "2", sym, cs, j + 1, 1, e, sl, tp, -1)
                    break
                if b.c < S:
                    e = cs[j + 1].o
                    sl = max(b.h, S) + 0.1 * aj
                    if sl > e:
                        rec(out, "3", sym, cs, j + 1, -1, e, sl, e - 1.5 * (sl - e), -1)
                    break
    return out


def main():
    tr = run()
    names = {"1a": "① SHORT Limit đúng đỉnh 1H", "1b": "① SHORT Market khi đỉnh 1H xác nhận",
             "2": "② LONG bật ở hỗ trợ sau khi short chốt", "3": "③ SHORT tiếp khi đóng thủng hỗ trợ"}
    for leg, name in names.items():
        g = [t for t in tr if t["leg"] == leg]
        X.show(name, {y: [t["r"] for t in g if t["year"] == y] for y in X.YEARS})
        rc = X.fixed_control(g, "1h", MAX_BARS)
        X.show("  đối chứng vào ngẫu nhiên", {y: [t["r"] for t in rc if t["year"] == y] for y in X.YEARS})
        print(f"  tần suất: {len(g) / 21:.1f} lệnh/tháng\n")


if __name__ == "__main__":
    main()
