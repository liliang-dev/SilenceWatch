<?php

namespace SilenceWatch\Laravel\Tests;

use Illuminate\Support\Facades\Http;

final class DisabledTest extends TestCase
{
    protected function defineEnvironment($app): void
    {
        parent::defineEnvironment($app);
        $app['config']->set('silencewatch.api_key', null);
    }

    public function test_without_a_key_nothing_is_sent_and_the_tasks_run(): void
    {
        $ran = false;
        $this->schedule()->call(function () use (&$ran) {
            $ran = true;
        })->name('task')->everyMinute();

        $this->artisan('schedule:run')->assertSuccessful();

        $this->assertTrue($ran);
        Http::assertNothingSent();
    }

    public function test_the_sync_command_says_why_it_does_nothing(): void
    {
        $this->artisan('silencewatch:sync')
            ->expectsOutputToContain('SILENCEWATCH_API_KEY')
            ->assertSuccessful();
        Http::assertNothingSent();
    }
}
