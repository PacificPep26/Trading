from __future__ import annotations

from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Northstar Local MT5 Bridge",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["Accept", "Content-Type"],
)

Timeframe = Literal["M15", "M30", "H1", "H4"]
TIMEFRAME_NAMES = {
    "M15": "TIMEFRAME_M15",
    "M30": "TIMEFRAME_M30",
    "H1": "TIMEFRAME_H1",
    "H4": "TIMEFRAME_H4",
}


def _load_mt5() -> Any:
    try:
        import MetaTrader5 as mt5
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="Chưa cài gói MetaTrader5 cho Python bridge.",
        ) from exc
    return mt5


def _demo_terminal(mt5: Any) -> tuple[Any, Any, str]:
    if not mt5.initialize():
        error_code, error_message = mt5.last_error()
        raise HTTPException(
            status_code=503,
            detail=f"Không thể kết nối terminal MT5 ({error_code}: {error_message}).",
        )

    terminal = mt5.terminal_info()
    account = mt5.account_info()
    if terminal is None or account is None or not terminal.connected:
        raise HTTPException(status_code=503, detail="Terminal MT5 chưa đăng nhập hoặc chưa kết nối.")

    server = str(account.server or "")
    normalized_server = server.casefold()
    if "demo" not in normalized_server and "practice" not in normalized_server:
        raise HTTPException(status_code=403, detail="Bridge chỉ cho phép tài khoản demo hoặc practice.")

    return terminal, account, server


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": "read-only"}


@app.get("/api/v1/mt5/status")
def mt5_status() -> dict[str, str | bool]:
    mt5 = _load_mt5()
    _, _, server = _demo_terminal(mt5)
    return {"connected": True, "mode": "read-only", "server": server}


@app.get("/api/v1/market/{symbol}")
def market_candles(
    symbol: str,
    timeframe: Timeframe = Query(default="H1"),
    count: int = Query(default=120, ge=10, le=500),
) -> dict[str, Any]:
    normalized_symbol = symbol.upper()
    if normalized_symbol != "EURUSD":
        raise HTTPException(status_code=422, detail="MVP hiện chỉ hỗ trợ EURUSD.")

    mt5 = _load_mt5()
    _demo_terminal(mt5)
    if not mt5.symbol_select(normalized_symbol, True):
        error_code, error_message = mt5.last_error()
        raise HTTPException(
            status_code=503,
            detail=f"Không thể chọn symbol {normalized_symbol} trong MT5 ({error_code}: {error_message}).",
        )

    timeframe_value = getattr(mt5, TIMEFRAME_NAMES[timeframe], None)
    if timeframe_value is None:
        raise HTTPException(status_code=503, detail=f"MT5 không hỗ trợ khung thời gian {timeframe}.")

    rates = mt5.copy_rates_from_pos(normalized_symbol, timeframe_value, 0, count)
    if rates is None:
        error_code, error_message = mt5.last_error()
        raise HTTPException(
            status_code=503,
            detail=f"Không lấy được nến từ MT5 ({error_code}: {error_message}).",
        )

    candles = [
        {
            "time": int(rate["time"]),
            "open": float(rate["open"]),
            "high": float(rate["high"]),
            "low": float(rate["low"]),
            "close": float(rate["close"]),
        }
        for rate in rates
    ]
    return {"symbol": normalized_symbol, "timeframe": timeframe, "candles": candles}
