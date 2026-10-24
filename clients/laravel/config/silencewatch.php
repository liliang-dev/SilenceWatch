<?php

// Every setting is an environment variable; publishing this file
// (`php artisan vendor:publish --tag=silencewatch-config`) is only needed to
// compute one in PHP.

return [

    // Without a key nothing is sent, and the application runs as if the package
    // were not installed. Create one in the project's Settings page.
    'api_key' => env('SILENCEWATCH_API_KEY'),

    // Your own instance when you host SilenceWatch yourself.
    'url' => env('SILENCEWATCH_URL', 'https://app.silencewatch.com'),

    // Part of a check's identity: staging declaring the same tasks does not touch
    // production's checks. Letters, digits, dot, dash and underscore.
    'environment' => env('SILENCEWATCH_ENVIRONMENT', env('APP_ENV', 'production')),

    // false removes everything: no declaration, no listener, no request.
    'enabled' => (bool) env('SILENCEWATCH_ENABLED', true),

    // Seconds a run may be late before an alert.
    'default_grace' => (int) env('SILENCEWATCH_DEFAULT_GRACE', 300),

    // false to send only the outcome of a run, not its start.
    'report_start' => (bool) env('SILENCEWATCH_REPORT_START', true),

    // Seconds per request. Short on purpose: a heartbeat is sent by the scheduler
    // itself, between two tasks.
    'timeout' => (float) env('SILENCEWATCH_TIMEOUT', 2),

    // Flag as orphaned the checks of this project and environment that the
    // declaration leaves out. Set to false when several applications share one.
    'prune' => (bool) env('SILENCEWATCH_PRUNE', true),

    // Where the ping keys are kept between two runs of the scheduler. null is the
    // default cache store.
    'cache_store' => env('SILENCEWATCH_CACHE_STORE'),

];
