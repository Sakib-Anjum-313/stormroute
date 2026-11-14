"""Django settings for the Spotter API.

All configuration comes from environment variables (see backend/.env.example).
The app is stateless: there are no models and no database is required.
"""

from pathlib import Path

import environ

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
    GIT_SHA=(str, "dev"),
    TOMTOM_BASE_URL=(str, "https://api.tomtom.com"),
)
environ.Env.read_env(BASE_DIR / ".env", overwrite=False)

DEBUG: bool = env("DJANGO_DEBUG")
SECRET_KEY: str = env("DJANGO_SECRET_KEY", default="dev-insecure-change-me" if DEBUG else None)
ALLOWED_HOSTS: list[str] = env("ALLOWED_HOSTS")

INSTALLED_APPS = [
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "drf_spectacular",
    "trips",
]

MIDDLEWARE = [
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
CORS_EXPOSE_HEADERS = ["Server-Timing", "X-Request-ID"]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_RATES": {"plan": "10/min", "geocode": "60/min"},
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Spotter Weather-Aware Truck Routing API",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
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
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
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
GIT_SHA: str = env("GIT_SHA")
UPSTREAM_RETRY_DELAYS_S: tuple[float, ...] = (1.0, 3.0)
"""Backoff before each retry of a 429/5xx (jittered ±25%). Tests set this to zeros."""

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_CONTENT_TYPE_NOSNIFF = True
