"""Per-client throttles (10 plans/min, 60 geocodes/min). Auth is disabled, so key on the IP.

Behind Render, every request reaches gunicorn from Render's proxy, so ``REMOTE_ADDR`` is the
same for everyone, and ``X-Forwarded-For`` is appended to (spoofable) with an undocumented
hop count. Render sits behind Cloudflare, whose edge sets ``CF-Connecting-IP`` to the real
client address and overwrites any value the client sent. ``CLIENT_IP_HEADER`` opts into such
a header; when it's unset or missing we fall back to DRF's ``NUM_PROXIES`` handling.
"""

from __future__ import annotations

import ipaddress
import logging
import threading

from django.conf import settings
from rest_framework.request import Request
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

log = logging.getLogger(__name__)
_reported = threading.Event()


def _report_once(header: str, present: bool, request: Request) -> None:
    """Log once per process whether the client-IP header arrives (never the IP itself)."""
    if _reported.is_set():
        return
    _reported.set()
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    hops = len([part for part in xff.split(",") if part.strip()])
    log.info("client ip: header %s present=%s, x-forwarded-for entries=%d", header, present, hops)


class _PerIPThrottle(SimpleRateThrottle):
    def get_ident(self, request: Request) -> str:
        header: str = settings.CLIENT_IP_HEADER
        if header:
            meta_key = "HTTP_" + header.upper().replace("-", "_")
            value = request.META.get(meta_key, "").strip()
            _report_once(header, bool(value), request)
            try:
                return str(ipaddress.ip_address(value))
            except ValueError:
                pass  # missing or malformed: use DRF's default below
        return super().get_ident(request)

    def get_cache_key(self, request: Request, view: APIView) -> str:
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class PlanThrottle(_PerIPThrottle):
    scope = "plan"


class GeocodeThrottle(_PerIPThrottle):
    scope = "geocode"
