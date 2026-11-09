import { reportVisit } from './visit';

describe('reportVisit', () => {
  const original = globalThis.fetch;
  let calls: Array<[RequestInfo | URL, RequestInit | undefined]>;

  beforeEach(() => {
    calls = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = original;
    Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: undefined, configurable: true });
  });

  it('reports the page load once, without a body', () => {
    reportVisit();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('/api/v1/visits');
    expect(calls[0]?.[1]).toMatchObject({ method: 'POST', keepalive: true });
    expect(calls[0]?.[1]?.body).toBeUndefined();
  });

  it('reports nothing when the browser asks not to be tracked', () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    reportVisit();
    Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    reportVisit();
    expect(calls).toHaveLength(0);
  });
});
