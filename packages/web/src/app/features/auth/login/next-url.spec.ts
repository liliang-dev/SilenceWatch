import { safeNextUrl } from './next-url';

describe('safeNextUrl', () => {
  it('keeps a path on this site', () => {
    expect(safeNextUrl('/checks/42?tab=pings')).toBe('/checks/42?tab=pings');
    expect(safeNextUrl('/settings')).toBe('/settings');
  });

  it('sends anything that could leave the site to the checks', () => {
    for (const next of [
      null,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      'javascript:alert(1)',
    ]) {
      expect(safeNextUrl(next)).toBe('/checks');
    }
  });
});
