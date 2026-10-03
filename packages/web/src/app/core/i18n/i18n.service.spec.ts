import { TestBed } from '@angular/core/testing';
import en from './en.json';
import fr from './fr.json';
import type { I18n } from './i18n.service';
import { loadI18n, provideI18n } from './i18n.testing';
import type { MessageKey } from './messages';

describe('I18n', () => {
  let i18n: I18n;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideI18n()] });
    i18n = await loadI18n('en');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('lang');
  });

  it('translates, and fills the placeholders', async () => {
    expect(i18n.t('shell.signOut')).toBe('Sign out');
    expect(i18n.t('settings.projectCreated', { name: 'Billing' })).toBe('"Billing" created');

    await i18n.set('fr');
    expect(i18n.t('shell.signOut')).toBe('Se déconnecter');
    expect(i18n.t('settings.projectCreated', { name: 'Billing' })).toBe('« Billing » créé');
  });

  it('remembers the choice, and says so on the document', async () => {
    await i18n.set('fr');
    expect(i18n.language()).toBe('fr');
    expect(localStorage.getItem('silencewatch.language')).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');

    await i18n.set('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it("picks the plural form by the language's own rules", async () => {
    // English: 0 is plural. French: 0 is singular. "0 check" in French is right,
    // and "0 checks" in English is.
    const checks = (count: number) => i18n.plural('settings.checkCount', count);
    expect(checks(0)).toBe('0 checks');
    expect(checks(1)).toBe('1 check');
    expect(checks(5)).toBe('5 checks');

    await i18n.set('fr');
    expect(checks(0)).toBe('0 check');
    expect(checks(2)).toBe('2 checks');
  });

  it('has an explicit zero form where a sentence needs one', async () => {
    const pings = (count: number) => i18n.plural('detail.pingCount', count);
    expect(pings(0)).toBe('No ping');
    expect(pings(3)).toBe('3 pings');
    await i18n.set('fr');
    expect(pings(0)).toBe('Aucun ping');
  });

  it('lets the caller count by one number and show another', async () => {
    // "1 of 5 checks needs attention": counted by how many are broken, with the
    // noun following the total.
    const subtitle = (broken: number, count: number) =>
      i18n.plural('checks.subtitleBroken', broken, {
        broken,
        count,
        noun: i18n.plural('checks.noun', count),
      });
    expect(subtitle(1, 5)).toBe('1 of 5 checks needs attention');
    expect(subtitle(2, 5)).toBe('2 of 5 checks need attention');
    expect(subtitle(1, 1)).toBe('1 of 1 check needs attention');

    await i18n.set('fr');
    expect(subtitle(1, 5)).toBe('Attention requise pour 1 check sur 5');
    expect(subtitle(2, 5)).toBe('Attention requise pour 2 checks sur 5');
  });

  it('keeps apostrophes as apostrophes', async () => {
    await i18n.set('fr');
    expect(i18n.t('detail.rotateMessage', { name: 'backup' })).toContain(
      "L'URL de « backup » cesse",
    );
  });

  it('cuts a message open at a placeholder', () => {
    expect(i18n.around('projectForm.slugNote', 'slug')).toEqual([
      'The URL slug stays ',
      '. Ping URLs already deployed keep working.',
    ]);
  });
});

/**
 * The dictionaries are JSON, so the compiler cannot compare them. These do.
 *
 * Every message is also formatted for real, in both languages, with a stand-in
 * for every value: a message with a stray brace, which would otherwise surface
 * as a hole in a sentence the first time its screen was opened, fails here
 * instead.
 */
describe('the dictionaries', () => {
  const english = en as Record<string, string>;
  const french = fr as Record<string, string>;

  const args = (text: string): string[] =>
    [...new Set([...text.matchAll(/\{(\w+)\}/gu)].map((match) => match[1] ?? ''))].sort();

  it('have the same keys in both languages', () => {
    expect(Object.keys(french).sort()).toEqual(Object.keys(english).sort());
  });

  /**
   * French may leave a value out — "Attention requise pour 1 check sur 5" has no
   * use for the noun that English needs to agree — but may not invent one, which
   * would be rendered as a hole.
   */
  it.each(Object.keys(en))('%s uses no argument that English does not give it', (key) => {
    const given = args(english[key] ?? '');
    for (const name of args(french[key] ?? '')) expect(given).toContain(name);
  });

  describe.each(['en', 'fr'] as const)('in %s', (language) => {
    let i18n: I18n;

    beforeEach(async () => {
      localStorage.clear();
      TestBed.configureTestingModule({ providers: [provideI18n()] });
      i18n = await loadI18n(language);
    });

    afterEach(() => localStorage.clear());

    it.each(Object.keys(en))('%s formats', (key) => {
      const everything = new Proxy({}, { get: () => 2 }) as Record<string, number>;
      const text = i18n.t(key as MessageKey, everything);
      expect(text.trim()).not.toBe('');
      expect(text).not.toContain('undefined');
      expect(text).not.toMatch(/[{}]/u);
    });
  });
});
