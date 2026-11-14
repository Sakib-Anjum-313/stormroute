from __future__ import annotations

import base64
import math
import struct

import pytest

from trips.domain.geometry import PolylineIndex, simplify
from trips.domain.heatmap_grid import (
    HOURS,
    LEVEL_NO_DATA,
    MAX_CELLS,
    MAX_STRIDE_K,
    U16_NO_DATA,
    build_frames,
    choose_lattice,
    corridor_cells,
    corridor_radius_m,
    encode_heatmap,
    encode_u8,
    encode_u16,
    quantize_u16,
)
from trips.domain.levels import Level
from trips.domain.routes_select import select_routes
from trips.domain.types import Cell, HourlySeries, LatLon, LocationSeries, RouteGeom

T0 = 1_763_078_400  # hour-aligned


def decode_u16(text: str) -> list[int]:
    raw = base64.b64decode(text)
    return list(struct.unpack(f"<{len(raw) // 2}H", raw))


def test_radius_has_a_20_km_floor() -> None:
    assert corridor_radius_m(0.2) == 20_000
    assert corridor_radius_m(0.5) == pytest.approx(0.75 * 0.5 * 111_000)


def test_corridor_cells_are_on_the_stride_lattice_and_near_the_route() -> None:
    line = [LatLon(40.0, -105.0 + 0.05 * i) for i in range(41)]
    for k in (2, 3, 5):
        cells = corridor_cells([line], k)
        assert cells
        stride = k / 10
        radius = corridor_radius_m(stride)
        index = PolylineIndex([line], radius)
        for lat, lon in cells:
            assert lat * 10 / k == pytest.approx(round(lat * 10 / k))
            assert lon * 10 / k == pytest.approx(round(lon * 10 / k))
            assert index.within(LatLon(lat, lon), radius)
    assert corridor_cells([], 2) == []


def test_recorded_fixture_respects_cell_cap(denver_slc: list[RouteGeom]) -> None:
    kept = select_routes(denver_slc).kept
    lines = [simplify(denver_slc[i].points, 500) for i in kept]
    lattice = choose_lattice(lines)
    assert 0 < len(lattice.cells) <= MAX_CELLS
    assert lattice.stride_k >= 2
    assert lattice.cell_deg == pytest.approx(lattice.stride_k / 10)
    # The smallest stride wins: one finer stride would exceed the cap.
    if lattice.stride_k > 2:
        assert len(corridor_cells(lines, lattice.stride_k - 1)) > MAX_CELLS


def test_choose_lattice_coarsens_until_under_cap() -> None:
    line = [LatLon(40.0, -105.0 + 0.05 * i) for i in range(41)]
    fine = choose_lattice([line], max_cells=10_000)
    coarse = choose_lattice([line], max_cells=10)
    assert fine.stride_k == 2
    assert coarse.stride_k > 2
    assert len(coarse.cells) <= 10
    assert not fine.trimmed
    with pytest.raises(ValueError, match="cell cap"):
        choose_lattice([line], max_cells=0)


def test_choose_lattice_never_coarsens_past_half_a_degree_it_narrows_instead() -> None:
    # 40 degrees of longitude at lat 40.2: at 0.5 deg the corridor holds row 40.0 (22 km away)
    # and row 40.5 (33 km away), 162 cells, so a cap of 100 cannot be met by coarsening.
    line = [LatLon(40.2, -120.0 + 0.05 * i) for i in range(801)]
    full = corridor_cells([line], MAX_STRIDE_K)
    assert len(full) == 162

    lattice = choose_lattice([line], max_cells=100)

    assert MAX_STRIDE_K == 5
    assert lattice.stride_k == MAX_STRIDE_K
    assert lattice.cell_deg == pytest.approx(0.5)
    assert lattice.trimmed
    assert len(lattice.cells) == 100
    assert {c for c in full if c[0] == 40.0} <= set(lattice.cells)  # the nearest row is whole
    index = PolylineIndex([line], corridor_radius_m(0.5))
    kept = [index.distance_m(LatLon(*c)) for c in lattice.cells]
    dropped = [index.distance_m(LatLon(*c)) for c in full if c not in set(lattice.cells)]
    assert max(kept) <= min(dropped)
    assert list(lattice.cells) == [c for c in full if c in set(lattice.cells)]  # lattice order
    assert choose_lattice([line], max_cells=100) == lattice  # deterministic


