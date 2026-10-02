import { isDevMode } from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';
import { LANGUAGES } from './i18n.service';
import { JsonLoader } from './json.loader';

/**
 * Transloco, configured: the two languages and their files.
 *
 * Placeholders are written `{name}`, not Transloco's default `{{ name }}`: one
 * brace is what the messages have always used, and nothing else in them is a
 * brace.
 *
 * The ICU MessageFormat plugin is not used, on purpose. It compiles every
 * message into a function with `new Function`, which the served
 * Content-Security-Policy (`script-src 'self'`, no `unsafe-eval`) refuses — the
 * application would not render a single sentence. Weakening the policy of a
 * security-minded product to get plural syntax is the wrong trade, so plurals are
 * separate keys (`foo_one`, `foo_other`) chosen by `I18n.plural`.
 *
 * Shared by the application and by the specs, so a test sees the same messages a
 * person does.
 */
export function provideI18n() {
  return provideTransloco({
    config: {
      availableLangs: [...LANGUAGES],
      defaultLang: 'en',
      prodMode: !isDevMode(),
      interpolation: ['{', '}'],
      missingHandler: { logMissingKey: false },
    },
    loader: JsonLoader,
  });
}
