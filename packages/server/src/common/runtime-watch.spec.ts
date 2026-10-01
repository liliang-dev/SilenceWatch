import { Logger } from '@nestjs/common';
import { EventLoopLagMonitor, registerSlowRequestLog } from './runtime-watch';

describe('EventLoopLagMonitor', () => {
  function monitor(): { monitor: EventLoopLagMonitor; advance: (ms: number) => void } {
    let clock = 1_000_000;
    return {
      monitor: new EventLoopLagMonitor({ intervalMs: 1_000, warnAfterMs: 500 }, () => clock),
      advance: (ms) => {
        clock += ms;
      },
    };
  }

  it('reports no lag when the loop turns on time', () => {
    const { monitor: watch, advance } = monitor();
    advance(1_000);
    expect(watch.tick()).toBe(0);
  });

  it('measures how much later than scheduled a sample ran, and says so', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { monitor: watch, advance } = monitor();
    advance(1_000 + 4_200);

    expect(watch.tick()).toBe(4_200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('blocked for 4200ms'));
    warn.mockRestore();
  });

  it('stays quiet about lag below the threshold', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { monitor: watch, advance } = monitor();
    advance(1_000 + 499);

    expect(watch.tick()).toBe(499);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not report a negative lag when a sample runs early', () => {
    const { monitor: watch, advance } = monitor();
    advance(900);
    expect(watch.tick()).toBe(0);
  });

  it('measures each sample from the previous one, not from the start', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { monitor: watch, advance } = monitor();
    advance(1_000 + 2_000);
    watch.tick();
    advance(1_000);
    expect(watch.tick()).toBe(0);
    jest.restoreAllMocks();
  });
});

describe('registerSlowRequestLog', () => {
  function setup(thresholdMs?: number): {
    run: (request: object, reply: object) => void;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let hook: ((request: never, reply: never) => void) | undefined;
    registerSlowRequestLog(
      {
        addHook: (_name, handler) => {
          hook = handler as never;
        },
      },
      thresholdMs,
      { warn: (message: string) => void warnings.push(message) },
    );
    return { run: (request, reply) => hook?.(request as never, reply as never), warnings };
  }

  it('stays silent for a request that was quick', () => {
    const { run, warnings } = setup();
    run({ method: 'GET', routeOptions: { url: '/api/v1/projects' } }, { statusCode: 200, elapsedTime: 12 });
    expect(warnings).toEqual([]);
  });

  it('names a slow request by its route pattern, never by its URL', () => {
    const { run, warnings } = setup(2_000);
    // A heartbeat URL carries its secret: only the declared pattern may be logged.
    run(
      {
        method: 'POST',
        url: '/p/very-secret-token-value',
        routeOptions: { url: '/p/:token' },
      },
      { statusCode: 200, elapsedTime: 31_250 },
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toBe('Slow request: POST /p/:token took 31250ms (status 200)');
    expect(warnings[0]).not.toContain('very-secret-token-value');
  });

  it('copes with a request that matched no route', () => {
    const { run, warnings } = setup(1);
    run({ method: 'GET' }, { statusCode: 404, elapsedTime: 5 });
    expect(warnings[0]).toContain('(no route)');
  });
});
