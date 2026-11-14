"""Request validation and the documented response schema (api-contracts skill).

Request serializers validate input. Response serializers only describe the JSON for
drf-spectacular (and from there the generated TypeScript types); the views build responses
with ``trips.api.present`` because DRF serialization is too slow for a full plan.
"""

from __future__ import annotations

import datetime as dt
from typing import Any
from zoneinfo import ZoneInfo

from rest_framework import serializers

from trips.domain.geometry import METERS_PER_MILE, haversine_m
from trips.domain.levels import Level
from trips.domain.recommend import ROUTE_ORDER, STEPS
from trips.domain.types import LatLon
from trips.services import clock
from trips.services.planner import INTERVALS_MI, Endpoint, PlanRequest, PlanWarning
from trips.services.timezones import tz_at

LEVELS = [level.name for level in Level]
DECIDING_STEPS = [*STEPS, ROUTE_ORDER]
PAST_GRACE_S = 15 * 60
MAX_AHEAD_S = 7 * 24 * 3600
MIN_WEIGHT_LB = 1
MAX_WEIGHT_LB = 200_000
FEDERAL_GROSS_LIMIT_LB = 80_000
MIN_TRIP_MI = 1.0
ERROR_CODES = [
    "VALIDATION",
    "NO_ROUTE",
    "RATE_LIMITED",
    "UPSTREAM_RATE_LIMITED",
    "UPSTREAM_UNAVAILABLE",
    "UPSTREAM_TIMEOUT",
    "INTERNAL",
]
WARNING_CODES = [
    "OVER_FEDERAL_GROSS_LIMIT",
    "FEWER_THAN_3_ROUTES",
    "WEATHER_PARTIAL",
    "BEYOND_FORECAST_HORIZON",
    "WEATHER_COARSENED",
]


class HealthSerializer(serializers.Serializer[dict[str, str]]):
    status = serializers.CharField()
    version = serializers.CharField()


# --- requests ---------------------------------------------------------------------------


class PlaceInSerializer(serializers.Serializer[dict[str, Any]]):
    label = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")  # type: ignore[assignment]  # field names shadow Field attributes
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)


class PlanRequestSerializer(serializers.Serializer[dict[str, Any]]):
    origin = PlaceInSerializer()
    destination = PlaceInSerializer()
    departure_local = serializers.CharField(
        max_length=19,
        help_text="Wall-clock time at the origin without an offset, e.g. 2026-11-15T06:00.",
    )
    load_weight_lb = serializers.FloatField(min_value=MIN_WEIGHT_LB, max_value=MAX_WEIGHT_LB)
    apply_hos = serializers.BooleanField(default=False)

    def validate_departure_local(self, value: str) -> dt.datetime:
        try:
            parsed = dt.datetime.fromisoformat(value)
        except ValueError as exc:
            raise serializers.ValidationError("Use the format YYYY-MM-DDTHH:MM.") from exc
        if parsed.tzinfo is not None:
            raise serializers.ValidationError(
                "Send the origin's local wall-clock time without an offset."
            )
        return parsed

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        origin = LatLon(attrs["origin"]["lat"], attrs["origin"]["lon"])
        destination = LatLon(attrs["destination"]["lat"], attrs["destination"]["lon"])
        if haversine_m(origin, destination) / METERS_PER_MILE <= MIN_TRIP_MI:
            raise serializers.ValidationError(
                {"destination": ["Origin and destination must be more than 1 mile apart."]}
            )
        origin_tz = tz_at(origin.lat, origin.lon)
        local: dt.datetime = attrs["departure_local"]
        departure_utc = local.replace(tzinfo=ZoneInfo(origin_tz)).timestamp()
        now = clock.now_utc()
        if departure_utc < now - PAST_GRACE_S:
            raise serializers.ValidationError({"departure_local": ["Departure is in the past."]})
        if departure_utc > now + MAX_AHEAD_S:
            raise serializers.ValidationError(
                {"departure_local": ["Departure must be within the next 7 days."]}
            )
        attrs["departure_utc"] = max(departure_utc, now)  # a time a few minutes ago means now
        attrs["origin_tz"] = origin_tz
        return attrs

    def to_plan_request(self) -> PlanRequest:
        data = self.validated_data
        warnings = []
        if data["load_weight_lb"] > FEDERAL_GROSS_LIMIT_LB:
            warnings.append(
                PlanWarning(
                    "OVER_FEDERAL_GROSS_LIMIT",
                    "Load is above the 80,000 lb federal gross limit; a permit is required.",
                )
            )
        return PlanRequest(
            origin=Endpoint(data["origin"]["label"], data["origin"]["lat"], data["origin"]["lon"]),
            destination=Endpoint(
                data["destination"]["label"], data["destination"]["lat"], data["destination"]["lon"]
            ),
            departure_utc=data["departure_utc"],
            origin_tz=data["origin_tz"],
            load_weight_lb=data["load_weight_lb"],
            apply_hos=data["apply_hos"],
            warnings=tuple(warnings),
        )


