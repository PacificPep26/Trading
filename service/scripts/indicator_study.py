"""Classic indicators from the owner's reading list (Investopedia / CMC 2026-10-12): ADX, MACD, Stochastic, OBV, Aroon.

Usage: python -m service.scripts.indicator_study

A) As an extra filter on the live 4h double top/bottom (trend + vol >= 2x, trailing 3 ATR): split trades by indicator state.
B) As standalone 4h entries in the daily trend direction (coin + BTC vs EMA50), market at next open,
   SL 2 ATR, exit trailing 3 ATR (max 60 bars). Costs as trailing_study.
"""
from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import STYLES, build
from service.backtest.structure import atr_series
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import resample, year_of
from service.scripts import trailing_study as T


def ema(xs, n):
    out, e = [], xs[0]
    for x in xs:
        e += 2 / (n + 1) * (x - e)
        out.append(e)
    return out


def indicators(cs):
    n = len(cs)
    # ADX(14), Wilder
    adx, pdi, mdi = [0.0] * n, [0.0] * n, [0.0] * n
    tr_s = p_s = m_s = dx_s = 0.0
    for i in range(1, n):
        c, p = cs[i], cs[i - 1]
        up, dn = c.h - p.h, p.l - c.l
        pdm = up if up > dn and up > 0 else 0.0
        mdm = dn if dn > up and dn > 0 else 0.0
        tr = max(c.h - c.l, abs(c.h - p.c), abs(c.l - p.c))
        tr_s, p_s, m_s = tr_s - tr_s / 14 + tr, p_s - p_s / 14 + pdm, m_s - m_s / 14 + mdm
        if tr_s:
            pdi[i], mdi[i] = 100 * p_s / tr_s, 100 * m_s / tr_s
        s = pdi[i] + mdi[i]
        dx = 100 * abs(pdi[i] - mdi[i]) / s if s else 0.0
        dx_s = dx_s + (dx - dx_s) / 14
        adx[i] = dx_s
    closes = [c.c for c in cs]
    macd = [a - b for a, b in zip(ema(closes, 12), ema(closes, 26))]
    sig = ema(macd, 9)
    # Stochastic %K(14) smoothed 3, %D 3
    k_raw = []
    for i in range(n):
        lo = min(c.l for c in cs[max(0, i - 13): i + 1]); hi = max(c.h for c in cs[max(0, i - 13): i + 1])
        k_raw.append(50.0 if hi == lo else 100 * (cs[i].c - lo) / (hi - lo))
    k = [sum(k_raw[max(0, i - 2): i + 1]) / len(k_raw[max(0, i - 2): i + 1]) for i in range(n)]
    d = [sum(k[max(0, i - 2): i + 1]) / len(k[max(0, i - 2): i + 1]) for i in range(n)]
    obv = [0.0] * n
    for i in range(1, n):
        obv[i] = obv[i - 1] + (cs[i].v if cs[i].c > cs[i - 1].c else -cs[i].v if cs[i].c < cs[i - 1].c else 0)
    aup, adn = [0.0] * n, [0.0] * n
    for i in range(25, n):
        w = cs[i - 25: i + 1]
        aup[i] = 100 * (25 - (25 - max(range(26), key=lambda j: w[j].h))) / 25
        adn[i] = 100 * (25 - (25 - min(range(26), key=lambda j: w[j].l))) / 25
    return {"adx": adx, "pdi": pdi, "mdi": mdi, "macd": macd, "sig": sig, "k": k, "d": d, "obv": obv, "aup": aup, "adn": adn}


