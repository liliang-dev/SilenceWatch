<?php

namespace SilenceWatch\Laravel\Tests;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * The real scheduler (`schedule:run`) runs real tasks; the stand-in SilenceWatch
 * records what it is told.
 */
final class MonitorTest extends TestCase
{
    public function test_the_first_run_declares_the_schedule(): void
    {
        $this->schedule()->exec('true')->everyMinute();
        $this->schedule()->command('inspire')->dailyAt('02:00');

        $this->artisan('schedule:run')->assertSuccessful();

        $this->assertCount(1, $this->syncs);
        $this->assertSame('production', $this->syncs[0]['environment']);
        $this->assertSame('laravel', $this->syncs[0]['source']);
        $this->assertTrue($this->syncs[0]['prune']);
        $this->assertSame([
            ['key' => 'exec:true', 'name' => 'true', 'cron' => '* * * * *', 'timezone' => 'Europe/Paris', 'grace_seconds' => 300],
            ['key' => 'artisan:inspire', 'name' => 'inspire', 'cron' => '0 2 * * *', 'timezone' => 'Europe/Paris', 'grace_seconds' => 300],
        ], $this->syncs[0]['checks']);
        Http::assertSent(fn ($request) => $request->hasHeader('Authorization', 'Bearer sw_test'));
    }

    public function test_an_unchanged_schedule_is_not_declared_again_by_the_next_run(): void
    {
        $this->schedule()->exec('true')->everyMinute();

        $this->artisan('schedule:run');
        $this->newProcess();
        $this->artisan('schedule:run');

        $this->assertCount(1, $this->syncs);
        $this->assertSame(['pk-exec:true/start', 'pk-exec:true/0', 'pk-exec:true/start', 'pk-exec:true/0'], $this->pings);
    }

    public function test_a_changed_schedule_is_declared_again(): void
    {
        $this->schedule()->exec('true')->everyMinute();
        $this->artisan('schedule:run');

        $this->newProcess();
        $this->schedule()->command('inspire')->daily();
        $this->artisan('schedule:run');

        $this->assertCount(2, $this->syncs);
        $this->assertSame(['exec:true', 'artisan:inspire'], array_column($this->syncs[1]['checks'], 'key'));
    }

    public function test_a_successful_run_is_reported_with_its_duration(): void
    {
        $this->schedule()->exec('true')->everyMinute();

        $this->artisan('schedule:run');

        $this->assertSame(['pk-exec:true/start', 'pk-exec:true/0'], $this->pings);
        $this->assertSame('', $this->queries[0]);
        $this->assertMatchesRegularExpression('/^duration_ms=\d+$/', $this->queries[1]);
    }

    public function test_a_command_that_fails_is_reported_once_with_its_exit_code(): void
    {
        $this->schedule()->exec('exit 3')->everyMinute();

        $this->artisan('schedule:run');

        $this->assertSame(['pk-exec:exit 3/start', 'pk-exec:exit 3/3'], $this->pings);
    }

    public function test_a_closure_that_throws_is_reported_as_failed(): void
    {
        $this->schedule()->call(fn () => throw new RuntimeException('nope'))->name('explode')->everyMinute();

        $this->artisan('schedule:run');

        $this->assertSame(['pk-call:explode/start', 'pk-call:explode/fail'], $this->pings);
    }

    public function test_an_exception_before_the_task_runs_is_reported_as_failed(): void
    {
        $this->schedule()->exec('true')->everyMinute()->before(fn () => throw new RuntimeException('nope'));

        $this->artisan('schedule:run');

        $this->assertSame('pk-exec:true/start', $this->pings[0]);
        $this->assertStringStartsWith('pk-exec:true/fail', $this->pings[1]);
        $this->assertCount(2, $this->pings);
    }

    public function test_a_background_task_is_reported_by_the_process_that_finishes_it(): void
    {
        $event = $this->schedule()->exec('true')->everyMinute()->runInBackground();
        $this->artisan('schedule:run');

        $this->assertSame(['pk-exec:true/start'], $this->pings);

        $this->newProcess();
        $this->artisan('schedule:finish', ['id' => $event->mutexName(), 'code' => 2]);

        $this->assertSame(['pk-exec:true/start', 'pk-exec:true/2'], $this->pings);
    }

    public function test_the_start_is_not_sent_when_asked_not_to(): void
    {
        $this->app['config']->set('silencewatch.report_start', false);
        $this->schedule()->exec('true')->everyMinute();

        $this->artisan('schedule:run');

        $this->assertSame(['pk-exec:true/0'], $this->pings);
    }

