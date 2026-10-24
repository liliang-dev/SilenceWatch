<?php

namespace SilenceWatch\Laravel\Tests;

use SilenceWatch\Laravel\ScheduleReader;

final class ScheduleReaderTest extends TestCase
{
    private function read(string $environment = 'production'): ScheduleReader
    {
        return new ScheduleReader($this->schedule(), $environment, 'Europe/Paris');
    }

    /** @return array<string, array{key: string, name: string, cron: string, timezone: string}> */
    private function tasks(string $environment = 'production'): array
    {
        $tasks = [];
        foreach ($this->read($environment)->tasks() as $task) {
            $tasks[$task['key']] = $task;
        }

        return $tasks;
    }

    public function test_every_kind_of_task_gets_a_stable_key(): void
    {
        $this->schedule()->command('inspire --quiet')->dailyAt('02:00');
        $this->schedule()->exec('/opt/scripts/export.sh')->hourly();
        $this->schedule()->job(new Fixtures\PruneOrders)->everyFifteenMinutes();
        $this->schedule()->call(fn () => null)->name('refresh-rates')->weekdays()->at('09:30');

        $tasks = $this->tasks();

        $this->assertSame(['artisan:inspire --quiet', 'exec:/opt/scripts/export.sh', 'call:'.Fixtures\PruneOrders::class, 'call:refresh-rates'], array_keys($tasks));
        $this->assertSame('0 2 * * *', $tasks['artisan:inspire --quiet']['cron']);
        $this->assertSame('Europe/Paris', $tasks['artisan:inspire --quiet']['timezone']);
        $this->assertSame('30 9 * * 1-5', $tasks['call:refresh-rates']['cron']);
    }

    public function test_the_key_does_not_depend_on_where_php_is_installed(): void
    {
        $this->schedule()->command('inspire')->daily();

        $key = array_keys($this->tasks())[0];

        $this->assertSame('artisan:inspire', $key);
        $this->assertStringNotContainsString(PHP_BINARY, $key);
    }

    public function test_a_description_is_the_name_shown(): void
    {
        $this->schedule()->command('inspire')->daily()->description('Nightly inspiration');

        $this->assertSame('Nightly inspiration', $this->tasks()['artisan:inspire']['name']);
    }

    public function test_a_task_keeps_its_own_time_zone(): void
    {
        $this->schedule()->command('inspire')->daily()->timezone('America/New_York');

        $this->assertSame('America/New_York', $this->tasks()['artisan:inspire']['timezone']);
    }

    public function test_a_task_scheduled_twice_is_declared_from_the_schedule_that_fires_most_often(): void
    {
        $this->schedule()->command('inspire')->daily();
        $this->schedule()->command('inspire')->everyTenMinutes();
        $this->schedule()->command('inspire')->hourly();

        $tasks = $this->tasks();

        $this->assertCount(1, $tasks);
        $this->assertSame('*/10 * * * *', $tasks['artisan:inspire']['cron']);
    }

    public function test_tasks_of_another_environment_are_left_out(): void
    {
        $this->schedule()->command('inspire')->daily()->environments('staging');
        $this->schedule()->command('about')->daily()->environments(['production']);

        $this->assertSame(['artisan:about'], array_keys($this->tasks()));
        $this->assertSame(['artisan:inspire'], array_keys($this->tasks('staging')));
    }

    public function test_what_cannot_be_watched_is_left_out_with_a_reason(): void
    {
        $this->schedule()->call(fn () => null)->daily();
        $this->schedule()->command('inspire')->hourly()->between('8:00', '17:00');
        $this->schedule()->command('about')->daily()->when(fn () => true);
        $this->schedule()->command('list')->cron('0 0 15W * *');
        $this->schedule()->command('env')->daily()->withoutOverlapping();

        $reader = $this->read();

        $this->assertSame(['artisan:env'], array_column($reader->tasks(), 'key'));
        $this->assertCount(4, $reader->skipped());
        $this->assertStringContainsString('->name(', $reader->skipped()[0]);
        $this->assertStringContainsString('artisan:inspire', $reader->skipped()[1]);
    }

    public function test_a_very_long_command_still_has_a_key_the_server_accepts(): void
    {
        $this->schedule()->exec('/opt/run '.str_repeat('--flag ', 80))->daily();

        $key = array_keys($this->tasks())[0];

        $this->assertLessThanOrEqual(300, strlen($key));
        $this->assertStringStartsWith('exec:/opt/run', $key);
    }
}
