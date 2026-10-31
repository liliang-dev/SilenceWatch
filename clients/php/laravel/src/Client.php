<?php

namespace SilenceWatch\Laravel;

use Illuminate\Http\Client\Factory as Http;
use Throwable;

/**
 * The two calls SilenceWatch needs: the declaration, and a heartbeat.
 *
 * Neither ever throws. Monitoring must not break what it monitors, so a
 * failure is a return value, and the caller carries on.
 */
final class Client
{
    public const VERSION = '0.2.0';

    /** A heartbeat that failed stops the next ones for this long, in this process. */
    private const BACKOFF_SECONDS = 60;

    private float $downUntil = 0.0;

    public function __construct(
        private readonly Http $http,
        private readonly string $url,
        private readonly string $apiKey,
        private readonly float $timeout,
    ) {}

    /**
     * Declares the tasks; returns their ping keys indexed by task key, or null
     * when the declaration did not go through.
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, string>|null
     */
    public function sync(array $payload, ?string &$error = null): ?array
    {
        try {
            $response = $this->request()
                ->withToken($this->apiKey)
                ->acceptJson()
                ->post($this->base().'/api/v1/checks/sync', $payload);
        } catch (Throwable $e) {
            $error = $e->getMessage();

            return null;
        }

        if (! $response->successful()) {
            $error = 'HTTP '.$response->status().': '.mb_substr(trim($response->body()), 0, 200);

            return null;
        }

        $keys = [];
        foreach ((array) $response->json('checks', []) as $check) {
            if (is_array($check) && is_string($check['key'] ?? null) && is_string($check['pingKey'] ?? null)) {
                $keys[$check['key']] = $check['pingKey'];
            }
        }

        return $keys;
    }

    /**
     * One heartbeat. `$outcome` is "start", "fail" or an exit code (0 succeeds).
     */
    public function ping(string $pingKey, string|int $outcome, ?int $durationMs = null): bool
    {
        // PHP has no background thread to hand the request to, so the scheduler
        // waits for it. Once SilenceWatch has not answered, the next tasks of this
        // run do not wait for it again.
        if (microtime(true) < $this->downUntil) {
            return false;
        }

        $url = $this->base().'/p/'.rawurlencode($pingKey).'/'.$outcome;
        if ($durationMs !== null) {
            $url .= '?duration_ms='.max(0, $durationMs);
        }

        try {
            if ($this->request()->post($url)->successful()) {
                return true;
            }
        } catch (Throwable) {
            // Unreachable, timed out: same as a refusal.
        }

        $this->downUntil = microtime(true) + self::BACKOFF_SECONDS;

        return false;
    }

    private function request(): \Illuminate\Http\Client\PendingRequest
    {
        return $this->http->timeout($this->timeout)
            ->connectTimeout($this->timeout)
            ->withUserAgent('silencewatch-laravel/'.self::VERSION);
    }

    private function base(): string
    {
        return rtrim($this->url, '/');
    }
}
