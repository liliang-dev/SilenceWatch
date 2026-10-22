import logging
from datetime import timedelta

from silencewatch import Config, DiscoveredJob
from silencewatch.client import SilenceWatchClient


def cron_job(key="celery:app.backup", **overrides):
    values = {"key": key, "name": "backup", "cron": "0 2 * * *", "timezone": "Europe/Paris"}
    values.update(overrides)
    return DiscoveredJob(**values)


def test_declares_jobs_and_returns_their_ping_keys(config, server):
    client = SilenceWatchClient(config)
    keys = client.sync(
        [cron_job(), DiscoveredJob(key="celery:app.poll", name="poll", interval=timedelta(minutes=15))],
        source="python-celery",
    )
    assert keys == {"celery:app.backup": "pk-celery:app.backup", "celery:app.poll": "pk-celery:app.poll"}

    payload = server.syncs[0]
    assert payload["environment"] == "test"
    assert payload["source"] == "python-celery"
    assert payload["prune"] is True
    assert payload["checks"][0] == {
        "key": "celery:app.backup", "name": "backup", "cron": "0 2 * * *",
        "timezone": "Europe/Paris", "grace_seconds": 300,
    }
    assert payload["checks"][1] == {
        "key": "celery:app.poll", "name": "poll", "interval_seconds": 900, "grace_seconds": 300,
    }


def test_authenticates_and_says_who_is_calling(config, server):
    SilenceWatchClient(config).sync([cron_job()])
    headers = server.sync_headers[0]
    assert headers["authorization"] == "Bearer sw_test_key"
    assert headers["user-agent"].startswith("silencewatch-python/")


def test_a_cron_job_without_a_zone_gets_the_configured_one(server):
    config = Config.resolve(environ={}, api_key="k", base_url=server.url, timezone="Asia/Tokyo")
    SilenceWatchClient(config).sync([cron_job(timezone=None)])
    assert server.syncs[0]["checks"][0]["timezone"] == "Asia/Tokyo"


def test_a_job_own_grace_wins_over_the_default(config, server):
    SilenceWatchClient(config).sync([cron_job(grace=timedelta(minutes=30))])
    assert server.syncs[0]["checks"][0]["grace_seconds"] == 1800


def test_a_sub_minimum_interval_is_declared_at_the_minimum_and_said_so(config, server, caplog):
    job = DiscoveredJob(key="aps:fast", name="fast", interval=timedelta(seconds=5))
    with caplog.at_level(logging.WARNING, logger="silencewatch"):
        SilenceWatchClient(config).sync([job])
    assert server.syncs[0]["checks"][0]["interval_seconds"] == 30
    assert "below the 30s minimum" in caplog.text


def test_prune_follows_the_configuration(server):
    config = Config.resolve(environ={}, api_key="k", base_url=server.url, prune=False)
    SilenceWatchClient(config).sync([cron_job()])
    assert server.syncs[0]["prune"] is False


def test_nothing_is_sent_for_no_jobs(config, server):
    assert SilenceWatchClient(config).sync([]) == {}
    assert server.syncs == []


def test_a_refusal_is_an_empty_answer_and_a_warning_not_an_exception(config, server, caplog):
    server.sync_status = 422
    with caplog.at_level(logging.WARNING, logger="silencewatch"):
        assert SilenceWatchClient(config).sync([cron_job()]) == {}
    assert "HTTP 422" in caplog.text


def test_an_unreachable_server_is_an_empty_answer(caplog):
    config = Config.resolve(environ={}, api_key="k", base_url="http://127.0.0.1:1", timeout=0.5)
    with caplog.at_level(logging.WARNING, logger="silencewatch"):
        assert SilenceWatchClient(config).sync([cron_job()]) == {}
    assert "Could not declare jobs" in caplog.text


def test_pings_carry_the_duration(config, server):
    client = SilenceWatchClient(config)
    assert client.ping("pk-1", "/start") is True
    assert client.ping("pk-1", "/0", 1234) is True
    assert client.ping("pk-1", "/fail", 7) is True
    assert server.pings == [("pk-1", "/start"), ("pk-1", "/0"), ("pk-1", "/fail")]
    assert server.queries == ["", "duration_ms=1234", "duration_ms=7"]


def test_a_ping_that_cannot_be_delivered_is_false_not_an_exception():
    config = Config.resolve(environ={}, api_key="k", base_url="http://127.0.0.1:1", timeout=0.5)
    assert SilenceWatchClient(config).ping("pk", "/0") is False