class GeocodeQuerySerializer(serializers.Serializer[dict[str, Any]]):
    q = serializers.CharField(min_length=3, max_length=120, trim_whitespace=True)
    limit = serializers.IntegerField(min_value=1, max_value=10, default=5)


# --- responses (schema only) ------------------------------------------------------------


class GeocodeResultSerializer(serializers.Serializer[dict[str, Any]]):
    label = serializers.CharField()  # type: ignore[assignment]  # field names shadow Field attributes
    lat = serializers.FloatField()
    lon = serializers.FloatField()
    kind = serializers.ChoiceField(choices=["Geo", "PAD", "Addr", "Str", "POI"])


class GeocodeResponseSerializer(serializers.Serializer[dict[str, Any]]):
    results = GeocodeResultSerializer(many=True)


class ErrorBodySerializer(serializers.Serializer[dict[str, Any]]):
    code = serializers.ChoiceField(choices=ERROR_CODES)
    message = serializers.CharField()
    details = serializers.DictField(child=serializers.JSONField())
    retry_after_s = serializers.IntegerField(allow_null=True)


class ErrorSerializer(serializers.Serializer[dict[str, Any]]):
    error = ErrorBodySerializer()


class WarningSerializer(serializers.Serializer[dict[str, Any]]):
    code = serializers.ChoiceField(choices=WARNING_CODES)
    message = serializers.CharField()


class RouteSummarySerializer(serializers.Serializer[dict[str, Any]]):
    distance_mi = serializers.FloatField()
    duration_s = serializers.IntegerField(help_text="Driving time plus HOS stops.")
    driving_s = serializers.IntegerField()
    hos_stop_s = serializers.IntegerField()
    departure_utc = serializers.DateTimeField()
    arrival_utc = serializers.DateTimeField()
    traffic_delay_s = serializers.IntegerField()


class GeometrySerializer(serializers.Serializer[dict[str, Any]]):
    encoding = serializers.ChoiceField(choices=["polyline6"])
    value = serializers.CharField()


class HosStopSerializer(serializers.Serializer[dict[str, Any]]):
    kind = serializers.ChoiceField(choices=["break", "rest"])
    mile = serializers.FloatField()
    lat = serializers.FloatField()
    lon = serializers.FloatField()
    start_utc = serializers.DateTimeField()
    duration_s = serializers.IntegerField()


class RouteSerializer(serializers.Serializer[dict[str, Any]]):
    id = serializers.CharField()
    label = serializers.CharField()  # type: ignore[assignment]  # field names shadow Field attributes
    source = serializers.ChoiceField(choices=["tomtom", "via_point"])  # type: ignore[assignment]  # field names shadow Field attributes
    summary = RouteSummarySerializer()
    geometry = GeometrySerializer()
    stops = HosStopSerializer(many=True, help_text="HOS stops; empty when apply_hos is off.")


class CheckpointWeatherSerializer(serializers.Serializer[dict[str, Any]]):
    wind_mph = serializers.FloatField(allow_null=True)
    gust_mph = serializers.FloatField(allow_null=True)
    rain_in_hr = serializers.FloatField(allow_null=True)
    snow_in_hr = serializers.FloatField(allow_null=True)
    cell = serializers.ListField(child=serializers.FloatField(), min_length=2, max_length=2)


class VariableLevelsSerializer(serializers.Serializer[dict[str, Any]]):
    wind = serializers.ChoiceField(choices=LEVELS)
    rain = serializers.ChoiceField(choices=LEVELS)
    snow = serializers.ChoiceField(choices=LEVELS)


class TriggerSerializer(serializers.Serializer[dict[str, Any]]):
    rule = serializers.CharField()
    detail = serializers.CharField()


class CheckpointSerializer(serializers.Serializer[dict[str, Any]]):
    mile = serializers.FloatField()
    lat = serializers.FloatField()
    lon = serializers.FloatField()
    kind = serializers.ChoiceField(choices=["origin", "interval", "destination"])
    owned_mi = serializers.FloatField()
    eta_utc = serializers.DateTimeField()
    tz = serializers.CharField()
    status = serializers.ChoiceField(choices=["ok", "no_data"])
    weather = CheckpointWeatherSerializer(allow_null=True)
    level = serializers.ChoiceField(choices=LEVELS, allow_null=True)
    score = serializers.IntegerField(allow_null=True)
    levels = VariableLevelsSerializer(allow_null=True)
    triggers = TriggerSerializer(many=True)


