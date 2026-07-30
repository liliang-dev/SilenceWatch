import { HttpErrorResponse } from '@angular/common/http';
import { errorMessage } from './error-message';

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
          { path: 'periodSeconds', message: 'Number must be greater than or equal to 30' },
          { path: 'name', message: 'String must contain at least 1 character(s)' },
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
      error: { message: 'Channel target rejected: resolves to a private address' },
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

  it('uses the caller\'s fallback for anything else', () => {
    expect(errorMessage(new Error('boom'), 'Could not save the check.')).toBe(
      'Could not save the check.',
    );
    expect(errorMessage(null)).toBe('Something went wrong.');
  });
});
