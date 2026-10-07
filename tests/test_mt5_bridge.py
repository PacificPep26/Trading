from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from service.app import main


class FakeMT5:
    TIMEFRAME_H1 = 16385

    def __init__(self, server: str = "MetaQuotes-Demo") -> None:
        self.server = server
        self.selected_symbol: str | None = None

    def initialize(self) -> bool:
        return True

    def terminal_info(self) -> SimpleNamespace:
        return SimpleNamespace(connected=True)

    def account_info(self) -> SimpleNamespace:
        return SimpleNamespace(server=self.server)

    def symbol_select(self, symbol: str, enable: bool) -> bool:
        self.selected_symbol = symbol
        return enable

    def copy_rates_from_pos(self, symbol: str, timeframe: int, start: int, count: int) -> list[dict[str, float | int]]:
        assert symbol == "EURUSD"
        assert timeframe == self.TIMEFRAME_H1
        assert start == 0
        assert count == 20
        return [{"time": 1_760_000_000, "open": 1.1, "high": 1.2, "low": 1.0, "close": 1.15}]


def test_health_reports_read_only_mode() -> None:
    assert main.health() == {"status": "ok", "mode": "read-only"}


def test_live_server_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "_load_mt5", lambda: FakeMT5(server="Live-Account"))

    with pytest.raises(HTTPException) as error:
        main.mt5_status()

    assert error.value.status_code == 403


def test_market_endpoint_returns_demo_candles_without_account_data(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_mt5 = FakeMT5()
    monkeypatch.setattr(main, "_load_mt5", lambda: fake_mt5)

    result = main.market_candles("EURUSD", timeframe="H1", count=20)

    assert result == {
        "symbol": "EURUSD",
        "timeframe": "H1",
        "candles": [{"time": 1_760_000_000, "open": 1.1, "high": 1.2, "low": 1.0, "close": 1.15}],
    }
    assert fake_mt5.selected_symbol == "EURUSD"
    assert "account" not in result


def test_unsupported_symbol_is_rejected_before_loading_mt5(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_if_loaded() -> FakeMT5:
        pytest.fail("MT5 must not be touched for an unsupported symbol")

    monkeypatch.setattr(main, "_load_mt5", fail_if_loaded)

    with pytest.raises(HTTPException) as error:
        main.market_candles("GBPUSD")

    assert error.value.status_code == 422
