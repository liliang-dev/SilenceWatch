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
  /**
   * A private person acting outside any professional activity may stay anonymous
   * (LCEN, art. 6-III-2), provided they have given their identity to the host.
   * Then only the contact address and the host are published, and `name`, `form`,
   * `address` and `director` are not shown. Set to false, and fill those in, the
   * day the service is run as a business: a business must be identified.
   */
  anonymous: false,
  /** Name of the person, or the company's registered name. */
  name: 'Lilian Garrido',
  /** Legal form: "Entrepreneur individuel", "SAS"… */
  form: 'Entrepreneur individuel',
  /** Postal address of the publisher. */
  address: '2 allée du Niger, 31000 Toulouse, France',
  /** A contact address that is read: it is also where privacy requests arrive. */
  email: 'contact@silencewatch.com',
  /** Optional. */
  phone: '',
  /** Optional: "SIRET 123 456 789 00012 — RCS Paris B 123 456 789". */
  registration: 'SIRET 878 736 578 00021',
  /** Optional: share capital of a company. */
  capital: '',
  /** Optional: intra-community VAT number. */
  vat: '',
  /**
   * Optional: the VAT mention of a business that does not charge it. A micro-business
   * under the VAT exemption (franchise en base) must say so on its invoices, and
   * saying so on the legal notice and the sales terms keeps them consistent.
   * Empty once VAT is charged.
   */
  vatExemption: true,
  /** The publication director: a natural person, often the publisher. */
  director: 'Lilian Garrido',
};

/** The host, which the law also requires the site to name. */
export const HOST = {
  name: 'OVH SAS',
  address: '2 rue Kellermann, 59100 Roubaix, France',
  phone: '+33 9 72 10 10 07',
  url: 'https://www.ovhcloud.com',
};

/** The date the legal pages were last revised. */
export const LEGAL_UPDATED = { fr: '21 octobre 2026', en: '21 October 2026' };
