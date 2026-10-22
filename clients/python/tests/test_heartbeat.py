import multiprocessing
import sys
import time

import pytest

from silencewatch import Config
from silencewatch.client import SilenceWatchClient
from silencewatch.heartbeat import HeartbeatSender


def make(server, **settings):
    config = Config.resolve(environ={}, api_key="k", base_url=server.url, timeout=3.0, **settings)
    sender = HeartbeatSender(config, SilenceWatchClient(config))
    sender.register({"job": "pk-job"})
    return sender


def test_sends_the_beginning_and_the_end_of_a_run_in_order(server):
    sender = make(server)
    sender.started("job")
    sender.succeeded("job", 250)
    assert server.wait_pings(2) == [("pk-job", "/start"), ("pk-job", "/0")]
    assert server.queries[1] == "duration_ms=250"


def test_reports_a_failure(server):
    sender = make(server)
    sender.failed("job", 9)
    assert server.wait_pings(1) == [("pk-job", "/fail")]


def test_sends_only_the_outcome_when_asked_to(server):
    sender = make(server, report_start=False)
    sender.started("job")
    sender.succeeded("job", 1)
    assert server.wait_pings(1) == [("pk-job", "/0")]
    time.sleep(0.2)
    assert len(server.pings) == 1


def test_a_job_that_was_never_declared_has_nowhere_to_send(server):
    sender = make(server)
    sender.succeeded("stranger", 1)
    sender.flush(0.3)
    assert server.pings == []


def test_sending_does_not_wait_for_a_slow_server(server):
    server.delay = 0.5
    sender = make(server)
    began = time.monotonic()
    for _ in range(20):
        sender.succeeded("job", 1)
    assert time.monotonic() - began < 0.2  # twenty submissions, none of them waiting on the network


def test_the_queue_is_bounded_and_the_oldest_are_dropped(server):
    server.delay = 0.3
    sender = make(server, queue_capacity=3)
    for duration in range(1, 11):
        sender.succeeded("job", duration)
    assert sender.dropped_count >= 5
    server.wait_for(lambda: "duration_ms=10" in server.queries, timeout=8)
    # what was kept is the freshest: the last one made it, and the early ones did not all
    assert "duration_ms=10" in server.queries
    assert len(server.queries) < 10


def test_an_unreachable_server_is_counted_not_raised():
    config = Config.resolve(environ={}, api_key="k", base_url="http://127.0.0.1:1", timeout=0.3)
    sender = HeartbeatSender(config, SilenceWatchClient(config))
    sender.register({"job": "pk-job"})
    sender.succeeded("job", 1)
    deadline = time.monotonic() + 3
    while sender.failure_count == 0 and time.monotonic() < deadline:
        time.sleep(0.02)
    assert sender.failure_count == 1


@pytest.mark.skipif(sys.platform == "win32", reason="needs fork")
@pytest.mark.filterwarnings("ignore:This process .* is multi-threaded:DeprecationWarning")  # the very case tested
def test_a_forked_child_sends_its_own_heartbeats(server):
    sender = make(server)
    sender.succeeded("job", 1)  # starts the parent's thread
    server.wait_pings(1)
    context = multiprocessing.get_context("fork")

    def child() -> None:
        sender.succeeded("job", 2)
        sender.flush(3)

    process = context.Process(target=child)
    process.start()
    process.join(10)
    assert process.exitcode == 0
    server.wait_for(lambda: "duration_ms=2" in server.queries, timeout=5)
    assert "duration_ms=2" in server.queries
