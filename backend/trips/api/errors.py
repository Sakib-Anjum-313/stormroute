"""Map every failure to the contract's error shape (api-contracts skill, "Error shape").

``{"error": {"code", "message", "details", "retry_after_s"}}`` with the status from the table.
Messages come from our own exception classes, never from upstream bodies or URLs.
"""

from __future__ import annotations

import logging
import math
from typing import Any

from django.http import HttpRequest, JsonResponse
from rest_framework import exceptions

from trips.api.requestid import current_request_id
from trips.services.errors import PlanError

log = logging.getLogger(__name__)


def error_body(
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    retry_after_s: int | None = None,
) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
            "retry_after_s": retry_after_s,
        }
    }


def _json(status: int, body: dict[str, Any]) -> JsonResponse:
    response = JsonResponse(body, status=status)
    retry = body["error"]["retry_after_s"]
    if retry is not None:
        response["Retry-After"] = str(retry)
    return response


def plan_error_body(exc: PlanError) -> dict[str, Any]:
    return error_body(exc.code, exc.message, exc.details, exc.retry_after_s)


def internal_error_body() -> dict[str, Any]:
    ref = current_request_id()
    return error_body("INTERNAL", f"Something went wrong (ref {ref}).", {"request_id": ref})


def exception_handler(exc: Exception, context: dict[str, Any]) -> JsonResponse:
    """DRF exception handler. Unexpected exceptions become INTERNAL and are logged."""
    if isinstance(exc, PlanError):
        if exc.http_status >= 500:
            log.warning("upstream error %s: %s", exc.code, exc.message)
        return _json(exc.http_status, plan_error_body(exc))
    if isinstance(exc, exceptions.Throttled):
        wait = max(1, math.ceil(getattr(exc, "wait", None) or 1))
        return _json(
            429,
            error_body(
                "RATE_LIMITED", "Too many requests. Slow down and retry.", retry_after_s=wait
            ),
        )
    if isinstance(exc, exceptions.ValidationError):
        raw = exc.detail if isinstance(exc.detail, dict) else {"non_field_errors": exc.detail}
        details = {str(field): errors for field, errors in raw.items()}
        return _json(400, error_body("VALIDATION", "The request is invalid.", details))
    if isinstance(exc, exceptions.ParseError):
        return _json(400, error_body("VALIDATION", "The request body is not valid JSON."))
    if isinstance(exc, exceptions.APIException):
        return _json(exc.status_code, error_body("VALIDATION", str(exc.detail)))
    log.exception("unhandled error", exc_info=exc)
    return _json(500, internal_error_body())


def not_found(request: HttpRequest, exception: Exception | None = None) -> JsonResponse:
    return _json(404, error_body("VALIDATION", "Not found."))


def server_error(request: HttpRequest) -> JsonResponse:
    return _json(500, internal_error_body())