class MilesByLevelSerializer(serializers.Serializer[dict[str, Any]]):
    def get_fields(self) -> dict[str, serializers.Field[Any, Any, Any, Any]]:
        return {name: serializers.FloatField() for name in [*LEVELS, "NO_DATA"]}


class AggregatesSerializer(serializers.Serializer[dict[str, Any]]):
    miles_by_level = MilesByLevelSerializer()
    avg_risk = serializers.FloatField(allow_null=True)
    max_level = serializers.ChoiceField(choices=LEVELS, allow_null=True)
    checkpoint_count = serializers.IntegerField()


class IntervalSerializer(serializers.Serializer[dict[str, Any]]):
    checkpoints = CheckpointSerializer(many=True)
    aggregates = AggregatesSerializer()


class IntervalsSerializer(serializers.Serializer[dict[str, Any]]):
    def get_fields(self) -> dict[str, serializers.Field[Any, Any, Any, Any]]:
        return {str(i): IntervalSerializer() for i in INTERVALS_MI}


class PlanRouteSerializer(RouteSerializer):
    intervals = IntervalsSerializer()


class RecommendationSerializer(serializers.Serializer[dict[str, Any]]):
    route_id = serializers.CharField()
    ranking = serializers.ListField(child=serializers.CharField())
    all_no_travel = serializers.BooleanField()
    steps = serializers.ListField(child=serializers.ChoiceField(choices=list(STEPS)))
    keys = serializers.DictField(
        child=serializers.ListField(child=serializers.FloatField(allow_null=True)),
        help_text="Comparator key per route, in `steps` order; avg_risk is null without data.",
    )
    decided_by = serializers.DictField(
        child=serializers.ChoiceField(choices=DECIDING_STEPS),
        help_text="For every non-winning route, the first step at which it lost.",
    )
    decisive_step = serializers.ChoiceField(
        choices=DECIDING_STEPS,
        allow_null=True,
        help_text="The step that separated the winner from the runner-up.",
    )


class RecommendationsSerializer(serializers.Serializer[dict[str, Any]]):
    def get_fields(self) -> dict[str, serializers.Field[Any, Any, Any, Any]]:
        return {str(i): RecommendationSerializer() for i in INTERVALS_MI}


class HeatmapSerializer(serializers.Serializer[dict[str, Any]]):
    base_time_utc = serializers.DateTimeField()
    hours = serializers.IntegerField()
    cell_deg = serializers.FloatField()
    count = serializers.IntegerField()
    lat = serializers.ListField(child=serializers.FloatField())
    lon = serializers.ListField(child=serializers.FloatField())
    levels_b64 = serializers.CharField(
        help_text="Uint8, frame-major (idx = h * count + i); 255 = no data."
    )
    wind_mph_x10_b64 = serializers.CharField(help_text="Uint16 LE; 65535 = no data.")
    rain_in_hr_x1000_b64 = serializers.CharField(help_text="Uint16 LE; 65535 = no data.")
    snow_in_hr_x100_b64 = serializers.CharField(help_text="Uint16 LE; 65535 = no data.")


class PlanSerializer(serializers.Serializer[dict[str, Any]]):
    departure_utc = serializers.DateTimeField()
    origin_tz = serializers.CharField()
    generated_at = serializers.DateTimeField()
    load_weight_lb = serializers.FloatField()
    apply_hos = serializers.BooleanField()
    routes = PlanRouteSerializer(many=True)
    recommendation = RecommendationsSerializer()
    heatmap = HeatmapSerializer()
    warnings = WarningSerializer(many=True)


class MetaEventSerializer(serializers.Serializer[dict[str, Any]]):
    type = serializers.ChoiceField(choices=["meta"])
    departure_utc = serializers.DateTimeField()
    origin_tz = serializers.CharField()


class RoutesEventSerializer(serializers.Serializer[dict[str, Any]]):
    type = serializers.ChoiceField(choices=["routes"])
    routes = RouteSerializer(many=True)


class ProgressEventSerializer(serializers.Serializer[dict[str, Any]]):
    type = serializers.ChoiceField(choices=["progress"])
    stage = serializers.ChoiceField(choices=["weather"])
    done = serializers.IntegerField()
    total = serializers.IntegerField()


class ResultEventSerializer(serializers.Serializer[dict[str, Any]]):
    type = serializers.ChoiceField(choices=["result"])
    plan = PlanSerializer()


class ErrorEventSerializer(serializers.Serializer[dict[str, Any]]):
    type = serializers.ChoiceField(choices=["error"])
    error = ErrorBodySerializer()
