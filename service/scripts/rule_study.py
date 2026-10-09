"""The agreed rule, re-tested with real costs, plus a 40$ account simulation.

Usage: python -m service.scripts.rule_study

Rule (PLAN.md, 2026-10-09):
- 4h BOS: LONG only
- 4h double top / bottom: only in the direction of the daily trend
  (daily close vs daily EMA50, for BTC and for the coin; both must agree with the trade)
Execution: market entry at the next 4h open, stop at the 4h structure, target 1.5R, max hold 12 bars (48h),
stop first inside a bar (styles_study.execute).
Costs: fee round trip (OKX taker 0.10%, MEXC ~0.04%) + slippage 0.02%/side + funding 0.01% per 8h held,
charged against the trade (longs usually pay in crypto perps).
Account: start 40$, every trade risks a fixed amount (3$) or a fixed % of equity (7.5%), trades in time order
(several coins can be open at once; equity updates at exit). Reports drawdown and losing streaks.
"""
import bisect
import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import STYLES, build
from service.scripts.styles_study import execute, resample

VN = timezone(timedelta(hours=7))
H4 = 4 * 3_600_000
FEES = {"OKX": 0.0010, "MEXC": 0.0004}
SLIP = 0.0004  # round trip
FUNDING_8H = 0.0001


def daily_trend(c1):
    d = resample(c1, 24)
    ema, ts, st = d[0].c, [], []
    for c in d:
        ema += 2 / 51 * (c.c - ema)
        ts.append(c.t + 86_400_000)  # known when the day closes
        st.append(1 if c.c > ema else -1)
    return ts, st


def trend_at(tr, t):
    i = bisect.bisect_right(tr[0], t) - 1
    return tr[1][i] if i >= 50 else 0


def signals():
    btc = daily_trend(load("BTCUSDT-PERP", "1h", include_holdout=True))
    out = []
    for f in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        sym = f.name.split("-PERP")[0]
        c1 = load(f.name.split("_")[0], "1h", include_holdout=True)
        own = daily_trend(c1)
        cs = resample(c1, 4)
        x = build(cs)
        busy = 0
        for i in range(260, len(cs) - 2):
            if i <= busy:
                continue
            for key in ("bos", "double_top_bottom"):
                s = STYLES[key][1](x, i)
                if not s:
                    continue
                side = s["side"]
                t = cs[i].t + H4
                if key == "bos" and side < 0:
                    continue
                if key == "double_top_bottom" and not (trend_at(btc, t) == side and trend_at(own, t) == side):
                    continue
                ref = cs[i + 1].o
                R = abs(ref - s["stop"])
                r = execute(cs, i, s, ref + side * 1.5 * R, 12, (0.004, 0.08))
                if not r:
                    continue
                gross, risk, _, year, k = r
                hold_h = (k - i) * 4
                out.append({"sym": sym, "style": key, "side": side, "gross": gross, "risk": risk, "year": year,
                            "t_in": cs[i + 1].t, "t_out": cs[k].t + H4, "hold_h": hold_h})
                busy = k
                break
    return out


def net_r(tr, fee):
    cost = fee + SLIP + FUNDING_8H * tr["hold_h"] / 8
    return (tr["gross"] - cost) / tr["risk"]


def stats(rs):
    n = len(rs)
    if n < 2:
        return f"n={n}"
    m = sum(rs) / n
    sd = math.sqrt(sum((x - m) ** 2 for x in rs) / (n - 1))
    return f"n={n:4d} thắng {sum(x > 0 for x in rs) / n:.0%} TB {m:+.3f}R t={m / (sd / math.sqrt(n)):+.1f}"


def account(trades, fee, mode, value):
    eq, peak, mdd, streak, worst_streak, low = 40.0, 40.0, 0.0, 0, 0, 40.0
    by_year = defaultdict(float)
    for tr in sorted(trades, key=lambda x: x["t_out"]):
        risk_usd = value if mode == "fixed" else eq * value
        if eq < 1:
            break
        pnl = risk_usd * net_r(tr, fee)
        eq += pnl
        by_year[tr["year"]] += pnl
        peak = max(peak, eq)
        low = min(low, eq)
        mdd = max(mdd, 1 - eq / peak)
        streak = streak + 1 if pnl < 0 else 0
        worst_streak = max(worst_streak, streak)
    years = " ".join(f"{y}:{v:+.0f}$" for y, v in sorted(by_year.items()))
    return f"cuối {eq:7.1f}$ | thấp nhất {low:5.1f}$ | sụt vốn tối đa {mdd:.0%} | chuỗi thua dài nhất {worst_streak} | {years}"


def main():
    tr = signals()
    span_days = (max(t["t_out"] for t in tr) - min(t["t_in"] for t in tr)) / 86_400_000
    print(f"{len(tr)} lệnh trong {span_days:.0f} ngày (~{len(tr) / span_days * 7:.1f} lệnh/tuần), giữ TB {sum(t['hold_h'] for t in tr) / len(tr):.0f} giờ\n")
    for fee_name, fee in FEES.items():
        print(f"== phí {fee_name} ({fee * 100:.2f}% khứ hồi) + trượt 0,04% + funding 0,01%/8h")
        groups = {
            "TẤT CẢ (luật mới)": tr,
            "BOS LONG": [t for t in tr if t["style"] == "bos"],
            "Hai đáy LONG (BTC & coin trên EMA50 ngày)": [t for t in tr if t["style"] == "double_top_bottom" and t["side"] > 0],
            "Hai đỉnh SHORT (BTC & coin dưới EMA50 ngày)": [t for t in tr if t["style"] == "double_top_bottom" and t["side"] < 0],
        }
        for name, g in groups.items():
            rs = [net_r(t, fee) for t in g]
            print(f"  {name:44s} {stats(rs)}")
        for y in sorted({t["year"] for t in tr}):
            print(f"    năm {y}: {stats([net_r(t, fee) for t in tr if t['year'] == y])}")
        print("  Tài khoản 40$:")
        print(f"    mỗi lệnh mất 3$ nếu chạm SL     : {account(tr, fee, 'fixed', 3)}")
        print(f"    mỗi lệnh mất 7,5% vốn nếu chạm SL: {account(tr, fee, 'pct', 0.075)}")
        print(f"    mỗi lệnh mất 1$ nếu chạm SL     : {account(tr, fee, 'fixed', 1)}")
        print(f"    mỗi lệnh mất 2,5% vốn nếu chạm SL: {account(tr, fee, 'pct', 0.025)}")
        print()
    first = datetime.fromtimestamp(min(t["t_in"] for t in tr) / 1000, VN).date()
    print(f"(dữ liệu từ {first}; 2026 = năm kiểm tra nhưng đã bị xem nhiều lần khi chọn luật)")


if __name__ == "__main__":
    main()
