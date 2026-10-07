"""Chart-analysis styles as testable rules. Each detector sees bars <= i only.

Detector signature: f(ctx, i) -> None | dict(side, stop, entry=None|limit price, target=None|structural price)
entry None means market entry at the next bar open.
"""
import bisect
from dataclasses import dataclass

from .data import Candle

W = 3  # swing half-width


@dataclass
class Ctx:
    cs: list[Candle]
    atr: list[float]
    rsi: list[float]
    ema20: list[float]
    ema200: list[float]
    vwap: list[float]  # session VWAP, session = Vietnam calendar day
    vol_avg: list[float]  # mean volume of the previous 20 bars
    highs: list[int]  # confirmed swing-high indexes (confirmed at k + W)
    lows: list[int]


def build(cs: list[Candle]) -> Ctx:
    n = len(cs)
    atr, rsi, e20, e200, vwap, vavg = [0.0] * n, [50.0] * n, [0.0] * n, [0.0] * n, [0.0] * n, [0.0] * n
    gain = loss = 0.0
    pv = vv = 0.0
    day = None
    vsum = 0.0
    for i, c in enumerate(cs):
        p = cs[i - 1] if i else c
        tr = max(c.h - c.l, abs(c.h - p.c), abs(c.l - p.c))
        atr[i] = tr if i == 0 else (atr[i - 1] * 13 + tr) / 14
        e20[i] = c.c if i == 0 else e20[i - 1] + 2 / 21 * (c.c - e20[i - 1])
        e200[i] = c.c if i == 0 else e200[i - 1] + 2 / 201 * (c.c - e200[i - 1])
        if i:
            d = c.c - p.c
            gain = (gain * 13 + max(d, 0)) / 14
            loss = (loss * 13 + max(-d, 0)) / 14
            rsi[i] = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
        dkey = (c.t + 7 * 3_600_000) // 86_400_000
        if dkey != day:
            day, pv, vv = dkey, 0.0, 0.0
        typical = (c.h + c.l + c.c) / 3
        pv += typical * c.v
        vv += c.v
        vwap[i] = pv / vv if vv else c.c
        if i >= 20:
            vavg[i] = vsum / 20
            vsum -= cs[i - 20].v
        vsum += c.v
    highs = [k for k in range(W, n - W) if all(cs[k].h > cs[j].h for j in range(k - W, k + W + 1) if j != k)]
    lows = [k for k in range(W, n - W) if all(cs[k].l < cs[j].l for j in range(k - W, k + W + 1) if j != k)]
    return Ctx(cs, atr, rsi, e20, e200, vwap, vavg, highs, lows)


def confirmed(idx: list[int], i: int, count: int) -> list[int]:
    """Last `count` swing indexes confirmed by bar i (k + W <= i)."""
    j = bisect.bisect_right(idx, i - W)
    return idx[max(0, j - count) : j]


def trend(ctx: Ctx, i: int) -> int:
    hs, ls = confirmed(ctx.highs, i, 2), confirmed(ctx.lows, i, 2)
    if len(hs) < 2 or len(ls) < 2:
        return 0
    cs = ctx.cs
    if cs[hs[1]].h < cs[hs[0]].h and cs[ls[1]].l < cs[ls[0]].l:
        return -1
    if cs[hs[1]].h > cs[hs[0]].h and cs[ls[1]].l > cs[ls[0]].l:
        return 1
    return 0


def rejection(c: Candle, side: int) -> bool:
    """Close in the trade direction with a wick at least as long as the body on the opposite side."""
    body = abs(c.c - c.o)
    if side > 0:
        return c.c > c.o and min(c.o, c.c) - c.l >= max(body, 1e-12)
    return c.c < c.o and c.h - max(c.o, c.c) >= max(body, 1e-12)


# --- detectors -------------------------------------------------------------

def fib_confirm(ctx, i):
    """Trend + price inside the 0.5-0.618 pullback of the last leg + rejection candle -> market entry."""
    t = trend(ctx, i)
    if not t:
        return None
    cs, c = ctx.cs, ctx.cs[i]
    if t < 0:
        k = confirmed(ctx.highs, i, 1)[0]
        hi, lo = cs[k].h, min(x.l for x in cs[k : i + 1])
        z1, z2 = lo + 0.5 * (hi - lo), lo + 0.618 * (hi - lo)
        if c.h >= z1 and c.c <= z2 and rejection(c, -1):
            return {"side": -1, "stop": hi + 0.1 * ctx.atr[i], "target": lo}
    else:
        k = confirmed(ctx.lows, i, 1)[0]
        lo, hi = cs[k].l, max(x.h for x in cs[k : i + 1])
        z1, z2 = hi - 0.5 * (hi - lo), hi - 0.618 * (hi - lo)
        if c.l <= z1 and c.c >= z2 and rejection(c, 1):
            return {"side": 1, "stop": lo - 0.1 * ctx.atr[i], "target": hi}
    return None