@pytest.mark.parametrize("min_k", [2, 5, 6])
def test_choose_lattice_stride_stays_within_bounds(min_k: int) -> None:
    line = [LatLon(40.2, -120.0 + 0.05 * i) for i in range(801)]
    lattice = choose_lattice([line], max_cells=MAX_CELLS, min_k=min_k)
    assert lattice.stride_k == max(2, min(min_k, MAX_STRIDE_K))
    assert len(lattice.cells) <= MAX_CELLS
    assert not lattice.trimmed  # 162 cells fit at 0.5 deg


def flat(value: float | None, n: int = 60) -> HourlySeries:
    return HourlySeries(T0 - 3600, (value,) * n)


def location(wind: float, rain: float = 0.0, snow: float = 0.0) -> LocationSeries:
    return LocationSeries(flat(wind), flat(None), flat(rain), flat(0.0), flat(snow))


def test_build_frames_uses_assess_with_load_rules_and_marks_missing_cells() -> None:
    cells: list[Cell] = [(41.2, -105.6), (41.4, -105.6), (41.6, -105.6)]
    series = {cells[0]: location(50.0), cells[1]: location(5.0, rain=0.3)}
    frames = build_frames(cells, series, departure_utc=T0 + 1234, weight_lb=35_000)
    assert frames.base_time_utc == T0
    assert frames.hours == HOURS
    assert len(frames.levels) == HOURS * len(cells)
    for h in range(HOURS):
        row = frames.levels[h * 3 : h * 3 + 3]
        assert row == (int(Level.NO_TRAVEL), int(Level.HIGH), LEVEL_NO_DATA)
    assert frames.wind_mph[2] is None
    assert frames.rain_in_hr[1] == pytest.approx(0.3)


def test_build_frames_beyond_series_is_no_data() -> None:
    cell: Cell = (40.0, -105.0)
    calm = HourlySeries(T0, (1.0, 1.0))
    dry = HourlySeries(T0, (0.0, 0.0))
    short = LocationSeries(calm, calm, dry, dry, dry)  # covers only T0 and T0 + 1h
    frames = build_frames([cell], {cell: short}, T0, 10_000, hours=4)
    assert frames.levels == (int(Level.LOW), int(Level.LOW), LEVEL_NO_DATA, LEVEL_NO_DATA)


@pytest.mark.parametrize(
    ("value", "scale", "expected"),
    [
        (47.25, 10, 472),
        (0.0, 1000, 0),
        (0.1234, 1000, 123),
        (None, 10, U16_NO_DATA),
        (math.nan, 10, U16_NO_DATA),
        (1e9, 10, 65534),
        (-1.0, 10, 0),
    ],
)
def test_quantize_u16(value: float | None, scale: int, expected: int) -> None:
    assert quantize_u16(value, scale) == expected


def test_encoders_round_trip() -> None:
    assert base64.b64decode(encode_u8([0, 4, 255])) == bytes([0, 4, 255])
    assert decode_u16(encode_u16([1.5, None, 0.0], 10)) == [15, U16_NO_DATA, 0]
    # Little-endian: 258 = 0x0102 -> bytes 02 01.
    assert base64.b64decode(encode_u16([25.8], 10)) == b"\x02\x01"


def test_encode_heatmap_is_frame_major_and_complete() -> None:
    cells: list[Cell] = [(41.2, -105.6), (41.4, -105.8)]
    series = {cells[0]: location(50.0, snow=1.25), cells[1]: location(10.0, rain=0.05)}
    frames = build_frames(cells, series, T0, 45_000, hours=3)
    enc = encode_heatmap(frames, 0.2)
    assert (enc.count, enc.hours, enc.cell_deg, enc.base_time_utc) == (2, 3, 0.2, T0)
    assert enc.lat == (41.2, 41.4)
    assert enc.lon == (-105.6, -105.8)
    assert list(base64.b64decode(enc.levels_b64)) == [4, 0] * 3
    assert decode_u16(enc.wind_mph_x10_b64) == [500, 100] * 3
    assert decode_u16(enc.rain_in_hr_x1000_b64) == [0, 50] * 3
    assert decode_u16(enc.snow_in_hr_x100_b64) == [125, 0] * 3
