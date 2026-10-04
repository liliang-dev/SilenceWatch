import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { errorMessage as translatedErrorMessage } from './error-message';
import type { I18n } from '../i18n/i18n.service';
import { loadI18n, provideI18n } from '../i18n/i18n.testing';

let i18n: I18n;
const errorMessage = (error: unknown, fallback = 'Something went wrong.'): string =>
  translatedErrorMessage(error, fallback, i18n.t);

beforeEach(async () => {
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [provideI18n()] });
  i18n = await loadI18n('en');
});

afterEach(() => localStorage.clear());

describe('errorMessage', () => {
  it('surfaces the validation details the server sends', () => {
    // These are the useful part of a 400 — replacing them with "something went
    // wrong" would leave the user guessing which field is wrong.
    const error = new HttpErrorResponse({
      status: 400,
      error: {
        statusCode: 400,
        error: 'BAD_REQUEST',
        message: 'Validation failed',
        details: [
          {
            path: 'periodSeconds',
            message: 'Number must be greater than or equal to 30',
          },
          {
            path: 'name',
            message: 'String must contain at least 1 character(s)',
          },
        ],
      },
    });

    expect(errorMessage(error)).toBe(
      'periodSeconds: Number must be greater than or equal to 30, ' +
        'name: String must contain at least 1 character(s)',
    );
  });

  it('falls back to the server message when there are no details', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: {
        message: 'Channel target rejected: resolves to a private address',
      },
    });
    expect(errorMessage(error)).toContain('private address');
  });

  it('explains a connection failure in terms a user can act on', () => {
    expect(errorMessage(new HttpErrorResponse({ status: 0 }))).toContain('Cannot reach the server');
  });

  it('has a sentence for rate limiting and for server failures', () => {
    expect(errorMessage(new HttpErrorResponse({ status: 429 }))).toContain('Too many attempts');
    expect(errorMessage(new HttpErrorResponse({ status: 503 }))).toContain('having trouble');
  });

  it('says "slow" rather than "down" when the server took too long', () => {
    // The page's own timeout arrives as a 504 with no body.
    const message = errorMessage(new HttpErrorResponse({ status: 504, statusText: 'Timeout' }));
    expect(message).toContain('taking too long');
    expect(message).not.toContain('Cannot reach');
  });

  it("translates the server's own sentences it recognises, and passes the rest through", async () => {
    await i18n.set('fr');
    const wrongPassword = new HttpErrorResponse({
      status: 401,
      error: { message: 'Invalid email or password' },
    });
    expect(errorMessage(wrongPassword)).toBe('E-mail ou mot de passe incorrect');

    // A reason after a fixed beginning keeps the reason exactly as sent.
    const delivery = new HttpErrorResponse({
      status: 400,
      error: { message: 'Test delivery failed: connect ECONNREFUSED 10.0.0.1:443' },
    });
    expect(errorMessage(delivery)).toBe(
      "Échec de l'envoi du test\u00a0: connect ECONNREFUSED 10.0.0.1:443",
    );

    // A sentence this build has never heard of is shown as it arrived.
    const unknown = new HttpErrorResponse({ status: 400, error: { message: 'Something new' } });
    expect(errorMessage(unknown)).toBe('Something new');

    // And in English the sentence is the server's own.
    await i18n.set('en');
    expect(errorMessage(wrongPassword)).toBe('Invalid email or password');
  });

  it('uses the caller\'s fallback for anything else', () => {
    expect(errorMessage(new Error('boom'), 'Could not save the check.')).toBe(
      'Could not save the check.',
    );
    expect(errorMessage(null)).toBe('Something went wrong.');
  });
});