    public function test_an_unreachable_silencewatch_costs_the_tasks_nothing(): void
    {
        $this->serverDown = true;
        $ran = 0;
        $this->schedule()->call(function () use (&$ran) {
            $ran++;
        })->name('counted')->everyMinute();

        $this->artisan('schedule:run')->assertSuccessful();

        $this->assertSame(1, $ran);
        $this->assertSame([], $this->pings);

        // Back up: the next run declares, and reports.
        $this->serverDown = false;
        $this->newProcess();
        $this->artisan('schedule:run');

        $this->assertSame(2, $ran);
        $this->assertSame(['pk-call:counted/start', 'pk-call:counted/0'], $this->pings);
    }

    public function test_heartbeats_stop_for_the_rest_of_the_run_once_one_fails(): void
    {
        $this->schedule()->exec('true')->everyMinute();
        $this->schedule()->exec('echo')->everyMinute();
        $this->artisan('schedule:run');
        $this->newProcess();
        $this->serverDown = true;
        $before = $this->requests;

        $this->artisan('schedule:run')->assertSuccessful();

        // Four heartbeats were due; only the first one waited for an answer.
        $this->assertSame(1, $this->requests - $before);
    }

    public function test_the_sync_command_declares_and_says_what_is_left_out(): void
    {
        $this->schedule()->command('inspire')->daily();
        $this->schedule()->call(fn () => null)->daily();

        $this->artisan('silencewatch:sync')
            ->expectsOutputToContain('->name(')
            ->expectsOutputToContain('watching 1 scheduled task(s)')
            ->assertSuccessful();

        $this->assertCount(1, $this->syncs);
    }

    public function test_the_sync_command_fails_when_the_declaration_does(): void
    {
        $this->serverDown = true;
        $this->schedule()->command('inspire')->daily();

        $this->artisan('silencewatch:sync')->assertFailed();
    }

    public function test_servers_share_one_check_per_task_by_default(): void
    {
        $this->schedule()->exec('true')->everyMinute();

        $this->artisan('schedule:run');

        $this->assertCount(1, $this->syncs);
        $this->assertSame('production', $this->syncs[0]['environment']);
    }

    public function test_per_server_tasks_are_declared_in_the_server_environment(): void
    {
        config()->set('silencewatch.per_instance_tasks', 'exec:true');
        config()->set('silencewatch.instance_id', 'web-1');
        $this->schedule()->exec('true')->everyMinute();
        $this->schedule()->command('inspire')->daily();

        $this->artisan('schedule:run');

        $declared = array_column(array_map(fn ($sync) => [$sync['environment'], array_column($sync['checks'], 'key')], $this->syncs), 1, 0);
        $this->assertSame(['production' => ['artisan:inspire'], 'production.web-1' => ['exec:true']], $declared);
        $this->assertSame(['pk-exec:true/start', 'pk-exec:true/0'], $this->pings);
    }

    public function test_servers_sharing_a_cache_do_not_declare_again_at_every_run(): void
    {
        config()->set('silencewatch.per_instance_tasks', 'exec:*');
        $this->schedule()->exec('true')->everyMinute();

        foreach (['web-1', 'web-2', 'web-1', 'web-2'] as $server) {
            config()->set('silencewatch.instance_id', $server);
            $this->newProcess();
            $this->artisan('schedule:run');
        }

        // One declaration per server, then the cache: not one per run.
        $this->assertSame(['production.web-1', 'production.web-2'], array_column($this->syncs, 'environment'));
    }

    public function test_a_task_on_one_server_is_never_watched_per_server(): void
    {
        Log::spy();
        config()->set('silencewatch.per_instance_tasks', '*');
        config()->set('silencewatch.instance_id', 'web-1');
        $this->schedule()->exec('true')->everyMinute()->onOneServer();

        $this->artisan('schedule:run');

        $this->assertSame(['production'], array_column($this->syncs, 'environment'));
        Log::shouldHaveReceived('warning')->withArgs(fn ($message) => str_contains($message, 'onOneServer()'));
    }

    public function test_per_server_tasks_stay_shared_without_an_instance_id(): void
    {
        Log::spy();
        config()->set('silencewatch.per_instance_tasks', ['exec:true']);
        $this->schedule()->exec('true')->everyMinute();

        $this->artisan('schedule:run');

        $this->assertSame(['production'], array_column($this->syncs, 'environment'));
        Log::shouldHaveReceived('warning')->withArgs(fn ($message) => str_contains($message, 'instance_id is missing'));
    }

    public function test_the_server_environment_is_one_silencewatch_accepts(): void
    {
        config()->set('silencewatch.per_instance_tasks', 'exec:true');
        config()->set('silencewatch.instance_id', 'billing-reconciliation@worker-statefulset-12');
        $this->schedule()->exec('true')->everyMinute();

        $this->artisan('schedule:run');

        $environment = $this->syncs[0]['environment'];
        $this->assertSame(40, strlen($environment));
        $this->assertStringStartsWith('production.', $environment);
        $this->assertStringEndsWith('worker-statefulset-12', $environment);
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9._-]+$/', $environment);
    }
}
