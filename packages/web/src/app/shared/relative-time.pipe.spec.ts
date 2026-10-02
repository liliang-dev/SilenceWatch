import { TestBed } from '@angular/core/testing';
import type { I18n } from '../core/i18n/i18n.service';
import { loadI18n, provideI18n } from '../core/i18n/i18n.testing';
import { DurationPipe, RelativeTimePipe } from './relative-time.pipe';

describe('RelativeTimePipe', () => {
  let pipe: RelativeTimePipe;
  let i18n: I18n;
  const now = new Date('2026-07-30T12:00:00.000Z');

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideI18n()] });
    // Loaded with the real timers: the file arrives through a promise.
    i18n = await loadI18n('en');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    pipe = TestBed.runInInjectionContext(() => new RelativeTimePipe());
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('says "never" rather than showing an empty cell', () => {
    // A check that has never reported is the interesting case, not a blank.
    expect(pipe.transform(null)).toBe('never');
    expect(pipe.transform(undefined)).toBe('never');
  });

  it('reads the past and the future', () => {
    expect(pipe.transform('2026-07-30T11:57:00.000Z')).toBe('3 minutes ago');
    expect(pipe.transform('2026-07-30T14:00:00.000Z')).toBe('in 2 hours');
    expect(pipe.transform('2026-07-29T12:00:00.000Z')).toBe('yesterday');
  });

  /**
   * `Intl.RelativeTimeFormat` with no locale takes the system's, so a laptop set
   * to French used to produce "il y a 3 minutes" and a red suite that said
   * nothing about what was wrong. The pipe now takes the application's language,
   * which the test pins, so the output no longer depends on the machine.
   */
  it('formats in the language of the application, not of the machine', () => {
    const english = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    expect(pipe.transform('2026-07-30T11:57:00.000Z')).toBe(english.format(-3, 'minute'));
    expect(pipe.transform('2026-07-30T14:00:00.000Z')).toBe(english.format(2, 'hour'));
  });

  it('follows the language when it changes, without a new input', async () => {
    // The same timestamp, asked again: this is what a pure pipe would get wrong.
    expect(pipe.transform('2026-07-30T11:57:00.000Z')).toBe('3 minutes ago');
    vi.useRealTimers();
    await i18n.set('fr');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(pipe.transform('2026-07-30T11:57:00.000Z')).toBe('il y a 3 minutes');
    expect(pipe.transform(null)).toBe('jamais');
    expect(pipe.transform(now)).toBe("à l'instant");
  });

  it('collapses anything very recent to "just now"', () => {
    expect(pipe.transform('2026-07-30T11:59:57.000Z')).toBe('just now');
    expect(pipe.transform(now)).toBe('just now');
  });

  it('survives a malformed timestamp', () => {
    expect(pipe.transform('not a date')).toBe('—');
  });
});

describe('DurationPipe', () => {
  const pipe = new DurationPipe();

  it.each([
    [null, '—'],
    [0, '0ms'],
    [850, '850ms'],
    [4_200, '4.2s'],
    [200_000, '3m 20s'],
    [180_000, '3m'],
    [7_260_000, '2h 1m'],
  ])('formats %s as %s', (input, expected) => {
    expect(pipe.transform(input)).toBe(expected);
  });
});
