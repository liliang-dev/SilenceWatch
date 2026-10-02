import { Injectable, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { readStored, writeStored } from '../storage';
import type { MessageKey, PluralKey } from './messages';

export type Language = 'en' | 'fr';

export const LANGUAGES: readonly Language[] = ['en', 'fr'];

/** Read by `public/theme-init.js` too, so the page is in the right language before the app starts. */
export const LANGUAGE_STORAGE_KEY = 'silencewatch.language';

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

/** Stands in for a value while a message is cut open around it; never shown. */
const MARKER = '\u0000';

/**
 * The language of the interface, and the one function templates call to turn a
 * key into text in it.
 *
 * Transloco loads the language files, holds the active language and fills in the
 * placeholders. This sits on top of it for what it does not do on its own: keys
 * are typed (`MessageKey`, from `en.json`), plurals follow each language's rules,
 * and the current language is a signal, so a template that calls `t` is re-rendered when it changes — there is
 * nothing to subscribe to, and the zoneless application needs nothing else.
 *
 * `t` is an arrow property so a component can keep `protected readonly t =
 * inject(I18n).t` and call it bare in a template.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly transloco = inject(TranslocoService);

  private readonly current = signal<Language>(initialLanguage());

  readonly language = this.current.asReadonly();

  /**
   * Fetches the language in use. Run before the application renders, so the
   * first frame is already in it instead of showing keys.
   */
  async load(): Promise<void> {
    const language = this.current();
    await firstValueFrom(this.transloco.load(language));
    this.transloco.setActiveLang(language);
    this.reflect(language);
  }

  /**
   * Switches language: fetches its file first, then changes everything at once,
   * so the page never shows a half-translated moment.
   */
  async set(language: Language): Promise<void> {
    if (language === this.current()) return;
    await firstValueFrom(this.transloco.load(language));
    this.transloco.setActiveLang(language);
    this.current.set(language);
    writeStored(LANGUAGE_STORAGE_KEY, language);
    this.reflect(language);
  }

  readonly t: Translate = (key, params) => {
    // Read for the dependency: this is what makes a template follow the language.
    this.current();
    return this.transloco.translate(key, params);
  };

  /**
   * The right form for a count: `foo_zero` when there is one and the count is
   * zero, otherwise whichever form the language's own rules pick — which is not
   * the same everywhere: French says "0 check", English "0 checks".
   *
   * `count` is filled in for the message; pass `count` in `params` to count by
   * one number and show another.
   */
  readonly plural = (base: PluralKey, count: number, params: Params = {}): string => {
    const language = this.current();
    const category = new Intl.PluralRules(language).select(count);
    const zero = `${base}_zero` as MessageKey;
    const known = this.transloco.getTranslation(language);
    const form =
      count === 0 && zero in known
        ? zero
        : (`${base}_${category}` as MessageKey) in known
          ? (`${base}_${category}` as MessageKey)
          : (`${base}_other` as MessageKey);
    return this.transloco.translate(form, { count, ...params });
  };

  /**
   * A message cut open at one placeholder: what comes before `{name}` and what
   * comes after it. For the few sentences that wrap a value in markup — an
   * address in bold, a slug in monospace — where the order of the words is the
   * translator's to decide and the template's to dress.
   */
  readonly around = (key: MessageKey, name: string): [string, string] => {
    const text = this.t(key, { [name]: MARKER });
    const at = text.indexOf(MARKER);
    return at === -1 ? [text, ''] : [text.slice(0, at), text.slice(at + MARKER.length)];
  };

  /** What assistive technology and the browser's own translation prompt read. */
  private reflect(language: Language): void {
    if (typeof document !== 'undefined') document.documentElement.lang = language;
  }
}
