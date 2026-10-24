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

    /** @var array<string, string>|null task key => ping key, once known in this process */
    private ?array $pingKeys = null;

    /** @var WeakMap<Event, true> runs whose outcome is already reported */
    private WeakMap $reported;

    /**
     * @param  array{environment: string, prune: bool, default_grace: int, report_start: bool}  $settings
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

            $payload = $this->payload($tasks);
            $hash = sha1((string) json_encode($payload));
            $cached = $force ? null : $this->cache->get(self::CACHE_KEY);
            if (is_array($cached) && ($cached['hash'] ?? null) === $hash && is_array($cached['keys'] ?? null)) {
                $this->pingKeys = $cached['keys'];

                return count($this->pingKeys);
            }

            // Only when something is sent: the scheduler runs every minute, and the
            // same warnings every minute would bury everything else in the log.
            foreach ($this->reader->skipped() as $reason) {
                $this->log->warning('SilenceWatch is not watching a scheduled task. '.$reason);
            }

            $keys = $this->client->sync($payload, $error);
            if ($keys === null) {
                $this->log->warning('SilenceWatch could not declare the schedule: '.$error);
                $this->pingKeys = [];

                return null;
            }

            $this->cache->put(self::CACHE_KEY, ['hash' => $hash, 'keys' => $keys], self::CACHE_SECONDS);
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
     * @param  list<array{key: string, name: string, cron: string, timezone: string}>  $tasks
     * @return array<string, mixed>
     */
    private function payload(array $tasks): array
    {
        return [
            'environment' => $this->settings['environment'],
            'source' => 'laravel',
            'prune' => $this->settings['prune'],
            'checks' => array_map(fn (array $task) => $task + [
                'grace_seconds' => max(0, $this->settings['default_grace']),
            ], $tasks),
        ];
    }
}