def signal(name, ind, cs, i, side):
    m, s, k, d = ind["macd"], ind["sig"], ind["k"], ind["d"]
    if name == "MACD cắt signal":
        return (m[i - 1] <= s[i - 1] and m[i] > s[i]) if side > 0 else (m[i - 1] >= s[i - 1] and m[i] < s[i])
    if name == "Stoch hồi về <20/>80 rồi cắt lên/xuống":
        return (k[i - 1] <= d[i - 1] and k[i] > d[i] and min(k[i - 1], d[i - 1]) < 20) if side > 0 else \
               (k[i - 1] >= d[i - 1] and k[i] < d[i] and max(k[i - 1], d[i - 1]) > 80)
    if name == "ADX>25 và DI cắt":
        p, q = ind["pdi"], ind["mdi"]
        cross = (p[i - 1] <= q[i - 1] and p[i] > q[i]) if side > 0 else (q[i - 1] <= p[i - 1] and q[i] > p[i])
        return cross and ind["adx"][i] > 25
    if name == "Aroon cắt":
        u, w = ind["aup"], ind["adn"]
        return (u[i - 1] <= w[i - 1] and u[i] > w[i]) if side > 0 else (w[i - 1] <= u[i - 1] and w[i] > u[i])
    if name == "OBV phân kỳ (giá đáy thấp hơn, OBV đáy cao hơn)":
        lb = 20
        if side > 0:
            return cs[i].l < min(c.l for c in cs[i - lb: i]) and ind["obv"][i] > min(ind["obv"][i - lb: i])
        return cs[i].h > max(c.h for c in cs[i - lb: i]) and ind["obv"][i] < max(ind["obv"][i - lb: i])
    return False


NAMES = ["MACD cắt signal", "Stoch hồi về <20/>80 rồi cắt lên/xuống", "ADX>25 và DI cắt", "Aroon cắt",
         "OBV phân kỳ (giá đáy thấp hơn, OBV đáy cao hơn)"]


def main():
    btc = daily_trend(load("BTCUSDT-PERP", "1h", include_holdout=True))
    filt = {"ADX>25": [], "ADX<=25": [], "MACD cùng chiều": [], "MACD ngược": [], "OBV dốc cùng chiều": [], "OBV ngược": []}
    solo = {n: [] for n in NAMES}
    for fp in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        c1 = load(fp.name.split("_")[0], "1h", include_holdout=True)
        own, cs = daily_trend(c1), resample(c1, 4)
        x, atr, ind = build(cs), atr_series(cs), indicators(cs)
        busy_f, busy = 0, {n: 0 for n in NAMES}
        for i in range(260, len(cs) - 2):
            t = cs[i].t + 4 * 3_600_000
            tb, to = trend_at(btc, t), trend_at(own, t)
            if tb == 0 or tb != to:
                continue
            side = tb
            f, entry = i + 1, cs[i + 1].o
            # A) filter on the live setup
            s = STYLES["double_top_bottom"][1](x, i)
            if s and s["side"] == side and i > busy_f and x.vol_avg[i] and cs[i].v / x.vol_avg[i] >= 2.0:
                risk = side * (entry - s["stop"]) / entry
                if 0.004 <= risk <= 0.08:
                    g, k = T.exit_trail(cs, atr, f, side, entry, s["stop"], max_bars=60, mult=3.0)
                    tr = {"year": year_of(cs[f].t), "r": (g - T.COST - T.FUNDING_8H * (k - i) / 2) / risk}
                    filt["ADX>25" if ind["adx"][i] > 25 else "ADX<=25"].append(tr)
                    filt["MACD cùng chiều" if side * (ind["macd"][i] - ind["sig"][i]) > 0 else "MACD ngược"].append(tr)
                    filt["OBV dốc cùng chiều" if side * (ind["obv"][i] - ind["obv"][i - 10]) > 0 else "OBV ngược"].append(tr)
                    busy_f = k
            # B) standalone entries
            stop = entry - side * 2 * atr[i]
            risk = 2 * atr[i] / entry
            if not 0.004 <= risk <= 0.08:
                continue
            for n in NAMES:
                if i > busy[n] and signal(n, ind, cs, i, side):
                    g, k = T.exit_trail(cs, atr, f, side, entry, stop, max_bars=60, mult=3.0)
                    solo[n].append({"year": year_of(cs[f].t), "r": (g - T.COST - T.FUNDING_8H * (k - i) / 2) / risk})
                    busy[n] = k

    def show(title, groups):
        print(title)
        for name, tr in groups.items():
            a = [t["r"] for t in tr if t["year"] <= 2024]; b = [t["r"] for t in tr if t["year"] >= 2025]
            print(f"  {name:48s} 23–24 {T.stats(a)}\n  {'':48s} 25–26 {T.stats(b)}")
    show("A) Lọc thêm cho hai đỉnh/đáy live (trailing 3 ATR)", filt)
    show("B) Tín hiệu riêng thuận xu hướng ngày (SL 2 ATR, trailing 3 ATR)", solo)


if __name__ == "__main__":
    main()
