"""`scripts/find_demo_route.py`: offline smoke run and key redaction (no network)."""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
import respx
from django.core.cache import cache

from trips.services import clock, planner

SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "find_demo_route.py"
NOW = 1_794_646_800.0  # 2026-11-14T09:00:00Z
SECRET = "tt-secret-0123456789abcdef"


@pytest.fixture(scope="module")
def script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("find_demo_route", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclasses resolve annotations through sys.modules
    spec.loader.exec_module(module)
    return module


@pytest.fixture(autouse=True)
def _offline(settings: Any, monkeypatch: pytest.MonkeyPatch) -> Any:
    settings.TOMTOM_API_KEY = SECRET
    monkeypatch.setattr(clock, "now_utc", lambda: NOW)
    planner.clear_memo()
    cache.clear()
    with respx.mock(assert_all_mocked=True):  # any real HTTP call would fail
        yield
    planner.clear_memo()


def test_fixture_scan_ranks_candidates_without_printing_the_key(
    script: ModuleType, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(script, "DEPARTURE_OFFSETS_H", (0, 6))

    assert script.main(["--fixtures", "--trip", "denver_slc", "--top", "2"]) == 0

    out = capsys.readouterr().out
    assert "4 plans from 2 TomTom routing calls" in out  # 2 departures x 2 weights
    assert "1. Denver, CO, USA -> Salt Lake City, UT, USA" in out
    # Departures start at the next whole hour (10:00Z = 03:00 MST), every 6 h.
    assert re.search(r"departure_local 2026-11-14T(03|09):00 \(MST\)", out)
    assert SECRET not in out


def test_redact_hides_the_key(script: ModuleType, capsys: pytest.CaptureFixture[str]) -> None:
    script.say(f"GET https://api.tomtom.com/x?key={SECRET}&travelMode=truck")

    out = capsys.readouterr().out
    assert SECRET not in out
    assert "key=***" in out


def test_live_run_needs_a_key(
    script: ModuleType, settings: Any, capsys: pytest.CaptureFixture[str]
) -> None:
    settings.TOMTOM_API_KEY = ""

    assert script.main([]) == 2
    assert "TOMTOM_API_KEY is not set" in capsys.readouterr().out
