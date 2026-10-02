import { Injectable, signal } from '@angular/core';
import { readStored, writeStored } from '../storage';
import { en, type MessageKey, type Messages } from './en';
import { fr } from './fr';

export type Language = 'en' | 'fr';

export const LANGUAGES: readonly Language[] = ['en', 'fr'];

/** Read by `public/theme-init.js` too, so the page is in the right language before the app starts. */
export const LANGUAGE_STORAGE_KEY = 'silencewatch.language';

const DICTIONARIES: Record<Language, Messages> = { en, fr };

/** The base of every plural: `foo` for the pair `foo_one` / `foo_other`. */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}_other` ? Base : never;
}[MessageKey];

export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

function isLanguage(value: string | null): value is Language {
  return value === 'en' || value === 'fr';
}

/**
 * What was chosen before, or else what the browser asks for. A French browser
 * gets French on the first visit; everything else gets English, which is also
 * what a language nobody translated falls back to.
 */
function initialLanguage(): Language {
  const stored = readStored(LANGUAGE_STORAGE_KEY);
  if (isLanguage(stored)) return stored;
  return /^fr\b/i.test(globalThis.navigator?.language ?? '') ? 'fr' : 'en';
}

function interpolate(text: string, params: Params | undefined): string {
  if (params === undefined) return text;
  return text.replace(/\{(\w+)\}/gu, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}

/**
 * The language of the interface, and the one function that turns a key into
 * text in it.
 *
 * `t` and `plural` read a signal, so a template that calls them is re-rendered
 * when the language changes — there is nothing to subscribe to and no page to
 * reload. They are arrow properties so a component can keep `protected readonly
 * t = inject(I18n).t` and call it bare in a template.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly current = signal<Language>(initialLanguage());

  readonly language = this.current.asReadonly();

  constructor() {
    this.reflect(this.current());
  }

  set(language: Language): void {
    if (language === this.current()) return;
    this.current.set(language);
    writeStored(LANGUAGE_STORAGE_KEY, language);
    this.reflect(language);
  }

  readonly t: Translate = (key, params) => interpolate(DICTIONARIES[this.current()][key], params);

  /**
   * A sentence cut open at one placeholder: what comes before `{name}` and what
   * comes after it. For the few messages that wrap a value in markup — an
   * address in bold, a slug in monospace — where the order of the words is the
   * translator's to decide and the template's to dress.
   */
  readonly around = (key: MessageKey, name: string): [string, string] => {
    const [before = '', ...rest] = DICTIONARIES[this.current()][key].split(`{${name}}`);
    return [before, rest.join(`{${name}}`)];
  };

  /**
   * The right form for a count: `foo_zero` when there is one and the count is
   * zero, otherwise whichever form the language's own rules pick — which is not
   * the same everywhere: French says "0 check", English "0 checks".
   */
  readonly plural = (base: PluralKey, count: number, params: Params = {}): string => {
    const language = this.current();
    const dictionary = DICTIONARIES[language] as Record<string, string>;
    const category = new Intl.PluralRules(language).select(count);
    const candidates = [
      ...(count === 0 ? [`${base}_zero`] : []),
      `${base}_${category}`,
      `${base}_other`,
    ];
    const key = candidates.find((candidate) => candidate in dictionary) ?? `${base}_other`;
    return interpolate(dictionary[key] ?? key, { count, ...params });
  };

  /** What assistive technology and the browser's own translation prompt read. */
  private reflect(language: Language): void {
    if (typeof document !== 'undefined') document.documentElement.lang = language;
  }
}
