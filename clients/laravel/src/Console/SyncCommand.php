<?php

namespace SilenceWatch\Laravel\Console;

use Illuminate\Console\Command;
use SilenceWatch\Laravel\Monitor;

/**
 * Declares the schedule now. The scheduler does it on its own when the schedule
 * changes; this is for a deploy script, or to see what is watched.
 */
final class SyncCommand extends Command
{
    protected $signature = 'silencewatch:sync';

    protected $description = 'Declare the scheduled tasks to SilenceWatch';

    public function handle(Monitor $monitor): int
    {
        if (! config('silencewatch.enabled') || ! config('silencewatch.api_key')) {
            $this->components->warn('SilenceWatch is disabled or SILENCEWATCH_API_KEY is not set: nothing to do.');

            return self::SUCCESS;
        }

        $count = $monitor->declare(force: true);
        foreach ($monitor->skipped() as $reason) {
            $this->components->warn($reason);
        }

        if ($count === null) {
            $this->components->error('The declaration did not go through; see the log.');

            return self::FAILURE;
        }

        $this->components->info("SilenceWatch is watching {$count} scheduled task(s).");

        return self::SUCCESS;
    }
}
