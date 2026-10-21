import { generateRecoveryCode, normaliseRecoveryCode } from './recovery-codes.service';

describe('recovery codes', () => {
  it('are three groups of four from an alphabet without look-alikes', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(generateRecoveryCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$/);
    }
  });

  it('do not repeat', () => {
    const codes = new Set(Array.from({ length: 1_000 }, generateRecoveryCode));
    expect(codes.size).toBe(1_000);
  });

  it('are read the way a person copies them', () => {
    const canonical = normaliseRecoveryCode('ABCD-EFGH-JKMN');
    expect(normaliseRecoveryCode('abcd efgh jkmn')).toBe(canonical);
    expect(normaliseRecoveryCode('  ABCDEFGHJKMN  ')).toBe(canonical);
    expect(normaliseRecoveryCode('abcd-efgh-jkmn\n')).toBe(canonical);
  });

  it('treat the letters that look like digits as the digits', () => {
    expect(normaliseRecoveryCode('O0IL-1111-2222')).toBe('001111112222');
  });
});
