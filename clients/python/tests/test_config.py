from datetime import timedelta

import pytest

from silencewatch import Config


def test_defaults_need_an_api_key_before_anything_is_sent():
    config = Config.resolve(environ={})
    assert config.api_key is None
    assert not config.usable
    assert config.base_url == "https://app.silencewatch.com"
    assert config.environment == "production"
    assert config.default_grace == timedelta(minutes=5)
    assert config.timeout == 2.0
    assert config.prune is True


def test_reads_the_environment():
    config = Config.resolve(environ={
        "SILENCEWATCH_API_KEY": "sw_abc",
        "SILENCEWATCH_URL": "https://watch.example.com/",
        "SILENCEWATCH_ENVIRONMENT": "staging",
        "SILENCEWATCH_DEFAULT_GRACE": "90",
        "SILENCEWATCH_REPORT_START": "false",
        "SILENCEWATCH_QUEUE_CAPACITY": "50",
        "SILENCEWATCH_PRUNE": "no",
    })
    assert config.usable
    assert config.normalised_base_url == "https://watch.example.com"
    assert config.environment == "staging"
    assert config.default_grace == timedelta(seconds=90)
    assert config.report_start is False
    assert config.queue_capacity == 50
    assert config.prune is False


def test_base_url_has_two_names():
    assert Config.resolve(environ={"SILENCEWATCH_BASE_URL": "https://a.example"}).base_url == "https://a.example"
    assert Config.resolve(environ={"SILENCEWATCH_URL": "https://b.example"}).base_url == "https://b.example"


def test_keywords_win_over_the_environment():
    config = Config.resolve(environ={"SILENCEWATCH_ENVIRONMENT": "staging"}, environment="prod", default_grace=60)
    assert config.environment == "prod"
    assert config.default_grace == timedelta(seconds=60)


def test_a_typo_in_the_environment_does_not_take_the_application_down():
    config = Config.resolve(environ={"SILENCEWATCH_TIMEOUT": "fast", "SILENCEWATCH_ENABLED": "maybe"})
    assert config.timeout == 2.0
    assert config.enabled is True


def test_an_unknown_keyword_is_a_programming_error_and_says_so():
    with pytest.raises(TypeError, match="colour"):
        Config.resolve(environ={}, colour="red")


def test_disabled_is_not_usable_even_with_a_key():
    assert not Config.resolve(environ={}, api_key="k", enabled=False).usable


def test_per_instance_settings_come_from_the_environment():
    config = Config.resolve(environ={
        "SILENCEWATCH_PER_INSTANCE_JOBS": "apscheduler:evict, apscheduler:tmp-*",
        "SILENCEWATCH_INSTANCE_ID": "web-1",
    })
    assert config.per_instance_jobs == ("apscheduler:evict", "apscheduler:tmp-*")
    assert config.is_per_instance("apscheduler:evict")
    assert config.is_per_instance("apscheduler:tmp-sweep")
    assert not config.is_per_instance("apscheduler:evict-all")
    assert config.instance_environment == "production.web-1"


def test_the_instance_environment_is_one_the_server_accepts():
    assert Config.resolve(environ={}).instance_environment is None
    assert Config.resolve(environ={}, instance_id="web@host:80").instance_environment == "production.web-host-80"
    long_name = Config.resolve(environ={}, instance_id="billing-reconciliation-worker-statefulset-12")
    assert len(long_name.instance_environment) == 40
    assert long_name.instance_environment.endswith("statefulset-12")
    assert Config.resolve(environ={}, environment="e" * 39, instance_id="x").instance_environment is None
