import { TestBed } from '@angular/core/testing';
import { provideI18n } from './i18n.providers';
import { I18n, LANGUAGE_STORAGE_KEY, type Language } from './i18n.service';

/** What a spec adds to its TestBed to get the application's real messages. */
export { provideI18n };

/**
 * An I18n that has loaded `language`, ready to translate synchronously.
 *
 * The language is stored before the service is created, because that is how the
 * service learns it — the same way it does in a browser — and the file is
 * loaded before the spec runs, because translating is synchronous and an
 * unloaded language answers with its keys.
 */
export async function loadI18n(language: Language = 'en'): Promise<I18n> {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  const i18n = TestBed.inject(I18n);
  await i18n.load();
  return i18n;
}
