"""Comparator: one case per step (0-4) where that step alone decides, a full tie, all-NT."""

from __future__ import annotations

import math

import pytest

from trips.domain.attribution import Aggregates
from trips.domain.levels import Level
from trips.domain.recommend import ROUTE_ORDER, STEPS, RouteScore, recommend, route_key


def score(
    route_id: str,
    index: int,
    *,
    nt: float = 0.0,
    severe: float = 0.0,
    high: float = 0.0,
    avg: float | None = 0.5,
    duration_s: float = 3600.0,
) -> RouteScore:
    miles = {level: 0.0 for level in Level}
    miles[Level.NO_TRAVEL] = nt
    miles[Level.SEVERE] = severe
    miles[Level.HIGH] = high
    agg = Aggregates(
        miles_by_level=miles,
        no_data_mi=0.0,
        avg_risk=avg,
        max_level=Level.HIGH,
        checkpoint_count=10,
    )
    return RouteScore(route_id=route_id, index=index, aggregates=agg, duration_s=duration_s)


# Route B is better at exactly one step; A is better at every later step, so only that step
# can make B win.
STEP_CASES = [
    (
        "no_travel_mi",
        score("A", 0, nt=1.0, severe=0, high=0, avg=0.1, duration_s=3600),
        score("B", 1, nt=0.0, severe=90, high=90, avg=3.0, duration_s=9999),
    ),
    (
        "severe_mi",
        score("A", 0, severe=18.5, high=0, avg=0.1, duration_s=3600),
        score("B", 1, severe=0.0, high=40, avg=3.0, duration_s=9999),
    ),
    (
        "high_mi",
        score("A", 0, severe=5, high=22.5, avg=0.1, duration_s=3600),
        score("B", 1, severe=5, high=10.0, avg=3.0, duration_s=9999),
    ),
    (
        "avg_risk",
        score("A", 0, severe=5, high=10, avg=1.12, duration_s=3600),
        score("B", 1, severe=5, high=10, avg=0.91, duration_s=9999),
    ),
    (
        "duration_min",
        score("A", 0, severe=5, high=10, avg=0.91, duration_s=31_000),
        score("B", 1, severe=5, high=10, avg=0.91, duration_s=28_900),
    ),
]


@pytest.mark.parametrize(("step", "a", "b"), STEP_CASES, ids=[c[0] for c in STEP_CASES])
def test_each_step_alone_decides(step: str, a: RouteScore, b: RouteScore) -> None:
    rec = recommend([a, b])
    assert rec.route_id == "B"
    assert rec.ranking == ("B", "A")
    assert rec.decided_by == {"A": step}
    assert rec.decisive_step == step
    assert rec.all_no_travel is False


def test_full_tie_resolves_to_provider_order() -> None:
    routes = [score("C", 2), score("A", 0), score("B", 1)]
    rec = recommend(routes)
    assert rec.route_id == "A"
    assert rec.ranking == ("A", "B", "C")
    assert rec.decided_by == {"B": ROUTE_ORDER, "C": ROUTE_ORDER}
    assert rec.decisive_step == ROUTE_ORDER


def test_float_noise_below_rounding_is_a_tie() -> None:
    a = score("A", 0, severe=10.04, high=5.0, avg=1.004, duration_s=3600)
    b = score("B", 1, severe=10.0, high=5.03, avg=1.0, duration_s=3610)
    rec = recommend([b, a])
    assert rec.route_id == "A"
    assert rec.decisive_step == ROUTE_ORDER


def test_all_no_travel_still_ranks() -> None:
    a = score("A", 0, nt=12.0)
    b = score("B", 1, nt=3.0)
    c = score("C", 2, nt=0.5)
    rec = recommend([a, b, c])
    assert rec.all_no_travel is True
    assert rec.ranking == ("C", "B", "A")


def test_decided_by_records_each_loser_against_the_winner() -> None:
    a = score("A", 0, severe=18.5, high=40.0, avg=1.12, duration_s=482 * 60)
    b = score("B", 1, severe=0.0, high=22.5, avg=0.91, duration_s=515 * 60)
    c = score("C", 2, severe=0.0, high=22.5, avg=0.70, duration_s=530 * 60)
    rec = recommend([a, b, c])
    assert rec.route_id == "C"
    assert rec.ranking == ("C", "B", "A")
    assert rec.decided_by == {"B": "avg_risk", "A": "severe_mi"}
    assert rec.decisive_step == "avg_risk"
    assert rec.keys["A"] == (0.0, 18.5, 40.0, 1.12, 482, 0)
    assert rec.keys["C"] == (0.0, 0.0, 22.5, 0.7, 530, 2)


def test_route_without_any_data_sorts_last_on_average() -> None:
    blind = score("A", 0, avg=None)
    seen = score("B", 1, avg=3.9)
    assert route_key(blind)[3] == math.inf
    rec = recommend([blind, seen])
    assert rec.route_id == "B"
    assert rec.decided_by == {"A": "avg_risk"}


def test_single_route_and_validation() -> None:
    rec = recommend([score("A", 0)])
    assert rec.route_id == "A"
    assert rec.decided_by == {}
    assert rec.decisive_step is None
    with pytest.raises(ValueError, match="zero routes"):
        recommend([])
    with pytest.raises(ValueError, match="unique"):
        recommend([score("A", 0), score("A", 1)])


def test_steps_are_in_spec_order() -> None:
    assert STEPS == ("no_travel_mi", "severe_mi", "high_mi", "avg_risk", "duration_min")
