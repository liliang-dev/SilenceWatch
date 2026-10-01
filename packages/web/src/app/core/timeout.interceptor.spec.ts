import { HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { REQUEST_TIMEOUT_MS, timeoutInterceptor } from './timeout.interceptor';

describe('timeoutInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([timeoutInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers normally when the server answers in time', () => {
    let body: unknown;
    http.get('/api/v1/projects').subscribe((value) => (body = value));

    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS - 1);
    backend.expectOne('/api/v1/projects').flush({ ok: true });

    expect(body).toEqual({ ok: true });
  });

  it('gives up on a read the server never answers, as a 504, and aborts it', () => {
    let failure: unknown;
    http.get('/api/v1/projects').subscribe({ error: (error: unknown) => (failure = error) });

    const pending = backend.expectOne('/api/v1/projects');
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS);

    expect(failure).toBeInstanceOf(HttpErrorResponse);
    expect((failure as HttpErrorResponse).status).toBe(504);
    // Unsubscribing is what cancels the request in the browser.
    expect(pending.cancelled).toBe(true);
  });

  it('leaves writes alone: a POST that timed out may still have succeeded', () => {
    let failure: unknown;
    http.post('/api/v1/projects', { name: 'x' }).subscribe({
      error: (error: unknown) => (failure = error),
    });

    const pending = backend.expectOne('/api/v1/projects');
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS * 10);

    expect(failure).toBeUndefined();
    expect(pending.cancelled).toBe(false);
  });

  it('passes other failures through untouched', () => {
    let failure: unknown;
    http.get('/api/v1/projects').subscribe({ error: (error: unknown) => (failure = error) });

    backend.expectOne('/api/v1/projects').flush('nope', { status: 500, statusText: 'Server Error' });

    expect((failure as HttpErrorResponse).status).toBe(500);
  });
});
