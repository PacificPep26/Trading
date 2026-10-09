"""More trades under the same rule? (1) new coins never used to pick the rule, (2) 2h / 6h bars.

Usage: python -m service.scripts.expand_study
Cost: MEXC zero-fee coins -> slippage 0.04% round trip + funding 0.01%/8h (fee 0).
Exit: take the whole trade at 0.5R (owner's choice) and 1.5R for reference.
"""
from service.scripts.rule_study import net_r, signals, stats

ORIGINAL = {"1000PEPEUSDT", "ADAUSDT", "APTUSDT", "ARBUSDT", "AVAXUSDT", "BNBUSDT", "BTCUSDT", "DOGEUSDT", "DOTUSDT", "ETHUSDT",
            "HYPEUSDT", "INJUSDT", "LINKUSDT", "LTCUSDT", "NEARUSDT", "OPUSDT", "SOLUSDT", "SUIUSDT", "TIAUSDT", "WIFUSDT", "XRPUSDT"}


def report(name, tr):
    span = (max(t["t_out"] for t in tr) - min(t["t_in"] for t in tr)) / 86_400_000 if tr else 1
    rs = [net_r(t, 0.0) for t in tr]
    years = " | ".join(f"{y}: {stats([net_r(t, 0.0) for t in tr if t['year'] == y])}" for y in sorted({t["year"] for t in tr}))
    print(f"{name:42s} {stats(rs)} | {len(tr) / span * 7:4.1f} lệnh/tuần\n      {years}")


def main():
    for tp in (0.5, 1.5):
        print(f"\n===== chốt {tp}R =====")
        report("4h · 21 coin cũ", signals(4, tp, only=ORIGINAL))
        report("4h · coin MỚI (chưa từng dùng để chọn luật)", signals(4, tp, exclude=ORIGINAL))
        for h in (2, 6):
            report(f"{h}h · 21 coin cũ", signals(h, tp, only=ORIGINAL))


if __name__ == "__main__":
    main()
