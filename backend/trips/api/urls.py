from django.urls import path

from trips.api.views import GeocodeView, HealthView, PlanView, StreamProbeView

urlpatterns = [
    path("plan", PlanView.as_view(), name="plan"),
    path("geocode", GeocodeView.as_view(), name="geocode"),
    path("healthz", HealthView.as_view(), name="healthz"),
    path("healthz/stream", StreamProbeView.as_view(), name="healthz-stream"),
]
