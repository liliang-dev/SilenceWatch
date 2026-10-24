<?php

namespace SilenceWatch\Laravel\Tests;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Orchestra\Testbench\TestCase as Orchestra;
use SilenceWatch\Laravel\Monitor;
use SilenceWatch\Laravel\SilenceWatchServiceProvider;

abstract class TestCase extends Orchestra
{
    /** @var list<array<string, mixed>> */
    protected array $syncs = [];

    /** @var list<string> "<ping key>/<outcome>", in order */
    protected array $pings = [];

    /** @var list<string> query strings of the pings, in order */
    protected array $queries = [];

    protected bool $serverDown = false;

    /** Every request that reached the stand-in, answered or not. */
    protected int $requests = 0;

    protected function getPackageProviders($app): array
    {
        return [SilenceWatchServiceProvider::class];
    }

    protected function defineEnvironment($app): void
    {
        $app['config']->set('silencewatch.api_key', 'sw_test');
        $app['config']->set('silencewatch.url', 'https://watch.test');
        $app['config']->set('silencewatch.environment', 'production');
        $app['config']->set('app.timezone', 'Europe/Paris');
        $app['config']->set('cache.default', 'array');
    }

    protected function setUp(): void
    {
        parent::setUp();

        // A stand-in SilenceWatch: records what it receives, and answers like the
        // real one (a ping key per declared task).
        Http::fake(function (Request $request) {
            $this->requests++;
            if ($this->serverDown) {
                return Http::response('down', 503);
            }
            $path = (string) parse_url($request->url(), PHP_URL_PATH);
            if ($path === '/api/v1/checks/sync') {
                $this->syncs[] = $request->data();
                $checks = array_map(fn (array $check) => ['key' => $check['key'], 'pingKey' => 'pk-'.$check['key']], $request->data()['checks']);

                return Http::response(['checks' => $checks, 'orphaned' => []]);
            }
            $this->pings[] = rawurldecode(substr($path, strlen('/p/')));
            $this->queries[] = (string) parse_url($request->url(), PHP_URL_QUERY);

            return Http::response('OK');
        });
    }

    protected function schedule(): Schedule
    {
        return $this->app->make(Schedule::class);
    }

    /** Each `schedule:run` is a process of its own in production. */
    protected function newProcess(): void
    {
        $this->app->forgetInstance(Monitor::class);
    }
}
