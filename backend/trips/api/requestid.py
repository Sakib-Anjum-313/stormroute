"""Request ids: accepted from ``X-Request-ID`` when well formed, otherwise generated.

The id is echoed in the response header, added to every log line and returned in the
``details`` of INTERNAL errors so a user-reported "ref" can be found in the logs.
"""

from __future__ import annotations

import contextvars
import logging
import re
import uuid
from collections.abc import Callable

from django.http import HttpRequest, HttpResponseBase

_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
_current: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


def current_request_id() -> str:
    return _current.get()


class RequestIDMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponseBase]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponseBase:
        incoming = request.headers.get("X-Request-ID", "")
        request_id = incoming if _SAFE_ID.match(incoming) else uuid.uuid4().hex[:12]
        _current.set(request_id)
        response = self.get_response(request)
        response["X-Request-ID"] = request_id
        return response


class RequestIDLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = current_request_id()
        return True
