import { TestBed } from '@angular/core/testing';
import { en } from './en';
import { fr } from './fr';
import { I18n } from './i18n.service';

describe('I18n', () => {
  let i18n: I18n;

  beforeEach(() => {
    localStorage.clear();
    i18n = TestBed.inject(I18n);
    i18n.set('en');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('lang');
  });

  it('translates, and fills the placeholders', () => {
    expect(i18n.t('shell.signOut')).toBe('Sign out');
    expect(i18n.t('settings.projectCreated', { name: 'Billing' })).toBe('"Billing" created');

    i18n.set('fr');
    expect(i18n.t('shell.signOut')).toBe('Se déconnecter');
    expect(i18n.t('settings.projectCreated', { name: 'Billing' })).toBe('«\u00a0Billing\u00a0» créé');
  });

  it('remembers the choice, and says so on the document', () => {
    i18n.set('fr');
    expect(localStorage.getItem('silencewatch.language')).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');

    i18n.set('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it("picks the plural form by the language's own rules", () => {
    // English: 0 is plural. French: 0 is singular. A count of "0 check" in French
    // is correct, and "0 checks" in English is.
    expect(i18n.plural('settings.checkCount', 0)).toBe('0 checks');
    expect(i18n.plural('settings.checkCount', 1)).toBe('1 check');
    expect(i18n.plural('settings.checkCount', 5)).toBe('5 checks');

    i18n.set('fr');
    expect(i18n.plural('settings.checkCount', 0)).toBe('0 check');
    expect(i18n.plural('settings.checkCount', 2)).toBe('2 checks');
  });

  it('uses an explicit zero form where a sentence needs one', () => {
    expect(i18n.plural('detail.pingCount', 0)).toBe('No ping');
    expect(i18n.plural('detail.pingCount', 3)).toBe('3 pings');
    i18n.set('fr');
    expect(i18n.plural('detail.pingCount', 0)).toBe('Aucun ping');
  });

  it('lets the caller override the count it counts by', () => {
    // The verb follows how many are broken, the noun how many there are.
    i18n.set('en');
    expect(
      i18n.plural('checks.subtitleBroken', 1, {
        broken: 1,
        count: 5,
        noun: i18n.plural('checks.noun', 5),
      }),
    ).toBe('1 of 5 checks needs attention');
    expect(
      i18n.plural('checks.subtitleBroken', 2, {
        broken: 2,
        count: 5,
        noun: i18n.plural('checks.noun', 5),
      }),
    ).toBe('2 of 5 checks need attention');
  });

  it('cuts a sentence open at a placeholder', () => {
    expect(i18n.around('projectForm.slugNote', 'slug')).toEqual([
      'The URL slug stays ',
      '. Ping URLs already deployed keep working.',
    ]);
  });
});

/**
 * `fr.ts` is typed against `en.ts`, so a missing key is a compile error. What
 * the types cannot see is a translation that dropped a placeholder: it compiles,
 * and renders as a sentence with a hole in it.
 */
describe('the dictionaries', () => {
  const placeholders = (text: string): string[] =>
    [...text.matchAll(/\{(\w+)\}/gu)].map((match) => match[1] ?? '').sort();

  it.each(Object.keys(en) as Array<keyof typeof en>)(
    '%s keeps its placeholders in French',
    (key) => {
      expect(placeholders(fr[key])).toEqual(placeholders(en[key]));
    },
  );

  it.each(Object.keys(fr) as Array<keyof typeof fr>)('%s is not empty', (key) => {
    expect(fr[key].trim()).not.toBe('');
    expect(en[key].trim()).not.toBe('');
  });
});
