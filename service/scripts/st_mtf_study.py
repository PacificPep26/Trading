"""Wysetrade Supertrend, multi-timeframe as the video actually trades it (13:20–16:10: USDJPY daily → 1 hour).

Usage: python -m service.scripts.st_mtf_study

Higher frame (daily, or 4H/12H as alternatives) gives the bias = Supertrend colour of the last CLOSED bar, and the "setup area"
= one of the last 3 closed higher-frame bars touched the band (low <= line + 0.5 ATR for longs, mirror). Inside it, the 1H
Supertrend flips to the same colour → enter next 1H open; SL = 1H band − 0.3 ATR, trailed with the 1H band, no TP, max 120 bars.
Variants: bias only / bias + setup area. Control: random 1H bars where both frames already have that colour, same exit.
21 bot coins, 2025–2026, fee 0, slippage 0.04%.
"""
import bisect
import random

from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import build
from service.scripts import fee0_shootout as X
from service.scripts.live_precise_study import LIVE_COINS
from service.scripts.styles_study import resample, year_of
from service.scripts.video_hub_study import COST, H, exit_trail_st, supertrend


def htf_state(ch, step):
    """t (1H bar close) → (dir, touched band in last 3 closed bars) of the higher frame."""
    line, d = supertrend(ch)
    a = build(ch).atr
    closes = [b.t + step for b in ch]

    def at(t):
        k = bisect.bisect_right(closes, t) - 1
        if k < 3:
            return 0, False
        s = d[k]
        near = all(d[j] == s for j in range(k - 2, k + 1)) and any(
            (ch[j].l <= line[j] + 0.5 * a[j]) if s > 0 else (ch[j].h >= line[j] - 0.5 * a[j]) for j in range(k - 2, k + 1))
        return s, near
    return at


def study(c1, x1, at, label, rnd):
    line, d = supertrend(c1)
    out, ctrl, busy = [], [], 0
    for i in range(60, len(c1) - 122):
        if year_of(c1[i].t) < 2025:
            continue
        side = d[i]
        hs, near = at(c1[i].t + H)
        if hs != side:
            continue
        e, f, a = c1[i + 1].o, i + 1, x1.atr[i]
        stop = line[i] - side * 0.3 * a
        risk = side * (e - stop) / e
        if not 0.003 <= risk <= 0.08:
            continue
        g = None
        if d[i - 1] != side and i > busy:
            g, _ = exit_trail_st(c1, f, side, e, stop, line, x1.atr)
            r = (g - COST) / risk
            out.append((f"{label} · 1H đổi màu thuận khung lớn", year_of(c1[f].t), side, r))
            if near:
                out.append((f"{label} · 1H đổi màu + khung lớn vừa hồi chạm dải (đúng video)", year_of(c1[f].t), side, r))
            busy = i + 2
        elif rnd.random() < 0.03:
            g, _ = exit_trail_st(c1, f, side, e, stop, line, x1.atr)
            ctrl.append((f"{label} · ngẫu nhiên cùng màu", year_of(c1[f].t), side, (g - COST) / risk))
    return out + ctrl


def main():
    rows, rnd = [], random.Random(7)
    for fp in sorted(DATA_DIR.glob("*-PERP_1h.csv")):
        sym = fp.name.split("_")[0]
        if sym.replace("USDT-PERP", "") not in LIVE_COINS:
            continue
        c1 = load(sym, "1h", include_holdout=True)
        x1 = build(c1)
        for label, n in (("Ngày→1H", 24), ("12H→1H", 12), ("4H→1H", 4)):
            rows += study(c1, x1, htf_state(resample(c1, n), n * H), label, rnd)
    for name in sorted({r[0] for r in rows}):
        g = [r for r in rows if r[0] == name]
        X.show(name, {y: [r[3] for r in g if r[1] == y] for y in X.YEARS})
        print("    " + " | ".join(f"{nm} {y} {X.T.stats([r[3] for r in g if r[1] == y and r[2] == s])}"
                                for s, nm in ((1, "LONG"), (-1, "SHORT")) for y in X.YEARS))


if __name__ == "__main__":
    main()
