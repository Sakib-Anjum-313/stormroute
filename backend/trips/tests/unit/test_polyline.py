from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from trips.domain.polyline import decode, encode
from trips.domain.types import LatLon


@pytest.mark.parametrize(
    ("points", "expected"),
    [
        ([], ""),
        # Google's documented example, re-encoded at precision 6 by hand: deltas are x10.
        ([LatLon(38.5, -120.2)], "_izlhA~rlgdF"),
        ([LatLon(0.0, 0.0), LatLon(0.000001, -0.000001)], "??A@"),
    ],
)
def test_encode_known_values(points: list[LatLon], expected: str) -> None:
    assert encode(points) == expected
    assert decode(expected) == points


coord = st.tuples(
    st.floats(min_value=-90, max_value=90, allow_nan=False),
    st.floats(min_value=-180, max_value=180, allow_nan=False),
)


@given(st.lists(coord, max_size=50))
def test_round_trip_within_precision(raw: list[tuple[float, float]]) -> None:
    points = [LatLon(lat, lon) for lat, lon in raw]
    decoded = decode(encode(points))
    assert len(decoded) == len(points)
    for a, b in zip(points, decoded, strict=True):
        assert abs(a.lat - b.lat) <= 5e-7 + 1e-12
        assert abs(a.lon - b.lon) <= 5e-7 + 1e-12


def test_truncated_input_is_rejected() -> None:
    with pytest.raises(ValueError, match="truncated"):
        decode(encode([LatLon(38.5, -120.2)])[:-1])