def rsi_divergence(ctx, i):
    """New swing low below the previous one while RSI makes a higher low (mirror for highs); entry on confirmation."""
    cs = ctx.cs
    ls = confirmed(ctx.lows, i, 2)
    if len(ls) == 2 and ls[1] + W == i:
        a, b = ls
        if cs[b].l < cs[a].l and ctx.rsi[b] > ctx.rsi[a] + 3 and ctx.rsi[a] < 35:
            return {"side": 1, "stop": cs[b].l - 0.1 * ctx.atr[i], "target": None}
    hs = confirmed(ctx.highs, i, 2)
    if len(hs) == 2 and hs[1] + W == i:
        a, b = hs
        if cs[b].h > cs[a].h and ctx.rsi[b] < ctx.rsi[a] - 3 and ctx.rsi[a] > 65:
            return {"side": -1, "stop": cs[b].h + 0.1 * ctx.atr[i], "target": None}
    return None


def _zones(ctx, i, lookback=200):
    """Horizontal levels touched by >= 3 swing points within 0.3 ATR."""
    cs, a = ctx.cs, ctx.atr[i]
    pts = [cs[k].h for k in confirmed(ctx.highs, i, 40) if k >= i - lookback] + \
          [cs[k].l for k in confirmed(ctx.lows, i, 40) if k >= i - lookback]
    pts.sort()
    zones, group = [], []
    for p in pts:
        if group and p - group[0] > 0.3 * a:
            if len(group) >= 3:
                zones.append(sum(group) / len(group))
            group = []
        group.append(p)
    if len(group) >= 3:
        zones.append(sum(group) / len(group))
    return zones


def sr_bounce(ctx, i):
    """Wick into a 3-touch support/resistance zone and close back out with a rejection candle."""
    c, a = ctx.cs[i], ctx.atr[i]
    for z in _zones(ctx, i):
        if c.l <= z + 0.1 * a and c.c > z and rejection(c, 1) and c.o > z:
            return {"side": 1, "stop": min(c.l, z) - 0.2 * a, "target": None}
        if c.h >= z - 0.1 * a and c.c < z and rejection(c, -1) and c.o < z:
            return {"side": -1, "stop": max(c.h, z) + 0.2 * a, "target": None}
    return None


def sr_break_retest(ctx, i):
    """Zone broken within the last 10 bars, retested from the other side, rejection candle."""
    cs, c, a = ctx.cs, ctx.cs[i], ctx.atr[i]
    for z in _zones(ctx, i - 10):
        past = cs[i - 10 : i]
        if any(x.c > z + 0.2 * a for x in past) and cs[i - 11].c < z and c.l <= z + 0.1 * a and c.c > z and rejection(c, 1):
            return {"side": 1, "stop": z - 0.5 * a, "target": None}
        if any(x.c < z - 0.2 * a for x in past) and cs[i - 11].c > z and c.h >= z - 0.1 * a and c.c < z and rejection(c, -1):
            return {"side": -1, "stop": z + 0.5 * a, "target": None}
    return None


def double_top_bottom(ctx, i):
    """Two swing highs within 0.3 ATR, close below the low between them (neckline) -> short. Mirror."""
    cs, c, a = ctx.cs, ctx.cs[i], ctx.atr[i]
    hs = confirmed(ctx.highs, i, 2)
    if len(hs) == 2 and abs(cs[hs[0]].h - cs[hs[1]].h) <= 0.3 * a and hs[1] - hs[0] >= 5:
        neck = min(x.l for x in cs[hs[0] : hs[1] + 1])
        if c.c < neck <= cs[i - 1].c:
            top = max(cs[hs[0]].h, cs[hs[1]].h)
            return {"side": -1, "stop": top + 0.1 * a, "target": neck - (top - neck)}
    ls = confirmed(ctx.lows, i, 2)
    if len(ls) == 2 and abs(cs[ls[0]].l - cs[ls[1]].l) <= 0.3 * a and ls[1] - ls[0] >= 5:
        neck = max(x.h for x in cs[ls[0] : ls[1] + 1])
        if c.c > neck >= cs[i - 1].c:
            bot = min(cs[ls[0]].l, cs[ls[1]].l)
            return {"side": 1, "stop": bot - 0.1 * a, "target": neck + (neck - bot)}
    return None


