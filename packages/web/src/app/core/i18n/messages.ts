/**
 * The keys of the interface, taken from `en.json`.
 *
 * The English file is the source: a key exists because it is there. Deriving the
 * type from it means `t('checks.titel')` does not compile, in a template as in a
 * component, even though the text itself is loaded as JSON at run time.
 */
import type en from './en.json';

export type MessageKey = keyof typeof en;

/** The base of every plural: `foo` for the pair `foo_one` / `foo_other`. */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}_other` ? Base : never;
}[MessageKey];
