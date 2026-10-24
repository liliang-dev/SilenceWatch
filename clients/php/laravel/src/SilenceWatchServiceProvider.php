<?php

namespace SilenceWatch\Laravel;

use Illuminate\Console\Events\ScheduledBackgroundTaskFinished;
use Illuminate\Console\Events\ScheduledTaskFailed;
use Illuminate\Console\Events\ScheduledTaskFinished;
use Illuminate\Console\Events\ScheduledTaskStarting;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Http\Client\Factory as Http;
use Illuminate\Support\ServiceProvider;

/**
 * Registered by package discovery: installing the package and setting
 * SILENCEWATCH_API_KEY is the whole setup.
 */
final class SilenceWatchServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/silencewatch.php', 'silencewatch');

        $this->app->singleton(Monitor::class, function (Application $app) {
            $config = (array) $app['config']->get('silencewatch');

            return new Monitor(
                new Client($app->make(Http::class), (string) $config['url'], (string) $config['api_key'], (float) $config['timeout']),
                new ScheduleReader(
                    $app->make(Schedule::class),
                    (string) $app->environment(),
                    (string) ($app['config']->get('app.schedule_timezone') ?? $app['config']->get('app.timezone') ?? 'UTC'),
                ),
                $app['cache']->store($config['cache_store'] ?? null),
                $app['log'],
                [
                    'environment' => (string) $config['environment'],
                    'prune' => (bool) $config['prune'],
                    'default_grace' => (int) $config['default_grace'],
                    'report_start' => (bool) $config['report_start'],
                ],
            );
        });
    }

    public function boot(): void
    {
        if (! $this->app->runningInConsole()) {
            return;
        }

        $this->publishes([__DIR__.'/../config/silencewatch.php' => config_path('silencewatch.php')], 'silencewatch-config');
        $this->commands([Console\SyncCommand::class]);

        // Disabled or without a key, nothing listens: no declaration, no request.
        if (! config('silencewatch.enabled') || ! config('silencewatch.api_key')) {
            return;
        }

        $events = $this->app->make(Dispatcher::class);
        $events->listen(ScheduledTaskStarting::class, fn ($e) => $this->app->make(Monitor::class)->starting($e));
        $events->listen(ScheduledTaskFinished::class, fn ($e) => $this->app->make(Monitor::class)->finished($e));
        $events->listen(ScheduledTaskFailed::class, fn ($e) => $this->app->make(Monitor::class)->failed($e));
        $events->listen(ScheduledBackgroundTaskFinished::class, fn ($e) => $this->app->make(Monitor::class)->backgroundFinished($e));
    }
}
