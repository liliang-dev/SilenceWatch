"""One module per scheduler, each importable only when its scheduler is installed.

* :mod:`silencewatch.integrations.celery`: Celery beat
* :mod:`silencewatch.integrations.apscheduler`: APScheduler 3

The contract they share is :class:`silencewatch.integrations.base.Integration`.
"""
