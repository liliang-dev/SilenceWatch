<?php

namespace SilenceWatch\Laravel;

use Illuminate\Console\Events\ScheduledBackgroundTaskFinished;
use Illuminate\Console\Events\ScheduledTaskFailed;
use Illuminate\Console\Events\ScheduledTaskFinished;
use Illuminate\Console\Events\ScheduledTaskStarting;
use Illuminate\Console\Scheduling\Event;
use Illuminate\Contracts\Cache\Repository as Cache;
use Psr\Log\LoggerInterface;
use Throwable;
use WeakMap;

/**
 * Declares the schedule and reports each run of it.
 *
 * `schedule:run` is a new process every minute, so the ping keys are kept in the
 * cache, under a hash of the declaration: the declaration is sent again only
 * when the schedule changed (a deploy), or once a day.
 */
final class Monitor
{
    private const CACHE_KEY = 'silencewatch:declaration';

    private const CACHE_SECONDS = 86400;

    /** The longest environment name the server accepts. */
    private const MAX_ENVIRONMENT_LENGTH = 40;

    /** @var array<string, string>|null task key => ping key, once known in this process */
    private ?array $pingKeys = null;

    /** @var WeakMap<Event, true> runs whose outcome is already reported */
    private WeakMap $reported;

    /**
     * @param  array{environment: string, prune: bool, default_grace: int, report_start: bool, per_instance_tasks?: list<string>, instance_id?: ?string}  $settings
     */
    public function __construct(
        private readonly Client $client,
        private readonly ScheduleReader $reader,
        private readonly Cache $cache,
        private readonly LoggerInterface $log,
        private readonly array $settings,
    ) {
        $this->reported = new WeakMap;
    }

    /**
     * Declares the schedule if it changed since the last declaration, or always
     * when forced. Returns the number of tasks watched, null on failure.
     */
    public function declare(bool $force = false): ?int
    {
        try {
            $tasks = $this->reader->tasks();
            if ($tasks === []) {
                $this->pingKeys = [];

                return 0;
            }

            [$shared, $perInstance, $notes] = $this->split($tasks);
            $instanceEnvironment = $this->instanceEnvironment();
            // Two declarations, each in its own environment: the shared one never
            // orphans another server's checks, nor this server's the shared ones.
            $payloads = [];
            if ($shared !== []) {
                $payloads[] = $this->payload($shared, $this->settings['environment']);
            }
            if ($perInstance !== []) {
                $payloads[] = $this->payload($perInstance, (string) $instanceEnvironment);
            }
            $hash = sha1((string) json_encode($payloads));
            // Per server when there is an instance: in a cache the servers share,
            // each one's declaration would otherwise look like a change to the other.
            $cacheKey = self::CACHE_KEY.($instanceEnvironment === null ? '' : ':'.$instanceEnvironment);
            $cached = $force ? null : $this->cache->get($cacheKey);
            if (is_array($cached) && ($cached['hash'] ?? null) === $hash && is_array($cached['keys'] ?? null)) {
                $this->pingKeys = $cached['keys'];

                return count($this->pingKeys);
            }

            // Only when something is sent: the scheduler runs every minute, and the
            // same warnings every minute would bury everything else in the log.
            foreach ($this->reader->skipped() as $reason) {
                $this->log->warning('SilenceWatch is not watching a scheduled task. '.$reason);
            }
            foreach ($notes as $note) {
                $this->log->warning($note);
            }

            $keys = [];
            foreach ($payloads as $payload) {
                $found = $this->client->sync($payload, $error);
                if ($found === null) {
                    $this->log->warning('SilenceWatch could not declare the schedule: '.$error);
                    $this->pingKeys = [];

                    return null;
                }
                $keys += $found;
            }

            $this->cache->put($cacheKey, ['hash' => $hash, 'keys' => $keys], self::CACHE_SECONDS);
            $this->pingKeys = $keys;

            return count($keys);
        } catch (Throwable $e) {
            $this->log->warning('SilenceWatch could not read the schedule: '.$e->getMessage());
            $this->pingKeys = [];

            return null;
        }
    }

    /** @return list<string> */
    public function skipped(): array
    {
        return $this->reader->skipped();
    }

    // The listeners below never throw: an exception in a listener of
    // ScheduledTaskFinished would make Laravel report a successful task as failed.

    public function starting(ScheduledTaskStarting $event): void
    {
        $this->safely(function () use ($event) {
            unset($this->reported[$event->task]);
            if ($this->settings['report_start']) {
                $this->ping($event->task, 'start');
            }
        });
    }

