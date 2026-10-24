<?php

namespace SilenceWatch\Laravel;

use Cron\CronExpression;
use Illuminate\Console\Scheduling\CallbackEvent;
use Illuminate\Console\Scheduling\Event;
use Illuminate\Console\Scheduling\Schedule;
use Throwable;

/**
 * Reads the schedule of the application: every task, with its real cron
 * expression and time zone, under a key that survives restarts and deploys.
 *
 *     artisan:backup:run --only-db     Schedule::command('backup:run --only-db')
 *     exec:/opt/scripts/export.sh      Schedule::exec('/opt/scripts/export.sh')
 *     call:App\Jobs\PruneOrders        Schedule::job(new PruneOrders)
 *     call:prune-orders                Schedule::call(...)->name('prune-orders')
 *
 * What cannot be watched is left out, with the reason in `skipped()`.
 */
final class ScheduleReader
{
    /** The server's limits on a check's key and name. */
    private const KEY_MAX = 300;

    private const NAME_MAX = 120;

    /** @var list<string> */
    private array $skipped = [];

    public function __construct(
        private readonly Schedule $schedule,
        private readonly string $appEnvironment,
        private readonly string $defaultTimezone,
    ) {}

    /**
     * @return list<array{key: string, name: string, cron: string, timezone: string}>
     */
    public function tasks(): array
    {
        $this->skipped = [];
        /** @var array<string, array{0: array{key: string, name: string, cron: string, timezone: string}, 1: int}> $chosen */
        $chosen = [];

        foreach ($this->schedule->events() as $event) {
            if (! $event->runsInEnvironment($this->appEnvironment)) {
                continue;
            }

            $key = self::keyOf($event);
            if ($key === null) {
                $this->skipped[] = 'A closure without a name has no stable identity: give it ->name(\'...\').';

                continue;
            }

            if (self::isFiltered($event)) {
                // between(), when(), skip()…: the expression says when the task may
                // run, not when it does, and watching it would raise false alarms.
                $this->skipped[] = "{$key}: its runs depend on a condition (between, when, skip), not on its schedule alone.";

                continue;
            }

            $cron = $event->getExpression();
            if (! self::isSupported($cron)) {
                $this->skipped[] = "{$key}: SilenceWatch cannot evaluate the cron expression \"{$cron}\".";

                continue;
            }

            $timezone = self::timezoneOf($event) ?? $this->defaultTimezone;
            $gap = self::gap($cron, $timezone);
            $task = ['key' => $key, 'name' => self::nameOf($event), 'cron' => $cron, 'timezone' => $timezone];

            // A task scheduled twice is declared from the schedule that fires most
            // often: that is the deadline a missed run breaches first.
            if (! isset($chosen[$key]) || $gap < $chosen[$key][1]) {
                $chosen[$key] = [$task, $gap];
            }
        }

        return array_values(array_map(fn (array $pair) => $pair[0], $chosen));
    }

    /**
     * Why tasks were left out by the last call to `tasks()`.
     *
     * @return list<string>
     */
    public function skipped(): array
    {
        return $this->skipped;
    }

    /** The stable identity of a task, or null when it has none. */
    public static function keyOf(Event $event): ?string
    {
        if ($event instanceof CallbackEvent) {
            // Schedule::job() names the event after the job's class; a closure has a
            // name only when one was given.
            $name = $event->description;

            return is_string($name) && $name !== '' ? self::bounded('call:'.$name) : null;
        }

        // The PHP binary is the one thing in the command that differs between two
        // servers; Laravel writes it as "php" for its own mutex names.
        $command = trim(Event::normalizeCommand((string) $event->command));

        return str_starts_with($command, 'php artisan ')
            ? self::bounded('artisan:'.substr($command, strlen('php artisan ')))
            : self::bounded('exec:'.$command);
    }

    private static function nameOf(Event $event): string
    {
        if (is_string($event->description) && $event->description !== '') {
            $name = $event->description;
        } else {
            $name = (string) preg_replace('/^(artisan|exec|call):/', '', (string) self::keyOf($event));
        }

        return mb_strlen($name) > self::NAME_MAX ? mb_substr($name, 0, self::NAME_MAX - 1).'…' : $name;
    }

    private static function bounded(string $key): string
    {
        return strlen($key) > self::KEY_MAX ? substr($key, 0, self::KEY_MAX - 41).'#'.sha1($key) : $key;
    }

    private static function isFiltered(Event $event): bool
    {
        [$filters, $rejects] = (fn () => [count($this->filters), count($this->rejects)])->call($event);

        // withoutOverlapping() is itself a skip(), and does not change when a task runs.
        return $filters > 0 || $rejects > ($event->withoutOverlapping ? 1 : 0);
    }

    private static function timezoneOf(Event $event): ?string
    {
        $zone = $event->timezone;
        if ($zone instanceof \DateTimeZone) {
            return $zone->getName();
        }

        return is_string($zone) && $zone !== '' ? $zone : null;
    }

    /** Whether the server can evaluate the expression: nearest-weekday (W) it cannot. */
    public static function isSupported(string $cron): bool
    {
        $fields = preg_split('/\s+/', trim($cron)) ?: [];

        return count($fields) === 5 && preg_match('/\d+W|LW/i', $cron) !== 1;
    }

    /** Seconds between the next two runs, to tell which of two schedules fires more often. */
    private static function gap(string $cron, string $timezone): int
    {
        try {
            $expression = new CronExpression($cron);
            $first = $expression->getNextRunDate('now', 0, false, $timezone);
            $second = $expression->getNextRunDate('now', 1, false, $timezone);

            return $second->getTimestamp() - $first->getTimestamp();
        } catch (Throwable) {
            return PHP_INT_MAX;
        }
    }
}
