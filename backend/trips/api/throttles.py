"""Per-IP throttles (10 plans/min, 60 geocodes/min). Auth is disabled, so key on the IP."""

from __future__ import annotations

from rest_framework.request import Request
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView


class _PerIPThrottle(SimpleRateThrottle):
    def get_cache_key(self, request: Request, view: APIView) -> str:
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class PlanThrottle(_PerIPThrottle):
    scope = "plan"


class GeocodeThrottle(_PerIPThrottle):
    scope = "geocode"
