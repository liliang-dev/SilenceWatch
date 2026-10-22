import { splitDuration, toSeconds, type DurationUnit } from './duration';

describe('splitDuration', () => {
  it.each([
    [30, 30, 'seconds'],
    [60, 1, 'minutes'],
    [90, 90, 'seconds'],
    [300, 5, 'minutes'],
    [3600, 1, 'hours'],
    [5400, 90, 'minutes'],
    [86_400, 1, 'days'],
    [172_800, 2, 'days'],
    [604_800, 1, 'weeks'],
    [1_209_600, 2, 'weeks'],
    [691_200, 8, 'days'],
  ])('says %s seconds as %s %s', (seconds, value, unit) => {
    expect(splitDuration(seconds)).toEqual({ value, unit });
  });

  it('uses only the units it is given', () => {
    const units: DurationUnit[] = ['minutes', 'hours', 'days'];
    expect(splitDuration(604_800, units)).toEqual({ value: 7, unit: 'days' });
    expect(splitDuration(90, units)).toEqual({ value: 1.5, unit: 'minutes' });
  });

  it('gives zero, and anything unusable, in the fallback unit', () => {
    expect(splitDuration(0)).toEqual({ value: 0, unit: 'minutes' });
    expect(splitDuration(Number.NaN, undefined, 'hours')).toEqual({ value: 0, unit: 'hours' });
    expect(splitDuration(0, ['seconds', 'days'], 'weeks')).toEqual({ value: 0, unit: 'seconds' });
  });
});

describe('toSeconds', () => {
  it.each([
    [1, 'minutes', 60],
    [2, 'hours', 7200],
    [3, 'days', 259_200],
    [1, 'weeks', 604_800],
    ['15', 'minutes', 900],
    [0.5, 'hours', 1800],
  ] as const)('turns %s %s into %s seconds', (value, unit, seconds) => {
    expect(toSeconds(value, unit)).toBe(seconds);
  });

  it('is null when nothing usable was typed', () => {
    expect(toSeconds('', 'hours')).toBeNull();
    expect(toSeconds(null, 'hours')).toBeNull();
    expect(toSeconds('abc', 'hours')).toBeNull();
  });

  it('is the inverse of splitDuration', () => {
    for (const seconds of [30, 45, 60, 600, 3600, 5400, 86_400, 604_800, 1_814_400]) {
      const { value, unit } = splitDuration(seconds);
      expect(toSeconds(value, unit)).toBe(seconds);
    }
  });
});
