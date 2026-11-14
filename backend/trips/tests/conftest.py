from __future__ import annotations

import threading
from collections.abc import Iterator

import pytest


@pytest.fixture(autouse=True)
def _join_upstream_threads() -> Iterator[None]:
    """Weather batches still in flight when a plan fails finish in the background (into the
    cache). Wait for them so they never log into a later test's captured output."""
    yield
    for thread in threading.enumerate():
        if thread.name.startswith(("openmeteo", "detour")):
            thread.join(timeout=10)