    public function finished(ScheduledTaskFinished $event): void
    {
        $this->safely(function () use ($event) {
            $task = $event->task;
            // In the background, the run has only begun: its end is reported by the
            // process that ran it (below). The overlap flag is newer than Laravel 12.0.
            if ($task->runInBackground || ! empty($task->skippedBecauseOverlapping)) {
                return;
            }
            $this->reported[$task] = true;
            $this->ping($task, (int) $task->exitCode, (int) round($event->runtime * 1000));
        });
    }

    public function failed(ScheduledTaskFailed $event): void
    {
        $this->safely(function () use ($event) {
            // A command that exits non-zero is reported as finished first, with its
            // exit code; the failure Laravel raises after it is the same run.
            if (isset($this->reported[$event->task])) {
                unset($this->reported[$event->task]);

                return;
            }
            // The runtime is newer than Laravel 12.0.
            $runtime = $event->runtime ?? null;
            $this->ping($event->task, 'fail', $runtime === null ? null : (int) round($runtime * 1000));
        });
    }

    public function backgroundFinished(ScheduledBackgroundTaskFinished $event): void
    {
        $this->safely(fn () => $this->ping($event->task, (int) $event->task->exitCode));
    }

    private function ping(Event $task, string|int $outcome, ?int $durationMs = null): void
    {
        if ($this->pingKeys === null) {
            $this->declare();
        }
        $key = ScheduleReader::keyOf($task);
        $pingKey = $key === null ? null : ($this->pingKeys[$key] ?? null);
        if ($pingKey !== null) {
            $this->client->ping($pingKey, $outcome, $durationMs);
        }
    }

    private function safely(\Closure $report): void
    {
        try {
            $report();
        } catch (Throwable) {
            // Never fail the scheduler because of monitoring.
        }
    }

    /**
     * The tasks watched for all the servers, the ones watched on this server
     * alone (per_instance_tasks), and what to warn about.
     *
     * @param  list<array{key: string, name: string, cron: string, timezone: string}>  $tasks
     * @return array{0: list<array{key: string, name: string, cron: string, timezone: string}>, 1: list<array{key: string, name: string, cron: string, timezone: string}>, 2: list<string>}
     */
    private function split(array $tasks): array
    {
        $shared = [];
        $perInstance = [];
        $notes = [];
        foreach ($tasks as $task) {
            if (! $this->isPerInstance($task['key'])) {
                $shared[] = $task;
            } elseif ($this->reader->runsOnOneServer($task['key'])) {
                // One server runs each run: on every other one its check would go down.
                $notes[] = "SilenceWatch watches {$task['key']} for all servers: it runs onOneServer(), so it cannot be watched per server.";
                $shared[] = $task;
            } else {
                $perInstance[] = $task;
            }
        }

        if ($perInstance !== [] && $this->instanceEnvironment() === null) {
            // Better one check for all the servers than none at all.
            $notes[] = 'SilenceWatch per_instance_tasks is set but instance_id is missing, or leaves no room in the environment name; '
                .count($perInstance).' task(s) are watched as one check for all servers.';

            return [[...$shared, ...$perInstance], [], $notes];
        }

        return [$shared, $perInstance, $notes];
    }

    private function isPerInstance(string $key): bool
    {
        foreach ($this->settings['per_instance_tasks'] ?? [] as $pattern) {
            $pattern = trim($pattern);
            if (str_ends_with($pattern, '*') ? str_starts_with($key, substr($pattern, 0, -1)) : ($pattern !== '' && $key === $pattern)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Where the per-server tasks are declared: `production.web-1`. The server
     * accepts 40 letters, digits, dots, dashes and underscores: anything else
     * becomes a dash, and a name too long is cut from the front, where servers
     * tend to look alike. Null when there is no usable name.
     */
    private function instanceEnvironment(): ?string
    {
        $id = trim((string) ($this->settings['instance_id'] ?? ''));
        if ($id === '') {
            return null;
        }
        $environment = $this->settings['environment'];
        $room = self::MAX_ENVIRONMENT_LENGTH - strlen($environment) - 1;
        if ($room <= 0) {
            return null;
        }
        $name = (string) preg_replace('/[^A-Za-z0-9._-]/', '-', $id);

        return $environment.'.'.substr($name, -$room);
    }

    /**
     * @param  list<array{key: string, name: string, cron: string, timezone: string}>  $tasks
     * @return array<string, mixed>
     */
    private function payload(array $tasks, string $environment): array
    {
        return [
            'environment' => $environment,
            'source' => 'laravel',
            'prune' => $this->settings['prune'],
            'checks' => array_map(fn (array $task) => $task + [
                'grace_seconds' => max(0, $this->settings['default_grace']),
            ], $tasks),
        ];
    }
}
