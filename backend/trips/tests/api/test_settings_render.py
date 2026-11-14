"""Settings pick up Render's injected variables.

Each case runs in a fresh interpreter, because Django loads settings once per process.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[3]
PROBE = (
    "import json, django; django.setup(); from django.conf import settings; "
    "print(json.dumps({'hosts': settings.ALLOWED_HOSTS, 'sha': settings.GIT_SHA}))"
)


def load_settings(**env: str) -> dict[str, object]:
    clean = {k: v for k, v in os.environ.items() if not k.startswith(("RENDER", "GIT_SHA"))}
    out = subprocess.run(
        [sys.executable, "-c", PROBE],
        cwd=BACKEND,
        env={**clean, "DJANGO_SETTINGS_MODULE": "config.settings", "DJANGO_DEBUG": "1", **env},
        capture_output=True,
        text=True,
        check=True,
    )
    result: dict[str, object] = json.loads(out.stdout.strip().splitlines()[-1])
    return result


def test_render_hostname_is_allowed_and_commit_is_the_version() -> None:
    settings = load_settings(
        RENDER_EXTERNAL_HOSTNAME="stormroute-api-x1y2.onrender.com",
        RENDER_GIT_COMMIT="0123456789abcdef0123",
    )

    assert "stormroute-api-x1y2.onrender.com" in settings["hosts"]  # type: ignore[operator]
    assert settings["sha"] == "0123456789ab"


def test_without_render_variables_defaults_apply() -> None:
    settings = load_settings()

    # backend/.env may add local hosts, so only check that nothing Render-specific leaks in.
    assert not any("onrender.com" in h for h in settings["hosts"])  # type: ignore[attr-defined]
    assert settings["sha"] == "dev"
