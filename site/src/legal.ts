/**
 * Who is behind the hosted service, for the legal pages.
 *
 * This is the one place to fill in. French law (LCEN, art. 6-III) requires the
 * publisher of a website to be identifiable, and the pages that say so read from
 * here, so the identity cannot differ from one page or one language to the next.
 *
 * Anything still set to PENDING stops the publication: `scripts/check-legal.mjs`
 * scans the built pages for it, and the workflow that ships the site runs that
 * check, so a placeholder can never reach silencewatch.com. Fields that do not
 * apply (no SIRET for a private person, no VAT number below the threshold) are
 * left as empty strings and are then not shown.
 */
export const PENDING = '[À COMPLÉTER]';

export const LEGAL = {
  /** Name of the person, or the company's registered name. */
  name: PENDING,
  /** Legal form: "Entrepreneur individuel", "SAS", "Particulier"… */
  form: PENDING,
  /** Postal address. For a private person this may be the host's, see the legal page. */
  address: PENDING,
  /** A contact address that is read: it is also where privacy requests arrive. */
  email: PENDING,
  /** Optional. */
  phone: '',
  /** Optional: "SIRET 123 456 789 00012 — RCS Paris B 123 456 789". */
  registration: '',
  /** Optional: share capital of a company. */
  capital: '',
  /** Optional: intra-community VAT number. */
  vat: '',
  /** The publication director: a natural person, often the publisher. */
  director: PENDING,
};

/** The host, which the law also requires the site to name. */
export const HOST = {
  name: 'OVH SAS',
  address: '2 rue Kellermann, 59100 Roubaix, France',
  phone: '+33 9 72 10 10 07',
  url: 'https://www.ovhcloud.com',
};

/** The date the legal pages were last revised. */
export const LEGAL_UPDATED = { fr: '3 octobre 2026', en: '3 October 2026' };
