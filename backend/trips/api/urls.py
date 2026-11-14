from django.urls import path

from trips.api.views import HealthView, StreamProbeView

urlpatterns = [
    path("healthz", HealthView.as_view(), name="healthz"),
    path("healthz/stream", StreamProbeView.as_view(), name="healthz-stream"),
]
