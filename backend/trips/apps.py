from django.apps import AppConfig


class TripsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "trips"

    def ready(self) -> None:
        # timezonefinder loads its polygon data lazily (about a second on a small instance).
        # Load it at boot so the first trip request doesn't pay for it.
        from trips.services.timezones import tz_at

        tz_at(39.74, -104.99)
