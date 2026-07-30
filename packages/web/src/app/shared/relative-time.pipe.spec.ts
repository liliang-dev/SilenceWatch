import { DurationPipe, RelativeTimePipe } from './relative-time.pipe';

describe('RelativeTimePipe', () => {
  const pipe = new RelativeTimePipe();
  const now = new Date('2026-07-30T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says "never" rather than showing an empty cell', () => {
    // A check that has never reported is the interesting case, not a blank.
    expect(pipe.transform(null)).toBe('never');
    expect(pipe.transform(undefined)).toBe('never');
  });

  it('reads the past and the future', () => {
    expect(pipe.transform('2026-07-30T11:57:00.000Z')).toContain('3 minutes ago');
    expect(pipe.transform('2026-07-30T14:00:00.000Z')).toContain('in 2 hours');
    expect(pipe.transform('2026-07-29T12:00:00.000Z')).toContain('yesterday');
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
