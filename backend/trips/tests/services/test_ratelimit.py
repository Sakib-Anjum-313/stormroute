from __future__ import annotations

import httpx
import pytest

from trips.services.errors import UpstreamRateLimitedError
from trips.services.http import DEFAULT_RETRY_AFTER_S, retry_after_s
from trips.services.memo import TTLMemo
from trips.services.ratelimit import TokenBucket, backoff_delays


class FakeClock:
    def __init__(self) -> None:
        self.t = 1000.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.t += seconds


def bucket(clock: FakeClock, capacity: float = 500) -> TokenBucket:
    return TokenBucket(capacity, 60.0, clock=clock, sleep=clock.sleep)


def test_acquire_within_capacity_does_not_wait() -> None:
    clock = FakeClock()
    b = bucket(clock)
    for _ in range(5):
        b.acquire(100, max_wait_s=0)
    assert clock.slept == []
    assert b.tokens == pytest.approx(0)


def test_acquire_waits_for_the_refill() -> None:
    clock = FakeClock()
    b = bucket(clock)
    b.acquire(500, max_wait_s=0)
    b.acquire(100, max_wait_s=30)  # 100 locations at 500/min take 12 s to refill
    assert clock.slept == [pytest.approx(12.0)]


def test_acquire_raises_instead_of_waiting_past_the_budget() -> None:
    clock = FakeClock()
    b = bucket(clock)
    b.acquire(500, max_wait_s=0)
    with pytest.raises(UpstreamRateLimitedError) as info:
        b.acquire(100, max_wait_s=5)
    assert info.value.retry_after_s == 12
    assert b.tokens == pytest.approx(0)  # nothing was reserved


def test_refill_is_capped_at_capacity() -> None:
    clock = FakeClock()
    b = bucket(clock)
    clock.t += 3600
    assert b.tokens == 500


def test_server_remaining_lowers_the_estimate() -> None:
    clock = FakeClock()
    b = bucket(clock)
    b.observe_remaining(40)
    assert b.tokens == 40
    b.observe_remaining(400)  # never raises the estimate
    assert b.tokens == 40


def test_bucket_rejects_impossible_requests() -> None:
    clock = FakeClock()
    with pytest.raises(ValueError, match="more tokens"):
        bucket(clock, capacity=10).acquire(11, max_wait_s=60)
    with pytest.raises(ValueError, match="positive"):
        TokenBucket(0)


def test_backoff_is_jittered_around_the_base_delays() -> None:
    delays = list(backoff_delays([1.0, 3.0], jitter=0.25))
    assert len(delays) == 2
    assert 0.75 <= delays[0] <= 1.25
    assert 2.25 <= delays[1] <= 3.75


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        ({"Retry-After": "42"}, 42),
        ({"Retry-After": "0"}, 1),
        ({"x-ratelimit-reset": "1060"}, 60),
        ({"x-ratelimit-reset": "999"}, DEFAULT_RETRY_AFTER_S),  # already past
        ({"x-ratelimit-reset": "soon"}, DEFAULT_RETRY_AFTER_S),
        ({"Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT"}, DEFAULT_RETRY_AFTER_S),
        ({}, DEFAULT_RETRY_AFTER_S),
    ],
)
def test_retry_after_from_headers(headers: dict[str, str], expected: int) -> None:
    assert retry_after_s(httpx.Response(429, headers=headers), now_epoch_s=1000.0) == expected


def test_memo_expires_and_evicts_least_recently_used() -> None:
    clock = FakeClock()
    memo: TTLMemo[int] = TTLMemo(10.0, max_entries=2, clock=clock)
    memo.set("a", 1)
    memo.set("b", 2)
    assert memo.get("a") == 1  # "a" is now the most recently used
    memo.set("c", 3)
    assert memo.get("b") is None
    assert memo.get("a") == 1
    clock.t += 10
    assert memo.get("a") is None
    assert memo.get("missing") is None
