"""Encoded polyline (Google's algorithm) at 1e-6 precision, the ``polyline6`` route geometry.

The client decodes it once per plan. Precision 6 keeps vertices within about 0.1 m.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence

from trips.domain.types import LatLon

PRECISION = 6
_FACTOR = 10**PRECISION


def _encode_value(delta: int) -> Iterator[str]:
    value = ~(delta << 1) if delta < 0 else delta << 1
    while value >= 0x20:
        yield chr((0x20 | (value & 0x1F)) + 63)
        value >>= 5
    yield chr(value + 63)


def encode(points: Sequence[LatLon]) -> str:
    out: list[str] = []
    prev_lat = prev_lon = 0
    for p in points:
        lat, lon = round(p.lat * _FACTOR), round(p.lon * _FACTOR)
        out.extend(_encode_value(lat - prev_lat))
        out.extend(_encode_value(lon - prev_lon))
        prev_lat, prev_lon = lat, lon
    return "".join(out)


def decode(text: str) -> list[LatLon]:
    values: list[int] = []
    shift = result = 0
    for ch in text:
        byte = ord(ch) - 63
        result |= (byte & 0x1F) << shift
        shift += 5
        if byte < 0x20:
            values.append(~(result >> 1) if result & 1 else result >> 1)
            shift = result = 0
    if shift or len(values) % 2:
        raise ValueError("truncated polyline")
    points: list[LatLon] = []
    lat = lon = 0
    for i in range(0, len(values), 2):
        lat += values[i]
        lon += values[i + 1]
        points.append(LatLon(lat / _FACTOR, lon / _FACTOR))
    return points
