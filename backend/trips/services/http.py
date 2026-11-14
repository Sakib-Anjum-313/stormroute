"""Shared HTTP plumbing for upstream clients: one pooled client and a retry loop.

httpx logs full request URLs at INFO, which would include the TomTom key, so its loggers are
raised to WARNING in settings. Nothing here logs a URL either.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Sequence

import httpx
from django.conf import settings

from trips.services.errors import (
    UpstreamRateLimitedError,
    UpstreamTimeoutError,
    UpstreamUnavailableError,
)
from trips.services.ratelimit import backoff_delays

log = logging.getLogger(__name__)

RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})
DEFAULT_RETRY_AFTER_S = 30

_client: httpx.Client | None = None
_client_lock = threading.Lock()


def shared_client() -> httpx.Client:
    """A process-wide pooled client (thread-safe). Timeouts are set per request."""
    global _client
    with _client_lock:
        if _client is None:
            _client = httpx.Client(
                limits=httpx.Limits(max_connections=16, max_keepalive_connections=8),
                headers={"User-Agent": "spotter-truck-routing/0.1"},
            )
        return _client


def retry_after_s(response: httpx.Response, now_epoch_s: float | None = None) -> int:
    """Seconds to wait from ``Retry-After`` or Open-Meteo's ``x-ratelimit-reset`` (epoch s)."""
    header = response.headers.get("retry-after")
    if header and header.strip().isdigit():
        return max(1, int(header))
    reset = response.headers.get("x-ratelimit-reset")
    if reset:
        try:
            wait = float(reset) - (time.time() if now_epoch_s is None else now_epoch_s)
        except ValueError:
            wait = 0
        if wait > 0:
            return max(1, round(wait + 0.5))
    return DEFAULT_RETRY_AFTER_S


def send_with_retries(
    service: str,
    send: Callable[[], httpx.Response],
    *,
    retry_delays_s: Sequence[float] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> httpx.Response:
    """Call ``send`` and retry 429/5xx and connection errors with jittered backoff.

    Returns the first non-retryable response (the caller maps 4xx bodies). After the retries
    are spent: 429 raises ``UpstreamRateLimitedError``; 5xx and connection errors raise
    ``UpstreamUnavailableError``. A timeout is not retried (the plan has a total time budget) and
    raises ``UpstreamTimeoutError``.
    """
    delays = list(
        backoff_delays(
            settings.UPSTREAM_RETRY_DELAYS_S if retry_delays_s is None else retry_delays_s
        )
    )
    attempt = 0
    while True:
        started = time.monotonic()
        try:
            response = send()
        except httpx.TimeoutException as exc:
            log.warning("%s timed out after %.1f s", service, time.monotonic() - started)
            raise UpstreamTimeoutError(f"The {service} service timed out.") from exc
        except httpx.TransportError as exc:
            log.warning("%s connection error: %s", service, type(exc).__name__)
            if attempt < len(delays):
                sleep(delays[attempt])
                attempt += 1
                continue
            raise UpstreamUnavailableError(f"The {service} service is unreachable.") from exc
        log.info(
            "%s HTTP %s in %.0f ms",
            service,
            response.status_code,
            (time.monotonic() - started) * 1e3,
        )
        if response.status_code not in RETRYABLE_STATUS:
            return response
        if attempt < len(delays):
            sleep(delays[attempt])
            attempt += 1
            continue
        if response.status_code == 429:
            raise UpstreamRateLimitedError(
                f"The {service} service is busy. Try again shortly.",
                retry_after_s=retry_after_s(response),
            )
        raise UpstreamUnavailableError(f"The {service} service is unavailable.")
