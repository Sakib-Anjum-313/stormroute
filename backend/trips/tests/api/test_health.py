import json
import zlib

import pytest
from django.test import Client

from trips.api.views import StreamProbeView


def test_healthz_returns_ok_and_version(client: Client) -> None:
    response = client.get("/api/healthz")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["version"], str)


def test_stream_probe_emits_ndjson_lines_in_order(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(StreamProbeView, "INTERVAL_S", 0)

    response = client.get("/api/healthz/stream")

    assert response.status_code == 200
    assert response["Content-Type"] == "application/x-ndjson"
    assert response["X-Accel-Buffering"] == "no"
    lines = b"".join(response.streaming_content).decode().splitlines()  # type: ignore[attr-defined]
    events = [json.loads(line) for line in lines]
    assert [e["i"] for e in events] == [0, 1, 2, 3, 4]
    assert all(e["type"] == "tick" for e in events)


def test_stream_probe_gzip_is_flushed_per_line(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every chunk must decompress to whole lines on its own (no buffering inside zlib)."""
    monkeypatch.setattr(StreamProbeView, "INTERVAL_S", 0)

    response = client.get("/api/healthz/stream", HTTP_ACCEPT_ENCODING="gzip")

    assert response["Content-Encoding"] == "gzip"
    decoder = zlib.decompressobj(wbits=31)
    chunks = list(response.streaming_content)  # type: ignore[attr-defined]
    per_chunk = [decoder.decompress(chunk).decode() for chunk in chunks]
    data_chunks = per_chunk[:-1]  # the last chunk is the gzip trailer
    assert len(data_chunks) == 5
    assert all(text.endswith("\n") and text.count("\n") == 1 for text in data_chunks)
    assert [json.loads(text)["i"] for text in data_chunks] == [0, 1, 2, 3, 4]
