"""A stand-in SilenceWatch, so the tests exercise the real HTTP code."""

from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, List, Tuple

import pytest

from silencewatch import Config, Monitor


class FakeServer:
    def __init__(self) -> None:
        self.syncs: List[Dict[str, Any]] = []
        self.sync_headers: List[Dict[str, str]] = []
        self.pings: List[Tuple[str, str]] = []  # (ping key, "/start" | "/0" | "/fail"), query dropped
        self.queries: List[str] = []
        self.sync_status = 200
        self.delay = 0.0
        self._lock = threading.Lock()
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:  # keep the test output quiet
                pass

            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("content-length") or 0)
                body = self.rfile.read(length)
                if server.delay:
                    time.sleep(server.delay)
                path, _, query = self.path.partition("?")
                if path == "/api/v1/checks/sync":
                    payload = json.loads(body)
                    with server._lock:
                        server.syncs.append(payload)
                        server.sync_headers.append({k.lower(): v for k, v in self.headers.items()})
                    if server.sync_status != 200:
                        self.send_response(server.sync_status)
                        self.end_headers()
                        self.wfile.write(b"nope")
                        return
                    checks = [{"key": c["key"], "pingKey": "pk-" + c["key"], "id": "x", "created": True}
                              for c in payload["checks"]]
                    out = json.dumps({"checks": checks, "orphaned": []}).encode()
                    self.send_response(200)
                    self.send_header("content-type", "application/json")
                    self.end_headers()
                    self.wfile.write(out)
                elif path.startswith("/p/"):
                    _, _, key_and_suffix = path.partition("/p/")
                    key, _, suffix = key_and_suffix.partition("/")
                    with server._lock:
                        server.pings.append((key, "/" + suffix))
                        server.queries.append(query)
                    self.send_response(200)
                    self.end_headers()
                else:
                    self.send_response(404)
                    self.end_headers()

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()

    def wait_for(self, condition: Callable[[], bool], timeout: float = 5.0) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if condition():
                return True
            time.sleep(0.02)
        return condition()

    def wait_pings(self, count: int, timeout: float = 5.0) -> List[Tuple[str, str]]:
        self.wait_for(lambda: len(self.pings) >= count, timeout)
        return list(self.pings)


@pytest.fixture
def server() -> Any:
    fake = FakeServer()
    yield fake
    fake.close()


@pytest.fixture
def config(server: FakeServer) -> Config:
    return Config.resolve(environ={}, api_key="sw_test_key", base_url=server.url, environment="test", timeout=3.0)


@pytest.fixture
def monitor(config: Config) -> Monitor:
    return Monitor(config)
