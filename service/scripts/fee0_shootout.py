"""Owner's shootout (2026-10-14): manual trading is fee-free, only 2025 and 2026 matter.

Usage: python -m service.scripts.fee0_shootout

Reruns the three candidates with cost = slippage 0.04% round trip only (funding as each study models it), 2.5$/trade:
  swing    : 4H double top/bottom, trend + vol >= 2x, trailing 3 ATR, no TP, max 60 bars (trailing_study, live since 7499f60)
             + random control: random 4H bars of the same coin/year/side with trend agreement, same stop %, same exit
  intraday : FVG H1 -> 15m sweep, first entry only (fvg_mtf_study)
  intraday : resting limit 0.5 ATR below the 1H swing low, SL 1.5 ATR, TP previous swing high (sweep_limit_study)
Selection rule fixed before running: positive in 2025 AND 2026 separately, t >= 2 over 2025–26, beats the random control.
"""
import random

from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import build
from service.backtest.structure import atr_series
from service.scripts import fvg_mtf_study as F
from service.scripts import sweep_limit_study as S
from service.scripts import trailing_study as T
from service.scripts.rule_study import daily_trend, trend_at
from service.scripts.styles_study import resample, year_of

SLIP_ONLY = 0.0004
YEARS = (2025, 2026)


def trail3(cs, atr, f, s, e, st):
    return T.exit_trail(cs, atr, f, s, e, st, max_bars=60, mult=3.0)


def random_control(n_per, seed=11):
    """Same coin + year + side mix as the real trades, random entry bar where coin and BTC trend agree with the side."""
    rnd = random.Random(seed)
    btc = daily_trend(load("BTCUSDT-PERP", "1h", include_holdout=True))
    out = []
    for fp in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        sym = fp.name.split("_")[0]
        cs = resample(load(sym, "1h", include_holdout=True), 4)
        own, atr = daily_trend(load(sym, "1h", include_holdout=True)), atr_series(cs)
        for (y, side, risk), cnt in n_per.get(sym, {}).items():
            pool = [i for i in range(260, len(cs) - 62) if year_of(cs[i].t) == y
                    and trend_at(btc, cs[i].t + 4 * 3_600_000) == side == trend_at(own, cs[i].t + 4 * 3_600_000)]
            for _ in range(cnt):
                if not pool:
                    break
                i = rnd.choice(pool)
                f, entry = i + 1, cs[i + 1].o
                gross, k = trail3(cs, atr, f, side, entry, entry * (1 - side * risk))
                out.append({"year": y, "r": (gross - SLIP_ONLY - T.FUNDING_8H * (k - i) * 4 / 8) / risk})
    return out


def fixed_control(trades, tf, max_bars, seed=13):
    """Intraday control: market entry at a random bar of the same coin/year where the coin's daily trend agrees,
    same stop % and TP % as the real trade, stop first, same max hold."""
    rnd = random.Random(seed)
    out, cache = [], {}
    for tr in trades:
        if tr["sym"] not in cache:
            cs = load(tr["sym"], tf, include_holdout=True)
            own = daily_trend(load(tr["sym"], "1h", include_holdout=True))
            cache[tr["sym"]] = (cs, {(y, sd): [i for i in range(len(cs) - max_bars - 1) if year_of(cs[i].t) == y
                                               and trend_at(own, cs[i].t) == sd] for y in YEARS for sd in (1, -1)})
        cs, pools = cache[tr["sym"]]
        pool = pools[(tr["year"], tr["side"])]
        if not pool:
            continue
        i = rnd.choice(pool)
        side, entry = tr["side"], cs[i + 1].o
        stop, tp = entry * (1 - side * tr["risk"]), entry * (1 + side * tr["tp"])
        g = None
        for b in cs[i + 1 : i + 1 + max_bars]:
            if (b.l <= stop) if side > 0 else (b.h >= stop):
                g = -tr["risk"]; break
            if (b.h >= tp) if side > 0 else (b.l <= tp):
                g = tr["tp"]; break
        if g is None:
            g = side * (cs[i + max_bars].c / entry - 1)
        out.append({"year": tr["year"], "r": (g - SLIP_ONLY) / tr["risk"]})
    return out


def show(name, rs_by_year):
    allr = [r for y in YEARS for r in rs_by_year.get(y, [])]
    print(f"{name}")
    for y in YEARS:
        print(f"  {y}: {T.stats(rs_by_year.get(y, []))}")
    print(f"  25–26: {T.stats(allr)}")


def main():
    T.COST = SLIP_ONLY  # read at call time by trailing_study.trades and sweep_limit_study.run

    sw = [t for t in T.trades("trail", exit_fn=trail3) if t["style"] == "double_top_bottom" and t["year"] in YEARS]
    show("GIỮ LÂU · hai đỉnh/đáy 4H + trailing 3 ATR", {y: [t["r"] for t in sw if t["year"] == y] for y in YEARS})
    print(f"  tần suất: {len(sw) / 21:.1f} lệnh/tháng")
    n_per = {}
    for t in sw:
        key = (t["year"], t["side"], round(t["risk"], 3))
        n_per.setdefault(f"{t['sym']}-PERP", {}).setdefault(key, 0)
        n_per[f"{t['sym']}-PERP"][key] += 1
    rc = random_control(n_per)
    show("  ĐỐI CHỨNG vào ngẫu nhiên (cùng coin/năm/chiều/SL%, cùng trailing)", {y: [t["r"] for t in rc if t["year"] == y] for y in YEARS})

    fv = [t for t in F.run() if not t["re"] and t["year"] in YEARS]
    show("TRONG NGÀY · FVG 1H → quét 15m, lần vào đầu", {y: [(t["g"] - SLIP_ONLY) / t["risk"] for t in fv if t["year"] == y] for y in YEARS})
    print(f"  tần suất: {len(fv) / 21:.1f} lệnh/tháng")
    rc = fixed_control(fv, "15m", 96)
    show("  ĐỐI CHỨNG vào ngẫu nhiên (cùng coin/năm/chiều, cùng SL%/TP%)", {y: [t["r"] for t in rc if t["year"] == y] for y in YEARS})

    sl = [r for r in S.run(0.5, 1.5, "swing") if r["year"] in YEARS]
    show("TRONG NGÀY · Limit 0.5 ATR dưới đáy 1H, SL 1.5 ATR, TP đỉnh trước", {y: [r["r"] for r in sl if r["year"] == y] for y in YEARS})
    print(f"  tần suất: {len(sl) / 21:.1f} lệnh/tháng")
    rc = fixed_control(sl, "1h", 48)
    show("  ĐỐI CHỨNG vào ngẫu nhiên (cùng coin/năm/chiều, cùng SL%/TP%)", {y: [t["r"] for t in rc if t["year"] == y] for y in YEARS})


if __name__ == "__main__":
    main()
