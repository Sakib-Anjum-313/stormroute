"""Upstream failures, raised by the services layer and mapped to the API error shape.

Messages are fixed, user-facing strings. They never include upstream URLs, query strings or
response bodies, so an API key can never leak through an error.
"""

from __future__ import annotations


class PlanError(Exception):
    code = "INTERNAL"
    http_status = 500
    default_message = "Something went wrong."

    def __init__(
        self,
        message: str | None = None,
        *,
        retry_after_s: int | None = None,
        details: dict[str, object] | None = None,
    ) -> None:
        self.message = message or self.default_message
        self.retry_after_s = retry_after_s
        self.details = details or {}
        super().__init__(self.message)


class InvalidRequestError(PlanError):
    code = "VALIDATION"
    http_status = 400
    default_message = "The request is invalid."


class NoRouteError(PlanError):
    code = "NO_ROUTE"
    http_status = 422
    default_message = "No truck route between these points."


class UpstreamRateLimitedError(PlanError):
    code = "UPSTREAM_RATE_LIMITED"
    http_status = 503
    default_message = "An upstream service is rate limiting us. Try again shortly."


class UpstreamUnavailableError(PlanError):
    code = "UPSTREAM_UNAVAILABLE"
    http_status = 502
    default_message = "An upstream service is unavailable."


class UpstreamTimeoutError(PlanError):
    code = "UPSTREAM_TIMEOUT"
    http_status = 504
    default_message = "An upstream service timed out."
