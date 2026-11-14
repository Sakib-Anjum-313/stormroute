"""Django settings for the Spotter API.

All configuration comes from environment variables (see backend/.env.example).
The app is stateless: there are no models and no database is required.
"""

import os
from pathlib import Path

import environ
from corsheaders.defaults import default_headers as default_cors_headers

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, ["http://localhost:5173"]),
    TOMTOM_API_KEY=(str, ""),
    OPEN_METEO_BASE_URL=(str, "https://api.open-meteo.com"),
    OPEN_METEO_API_KEY=(str, ""),
    REDIS_URL=(str, ""),
    PLAN_FIXTURES=(bool, False),
    TOMTOM_BASE_URL=(str, "https://api.tomtom.com"),
    DRF_NUM_PROXIES=(int, 0),
    CLIENT_IP_HEADER=(str, ""),
    PLAN_THROTTLE_RATE=(str, "10/min"),
)
environ.Env.read_env(BASE_DIR / ".env", overwrite=False)

DEBUG: bool = env("DJANGO_DEBUG")
SECRET_KEY: str = env("DJANGO_SECRET_KEY", default="dev-insecure-change-me" if DEBUG else None)
ALLOWED_HOSTS: list[str] = env("ALLOWED_HOSTS")
# Render injects the service's own onrender.com hostname, so a suffixed subdomain still works.
if render_host := os.environ.get("RENDER_EXTERNAL_HOSTNAME"):
    ALLOWED_HOSTS.append(render_host)

INSTALLED_APPS = [
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "drf_spectacular",
    "trips",
]

MIDDLEWARE = [
    "trips.api.requestid.RequestIDMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.gzip.GZipMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# Stateless service: no database.
DATABASES: dict[str, dict[str, str]] = {}

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    }
]

if env("REDIS_URL"):
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": env("REDIS_URL"),
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "OPTIONS": {"MAX_ENTRIES": 20_000},
        }
    }

CORS_ALLOWED_ORIGINS: list[str] = env("CORS_ALLOWED_ORIGINS")
CORS_EXPOSE_HEADERS = ["Server-Timing", "X-Request-ID", "Retry-After"]
CORS_ALLOW_HEADERS = (*default_cors_headers, "x-fixture", "x-request-id")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "URL_FORMAT_OVERRIDE": None,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_RATES": {"plan": env("PLAN_THROTTLE_RATE"), "geocode": "60/min"},
    # Proxy hops in front of the app. 0 ignores X-Forwarded-For (a client can set any value);
    # n trusts the n-th entry from the right, the one the outermost proxy appended.
    "NUM_PROXIES": env("DRF_NUM_PROXIES"),
    "EXCEPTION_HANDLER": "trips.api.errors.exception_handler",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Spotter Weather-Aware Truck Routing API",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "ENUM_NAME_OVERRIDES": {
        "RiskLevelEnum": "trips.api.serializers.LEVELS",
        "DecidingStepEnum": "trips.api.serializers.DECIDING_STEPS",
    },
}

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

USE_TZ = True
TIME_ZONE = "UTC"
LANGUAGE_CODE = "en-us"
USE_I18N = False

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {"request_id": {"()": "trips.api.requestid.RequestIDLogFilter"}},
    "formatters": {
        "plain": {"format": "%(asctime)s %(levelname)s [%(request_id)s] %(name)s %(message)s"}
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "plain",
            "filters": ["request_id"],
        }
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    # httpx logs full request URLs at INFO, and TomTom URLs carry the API key.
    "loggers": {
        "httpx": {"level": "WARNING"},
        "httpcore": {"level": "WARNING"},
    },
}

# --- Spotter-specific settings ---
TOMTOM_API_KEY: str = env("TOMTOM_API_KEY")
TOMTOM_BASE_URL: str = env("TOMTOM_BASE_URL")
OPEN_METEO_BASE_URL: str = env("OPEN_METEO_BASE_URL")
OPEN_METEO_API_KEY: str = env("OPEN_METEO_API_KEY")
PLAN_FIXTURES: bool = env("PLAN_FIXTURES")
CLIENT_IP_HEADER: str = env("CLIENT_IP_HEADER")
"""Trusted header carrying the client IP (``CF-Connecting-IP`` on Render). Empty: not used."""
GIT_SHA: str = env("GIT_SHA", default=os.environ.get("RENDER_GIT_COMMIT", "dev")[:12])
UPSTREAM_RETRY_DELAYS_S: tuple[float, ...] = (1.0, 3.0)
"""Backoff before each retry of a 429/5xx (jittered ±25%). Tests set this to zeros."""

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_HSTS_SECONDS = 86_400  # 1 day: enough for a review window, easy to undo
    SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
