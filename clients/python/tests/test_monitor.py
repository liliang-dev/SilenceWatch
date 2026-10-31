import logging
from datetime import timedelta

from silencewatch import Config, DiscoveredJob, Monitor
from silencewatch.integrations.base import Integration


class Fake(Integration):
    def __init__(self, name, jobs):
        self.name = name
        self.jobs = jobs
        self.installed = 0

    def discover(self):
        return self.jobs

    def install(self, monitor):
        self.installed += 1
        monitor.declare(self, self.discover())


def job(key, **overrides):
    values = {"key": key, "name": key, "interval": timedelta(minutes=5)}
    values.update(overrides)
    return DiscoveredJob(**values)


def test_every_integration_is_declared_in_one_request(monitor, server):
    monitor.attach(Fake("celery", [job("celery:a")]))
    monitor.attach(Fake("apscheduler", [job("apscheduler:b")]))
    # the second declaration carries both: one declaration is complete, or it orphans the other's jobs
    assert [c["key"] for c in server.syncs[-1]["checks"]] == ["celery:a", "apscheduler:b"]
    assert server.syncs[-1]["source"] == "python-apscheduler+celery"


def test_a_run_is_reported_with_the_key_the_server_gave(monitor, server):
    monitor.attach(Fake("celery", [job("celery:a")]))
    monitor.started("celery:a")
    monitor.succeeded("celery:a", 40)
    assert server.wait_pings(2) == [("pk-celery:a", "/start"), ("pk-celery:a", "/0")]


def test_a_cron_the_server_cannot_read_is_left_out_and_does_not_cost_the_others(monitor, server, caplog):
    bad = job("celery:bad", interval=None, cron="0 0 15W * *")
    with caplog.at_level(logging.WARNING, logger="silencewatch"):
        monitor.attach(Fake("celery", [bad, job("celery:good")]))
    assert [c["key"] for c in server.syncs[-1]["checks"]] == ["celery:good"]
    assert "cannot evaluate" in caplog.text


def test_the_same_key_from_two_integrations_is_kept_once(monitor, server, caplog):
    with caplog.at_level(logging.WARNING, logger="silencewatch"):
        monitor.attach(Fake("celery", [job("shared")]))
        monitor.attach(Fake("apscheduler", [job("shared")]))
    assert [c["key"] for c in server.syncs[-1]["checks"]] == ["shared"]
    assert "keeping the first" in caplog.text


def test_nothing_happens_without_an_api_key(server):
    monitor = Monitor(Config.resolve(environ={}, base_url=server.url))
    integration = Fake("celery", [job("celery:a")])
    monitor.attach(integration)
    monitor.succeeded("celery:a", 1)
    assert integration.installed == 1
    assert server.syncs == []
    assert server.pings == []


def test_disabled_removes_the_mechanism_entirely(server):
    monitor = Monitor(Config.resolve(environ={}, api_key="k", base_url=server.url, enabled=False))
    integration = Fake("celery", [job("celery:a")])
    monitor.attach(integration)
    assert integration.installed == 0  # not even hooked
    assert server.syncs == []


def test_auto_register_off_sends_nothing(server):
    monitor = Monitor(Config.resolve(environ={}, api_key="k", base_url=server.url, auto_register=False))
    monitor.attach(Fake("celery", [job("celery:a")]))
    monitor.succeeded("celery:a", 1)
    assert server.syncs == []
    assert server.pings == []


def test_an_integration_that_fails_to_install_does_not_fail_the_application(monitor, caplog):
    class Broken(Fake):
        def install(self, monitor):
            raise RuntimeError("boom")

    with caplog.at_level(logging.WARNING, logger="silencewatch"):
        monitor.attach(Broken("celery", []))
    assert "could not instrument celery" in caplog.text


def test_a_failed_declaration_is_tried_again_at_the_next_heartbeat_but_not_every_time(server, monkeypatch):
    import silencewatch.monitor as module

    clock = [1000.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])
    server.sync_status = 500
    monitor = Monitor(Config.resolve(environ={}, api_key="k", base_url=server.url, timeout=3.0))
    monitor.attach(Fake("celery", [job("celery:a")]))
    assert len(server.syncs) == 1

    monitor.succeeded("celery:a", 1)  # too soon: no new attempt
    assert len(server.syncs) == 1

    server.sync_status = 200
    clock[0] += 61
    monitor.succeeded("celery:a", 1)  # a minute later the declaration goes through, then the heartbeat
    assert len(server.syncs) == 2
    assert server.wait_pings(1) == [("pk-celery:a", "/0")]


def test_replicas_share_one_check_by_default(monitor, server):
    monitor.attach(Fake("apscheduler", [job("apscheduler:evict"), job("apscheduler:report")]))
    assert len(server.syncs) == 1
    assert server.syncs[0]["environment"] == "test"


def test_per_instance_jobs_are_declared_in_the_instance_environment(server):
    config = Config.resolve(environ={}, api_key="k", base_url=server.url, environment="production",
                            per_instance_jobs=["apscheduler:evict"], instance_id="web-1", timeout=3.0)
    monitor = Monitor(config)
    monitor.attach(Fake("apscheduler", [job("apscheduler:evict"), job("apscheduler:report")]))

    by_environment = {sync["environment"]: [c["key"] for c in sync["checks"]] for sync in server.syncs}
    assert by_environment == {"production": ["apscheduler:report"], "production.web-1": ["apscheduler:evict"]}

    monitor.succeeded("apscheduler:evict", 5)
    assert server.wait_pings(1) == [("pk-apscheduler:evict", "/0")]


def test_per_instance_jobs_stay_shared_without_an_instance_id(server, caplog):
    config = Config.resolve(environ={}, api_key="k", base_url=server.url, environment="production",
                            per_instance_jobs=["apscheduler:*"], timeout=3.0)
    with caplog.at_level(logging.WARNING, logger="silencewatch"):
        Monitor(config).attach(Fake("apscheduler", [job("apscheduler:evict")]))
    assert [sync["environment"] for sync in server.syncs] == ["production"]
    assert "instance_id is missing" in caplog.text


def test_a_celery_task_is_never_watched_per_instance(server, caplog):
    # One worker runs each run: on every other worker the check would go down.
    config = Config.resolve(environ={}, api_key="k", base_url=server.url, environment="production",
                            per_instance_jobs=["*"], instance_id="worker-1", timeout=3.0)
    with caplog.at_level(logging.WARNING, logger="silencewatch"):
        Monitor(config).attach(Fake("celery", [job("celery:shop.tasks.nightly")]))
    assert [sync["environment"] for sync in server.syncs] == ["production"]
    assert "cannot be watched per instance" in caplog.text