def fvg(ctx, i):
    """Fair value gap in the trend direction created on bar i: limit order at the gap midpoint."""
    t = trend(ctx, i)
    cs, a = ctx.cs, ctx.atr[i]
    if i < 2 or not t:
        return None
    if t > 0 and cs[i].l > cs[i - 2].h and cs[i].l - cs[i - 2].h >= 0.3 * a:
        mid = (cs[i].l + cs[i - 2].h) / 2
        return {"side": 1, "entry": mid, "stop": cs[i - 2].l - 0.1 * a, "target": None}
    if t < 0 and cs[i].h < cs[i - 2].l and cs[i - 2].l - cs[i].h >= 0.3 * a:
        mid = (cs[i].h + cs[i - 2].l) / 2
        return {"side": -1, "entry": mid, "stop": cs[i - 2].h + 0.1 * a, "target": None}
    return None


def order_block(ctx, i):
    """Impulse candle >= 2 ATR in the trend direction: limit at the last opposite candle's open (order block)."""
    t = trend(ctx, i)
    cs, c, a = ctx.cs, ctx.cs[i], ctx.atr[i]
    if not t or t * (c.c - c.o) < 2 * a:
        return None
    for k in range(i - 1, max(i - 6, 0), -1):
        ob = cs[k]
        if t > 0 and ob.c < ob.o:
            return {"side": 1, "entry": ob.o, "stop": ob.l - 0.1 * a, "target": None}
        if t < 0 and ob.c > ob.o:
            return {"side": -1, "entry": ob.o, "stop": ob.h + 0.1 * a, "target": None}
    return None


def vwap_reversion(ctx, i):
    """Price stretched > 2 ATR from session VWAP + rejection candle -> fade back to VWAP."""
    c, a, v = ctx.cs[i], ctx.atr[i], ctx.vwap[i]
    if c.c < v - 2 * a and rejection(c, 1):
        return {"side": 1, "stop": c.l - 0.2 * a, "target": v}
    if c.c > v + 2 * a and rejection(c, -1):
        return {"side": -1, "stop": c.h + 0.2 * a, "target": v}
    return None


def bos(ctx, i):
    """Break of structure in the trend: close beyond the last swing high (uptrend) -> long, stop under last swing low."""
    t = trend(ctx, i)
    cs, c, a = ctx.cs, ctx.cs[i], ctx.atr[i]
    if t > 0:
        h = cs[confirmed(ctx.highs, i, 1)[0]].h
        if c.c > h >= cs[i - 1].c:
            return {"side": 1, "stop": cs[confirmed(ctx.lows, i, 1)[0]].l - 0.1 * a, "target": None}
    if t < 0:
        l = cs[confirmed(ctx.lows, i, 1)[0]].l
        if c.c < l <= cs[i - 1].c:
            return {"side": -1, "stop": cs[confirmed(ctx.highs, i, 1)[0]].h + 0.1 * a, "target": None}
    return None


def ema_pullback(ctx, i):
    """Strong trend (EMA20 > EMA200, both rising vs 10 bars ago): touch of EMA20 + rejection candle."""
    c, a = ctx.cs[i], ctx.atr[i]
    if i < 210:
        return None
    up = ctx.ema20[i] > ctx.ema200[i] and ctx.ema200[i] > ctx.ema200[i - 10] and c.c > ctx.ema20[i]
    dn = ctx.ema20[i] < ctx.ema200[i] and ctx.ema200[i] < ctx.ema200[i - 10] and c.c < ctx.ema20[i]
    if up and c.l <= ctx.ema20[i] and rejection(c, 1):
        return {"side": 1, "stop": c.l - 0.3 * a, "target": None}
    if dn and c.h >= ctx.ema20[i] and rejection(c, -1):
        return {"side": -1, "stop": c.h + 0.3 * a, "target": None}
    return None


STYLES = {
    "fib_confirm": ("Fibonacci 0.5–0.618 + nến từ chối", fib_confirm),
    "rsi_divergence": ("Phân kỳ RSI tại đỉnh/đáy", rsi_divergence),
    "sr_bounce": ("Bật khỏi hỗ trợ/kháng cự (≥3 lần chạm)", sr_bounce),
    "sr_break_retest": ("Phá vùng hỗ trợ/kháng cự rồi test lại", sr_break_retest),
    "double_top_bottom": ("Hai đỉnh / hai đáy, phá đường viền cổ", double_top_bottom),
    "fvg": ("FVG (khoảng trống giá) theo xu hướng, limit giữa gap", fvg),
    "order_block": ("Order block sau nến bùng nổ, limit", order_block),
    "vwap_reversion": ("Giá lệch xa VWAP ngày + nến từ chối", vwap_reversion),
    "bos": ("Phá cấu trúc (BOS) theo xu hướng", bos),
    "ema_pullback": ("Hồi về EMA20 trong xu hướng mạnh + nến từ chối", ema_pullback),
}
