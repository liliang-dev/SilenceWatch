import { Injectable } from '@angular/core';
import type { Translation, TranslocoLoader } from '@jsverse/transloco';

/**
 * One import per language, written out rather than built from a variable: the
 * bundler turns each into its own hashed file and fetches it only when that
 * language is the one in use. A French reader never downloads the English file,
 * and a new release cannot be served a stale translation from an unhashed asset.
 */
const FILES: Record<string, () => Promise<{ default: Translation }>> = {
  en: () => import('./en.json'),
  fr: () => import('./fr.json'),
};

@Injectable({ providedIn: 'root' })
export class JsonLoader implements TranslocoLoader {
  async getTranslation(language: string): Promise<Translation> {
    const load = FILES[language];
    if (load === undefined) throw new Error(`No translation file for "${language}"`);
    return (await load()).default;
  }
}
