"""Theo xu hướng khung ngày (Donchian / Turtle) trên toàn bộ *-PERP.

Usage: python -m service.scripts.trend_daily_study

Luật chốt TRƯỚC khi chạy (2026-10-10):
- Nến ngày UTC gộp từ 1h. 2 biến thể: A = vào khi phá kênh 20 ngày, thoát kênh 10;
  B = vào kênh 50, thoát kênh 25. Cả LONG và SHORT, mỗi coin tối đa 1 vị thế.
- Vào ở giá mở ngày sau khi nến ngày đóng vượt đỉnh/đáy N ngày trước đó.
- SL ban đầu 2×ATR20 (= 1R), chạm trong ngày thì thoát ở SL (mở gap qua SL thì thoát ở giá mở).
  Không TP: giá đóng ngày phá kênh thoát → thoát ở giá mở ngày sau.
- Chi phí: phí 0.08% + trượt 0.02% mỗi chiều; funding 0.03%/ngày giữ lệnh (luôn tính là chi phí).
- Đạt chuẩn khi: train (vào lệnh 2023–2025) n >= 300, expR > 0, t >= 3, >= 60% coin dương; 2026 expR > 0.
"""
import math
from collections import defaultdict

from service.backtest.data import DATA_DIR, load
from service.scripts.styles_study import resample

COST_SIDE = 0.0008 + 0.0002
FUNDING_DAY = 0.0003
VARIANTS = {"A (20/10)": (20, 10), "B (50/25)": (50, 25)}
YEAR_MS = 31_557_600_000


def atr(cs, i, n=20):
    return sum(max(c.h - c.l, abs(c.h - p.c), abs(c.l - p.c)) for p, c in zip(cs[i - n:i], cs[i - n + 1:i + 1])) / n


def run_symbol(cs, n_in, n_out):
    trades, i = [], max(n_in, 21)
    while i < len(cs) - 1:
        hi = max(c.h for c in cs[i - n_in:i])
        lo = min(c.l for c in cs[i - n_in:i])
        side = 1 if cs[i].c > hi else -1 if cs[i].c < lo else 0
        if not side:
            i += 1
            continue
        a = atr(cs, i)
        k = i + 1
        entry = cs[k].o
        stop = entry - side * 2 * a
        exit_px, exit_k = None, None
        while k < len(cs):
            c = cs[k]
            if (c.l <= stop) if side > 0 else (c.h >= stop):
                gap = (c.o < stop) if side > 0 else (c.o > stop)
                exit_px, exit_k = (c.o if gap else stop), k
                break
            broke = c.c < min(x.l for x in cs[k - n_out:k]) if side > 0 else c.c > max(x.h for x in cs[k - n_out:k])
            if broke and k + 1 < len(cs):
                exit_px, exit_k = cs[k + 1].o, k + 1
                break
            k += 1
        if exit_px is None:  # còn mở ở cuối dữ liệu: đóng ở giá cuối
            exit_px, exit_k = cs[-1].c, len(cs) - 1
        risk = 2 * a / entry
        cost = 2 * COST_SIDE + FUNDING_DAY * (exit_k - (i + 1) + 1)
        r = (side * (exit_px / entry - 1) - cost) / risk
        trades.append({"side": side, "r": r, "year": cs[i + 1].t // YEAR_MS + 1970,
                       "t_in": cs[i + 1].t, "t_out": cs[exit_k].t, "days": exit_k - i})
        i = exit_k + 1
    return trades


def stats(rows):
    rs = [x["r"] for x in rows]
    n = len(rs)
    if n < 2:
        return {"n": n}
    m = sum(rs) / n
    sd = math.sqrt(sum((x - m) ** 2 for x in rs) / (n - 1))
    wins = [x for x in rs if x > 0]
    by_coin = defaultdict(list)
    for x in rows:
        by_coin[x["sym"]].append(x["r"])
    return {"n": n, "expR": m, "t": m / (sd / math.sqrt(n)) if sd else 0, "win": len(wins) / n,
            "avgWin": sum(wins) / len(wins) if wins else 0, "maxR": max(rs),
            "coins+": sum(sum(v) > 0 for v in by_coin.values()) / len(by_coin)}


def account(rows, start=50.0, risk=0.01, max_open=5):
    """Rủi ro 1% vốn/lệnh, tối đa max_open lệnh cùng lúc (lấy lệnh đến trước)."""
    eq = peak = start
    dd = 0.0
    open_until = []
    for x in sorted(rows, key=lambda x: x["t_in"]):
        open_until = [t for t in open_until if t > x["t_in"]]
        if len(open_until) >= max_open:
            continue
        open_until.append(x["t_out"])
        x["taken"] = True
    for x in sorted((x for x in rows if x.pop("taken", False)), key=lambda x: x["t_out"]):
        eq += eq * risk * x["r"]
        peak = max(peak, eq)
        dd = max(dd, 1 - eq / peak)
    return eq, dd


def fmt(s):
    if s["n"] < 2:
        return f"n={s['n']}"
    return (f"n={s['n']:4d} thắng={s['win']:.0%} TB thắng={s['avgWin']:+.2f}R max={s['maxR']:+.1f}R "
            f"expR={s['expR']:+.3f} t={s['t']:+.2f} coin+={s['coins+']:.0%}")


def main():
    files = sorted(DATA_DIR.glob("*-PERP_1h.csv"))
    daily = {f.name.split("-PERP")[0]: resample(load(f.name.split("_")[0], "1h", include_holdout=True), 24) for f in files}
    for name, (n_in, n_out) in VARIANTS.items():
        rows = []
        for sym, cs in daily.items():
            for t in run_symbol(cs, n_in, n_out):
                t["sym"] = sym
                rows.append(t)
        train = [x for x in rows if x["year"] <= 2025]
        test = [x for x in rows if x["year"] >= 2026]
        st, se = stats(train), stats(test)
        ok = st["n"] >= 300 and st["expR"] > 0 and st["t"] >= 3 and st["coins+"] >= 0.6 and se.get("expR", -1) > 0
        print(f"\n=== {name} — {'ĐẠT CHUẨN' if ok else 'KHÔNG ĐẠT'} ===")
        print("  train 2023–2025:", fmt(st))
        print("  2026          :", fmt(se))
        for side, lab in ((1, "LONG "), (-1, "SHORT")):
            print(f"  {lab} train:", fmt(stats([x for x in train if x["side"] == side])),
                  "| 2026:", fmt(stats([x for x in test if x["side"] == side])))
        for y in sorted({x["year"] for x in rows}):
            print(f"  năm {y}:", fmt(stats([x for x in rows if x["year"] == y])))
        eq, dd = account([dict(x) for x in rows])
        print(f"  Tài khoản 50$, rủi ro 1%/lệnh, tối đa 5 lệnh: cuối {eq:.1f}$, sụt tối đa {dd:.0%}")


if __name__ == "__main__":
    main()
