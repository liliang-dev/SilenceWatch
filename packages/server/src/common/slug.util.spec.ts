import { slugify, uniqueSlug } from './slug.util';

describe('slugify', () => {
  it.each([
    ['Nightly backup', 'nightly-backup'],
    ['Sauvegarde quotidienne à 2h', 'sauvegarde-quotidienne-a-2h'],
    ['  Trim   me  ', 'trim-me'],
    ['ETL / Facturation (v2)', 'etl-facturation-v2'],
    ['com.acme.jobs.BackupJob#run', 'com-acme-jobs-backupjob-run'],
    ['UPPER_snake_Case', 'upper-snake-case'],
  ])('turns %j into %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('never returns an empty slug', () => {
    for (const input of ['', '   ', '---', '???', '日本語']) {
      expect(slugify(input)).toMatch(/^[a-z0-9-]+$/);
      expect(slugify(input).length).toBeGreaterThan(0);
    }
  });

  it('bounds the length and never ends with a dash', () => {
    const slug = slugify('a'.repeat(200));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
    expect(slugify(`${'b'.repeat(59)} tail`).endsWith('-')).toBe(false);
  });
});

describe('uniqueSlug', () => {
  it('returns the plain slug when it is free', async () => {
    await expect(uniqueSlug('Nightly backup', async () => false)).resolves.toBe('nightly-backup');
  });

  it('suffixes on collision', async () => {
    const taken = new Set(['nightly-backup']);
    await expect(uniqueSlug('Nightly backup', async (candidate) => taken.has(candidate))).resolves.toBe(
      'nightly-backup-2',
    );
  });

  it('always terminates, even when everything is taken', async () => {
    const slug = await uniqueSlug('Nightly backup', async () => true);
    expect(slug).toMatch(/^nightly-backup-[0-9a-f]{6}$/);
  });
});
