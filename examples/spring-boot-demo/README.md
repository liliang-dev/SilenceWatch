# SilenceWatch Spring Boot demo

A plain Spring Boot application with two scheduled jobs and no monitoring code.
Adding the starter and an API key is the entire integration.

```bash
# 1. install the starter from this repository
cd ../../clients/spring-boot-starter && mvn install -DskipTests

# 2. create an API key in your project's Settings page, then
cd ../../examples/spring-boot-demo
SILENCEWATCH_API_KEY=sw_… SILENCEWATCH_BASE_URL=http://localhost:8080 mvn spring-boot:run
```

Within a second of startup the jobs appear in SilenceWatch, tagged `auto`, with
their real schedules:

| Key | Schedule |
| --- | --- |
| `com.acme.demo.BackupJob#run` | the cron expression resolved from `demo.backup.cron` |
| `com.acme.demo.BackupJob#export` | the interval resolved from `demo.export.rate` |

Each run then sends a heartbeat, with its duration, and `export` reports a failure
every third run so the down-and-recovered path is visible too.

Stop the application and watch the checks go `LATE`, then `DOWN` — which is the
whole point.
