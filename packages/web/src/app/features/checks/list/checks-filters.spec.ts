import type { CheckDto } from '@silencewatch/shared';
import { NO_ENVIRONMENT, effectiveEnvironment, environmentsOf, matchesEnvironment } from './checks-filters';

const check = (environment: string | null): CheckDto => ({ environment }) as CheckDto;

describe('the environment filter', () => {
  const checks = [check('production'), check(' staging '), check(null), check(''), check('production')];

  it('lists each environment once, in order, without the empty ones', () => {
    expect(environmentsOf(checks)).toEqual(['production', 'staging']);
  });

  it('matches all, one environment, or none', () => {
    expect(checks.filter((c) => matchesEnvironment(c, '')).length).toBe(5);
    expect(checks.filter((c) => matchesEnvironment(c, 'production')).length).toBe(2);
    expect(checks.filter((c) => matchesEnvironment(c, 'staging')).length).toBe(1);
    expect(checks.filter((c) => matchesEnvironment(c, NO_ENVIRONMENT)).length).toBe(2);
  });

  it('is no filter when the chosen environment is not in the checks any more', () => {
    expect(effectiveEnvironment('production', ['production'], true)).toBe('production');
    expect(effectiveEnvironment('gone', ['production'], true)).toBe('');
    expect(effectiveEnvironment(NO_ENVIRONMENT, ['production'], false)).toBe('');
    expect(effectiveEnvironment(NO_ENVIRONMENT, ['production'], true)).toBe(NO_ENVIRONMENT);
    expect(effectiveEnvironment(NO_ENVIRONMENT, [], true)).toBe('');
  });
});
