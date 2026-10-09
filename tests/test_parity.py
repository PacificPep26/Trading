"""The scanner (lib/patterns.ts) must fire the same 4h signals as the backtested Python rules."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from service.backtest.data import DATA_DIR, load
from service.backtest.patterns import bos, build, double_top_bottom
from service.scripts.styles_study import resample

ROOT = Path(__file__).resolve().parents[1]
WINDOW = 300


def py_signals(win):
    x = build(win)
    i = len(win) - 1
    out = []
    for name, det in (("bos", bos), ("double_top_bottom", double_top_bottom)):
        s = det(x, i)
        if s:
            out.append({"style": name, "side": s["side"], "stop": s["stop"]})
    return out


@pytest.mark.skipif(shutil.which("node") is None or not (DATA_DIR / "SOLUSDT-PERP_1h.csv").exists(), reason="needs node and local data")
@pytest.mark.parametrize("sym", sorted(f.name.split("-PERP")[0] for f in DATA_DIR.glob("*-PERP_1h.csv")) or ["SOLUSDT"])
def test_ts_matches_python(sym):
    cs = resample(load(f"{sym}-PERP", "1h", include_holdout=True), 4)
    idx = list(range(WINDOW + 10, len(cs), 3))
    windows = [cs[i - WINDOW + 1 : i + 1] for i in idx]
    payload = json.dumps([[{"t": c.t, "o": c.o, "h": c.h, "l": c.l, "c": c.c, "v": c.v} for c in w] for w in windows])
    res = subprocess.run(["node", "tests/parity/analyse.mjs"], input=payload, capture_output=True, text=True, cwd=ROOT, check=True)
    ts_all = json.loads(res.stdout)
    fired = mismatched = 0
    for w, ts in zip(windows, ts_all):
        py = py_signals(w)
        fired += len(py)
        key = lambda s: (s["style"], s["side"])  # noqa: E731
        if sorted(map(key, py)) != sorted(map(key, ts)):
            mismatched += 1
            continue
        for a in py:
            b = next(s for s in ts if key(s) == key(a))
            assert abs(a["stop"] - b["stop"]) / a["stop"] < 1e-6
    assert fired > 20, "too few signals to compare"
    assert mismatched == 0, f"{mismatched} windows differ between TS and Python"
