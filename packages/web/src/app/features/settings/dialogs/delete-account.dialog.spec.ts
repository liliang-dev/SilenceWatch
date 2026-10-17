import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { loadI18n, provideI18n } from '../../../core/i18n/i18n.testing';
import { DeleteAccountDialog } from './delete-account.dialog';

/**
 * What stands between a click and an account being destroyed: a word typed out.
 * The dialog must not even try until it is there, and must stay open, saying why,
 * when the server refuses.
 */
describe('DeleteAccountDialog', () => {
  let closed: unknown[];

  async function create(language: 'en' | 'fr' = 'en') {
    closed = [];
    TestBed.configureTestingModule({
      providers: [
        provideI18n(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: { projects: 2, checks: 5 } },
        {
          provide: MatDialogRef,
          useValue: { close: (value: unknown) => closed.push(value), disableClose: false },
        },
      ],
    });
    await loadI18n(language);
    const dialog = TestBed.createComponent(DeleteAccountDialog).componentInstance as unknown as {
      form: DeleteAccountDialog['form'];
      canSubmit: boolean;
      confirmed: boolean;
      word: string;
      error: () => string | null;
      submit(): void;
    };
    return dialog;
  }

  afterEach(() => localStorage.clear());

  it('asks for the word in the language of the page', async () => {
    expect((await create('en')).word).toBe('DELETE');
    TestBed.resetTestingModule();
    expect((await create('fr')).word).toBe('SUPPRIMER');
  });

  it('is not submittable until the word has been typed', async () => {
    const dialog = await create();

    expect(dialog.canSubmit).toBe(false);

    dialog.form.patchValue({ confirmation: 'delet' });
    expect(dialog.canSubmit).toBe(false);

    dialog.form.patchValue({ confirmation: 'delete' });
    expect(dialog.canSubmit).toBe(true);

    dialog.form.patchValue({ confirmation: ' DELETE ' });
    expect(dialog.canSubmit).toBe(true);
  });

  it('sends nothing while it is not confirmed', async () => {
    const dialog = await create();
    const http = TestBed.inject(HttpTestingController);

    dialog.form.patchValue({ confirmation: 'nope' });
    dialog.submit();

    http.expectNone('/api/auth/delete-account');
  });

  it('posts the deletion, and closes with true once the account is gone', async () => {
    const dialog = await create();
    const http = TestBed.inject(HttpTestingController);

    dialog.form.patchValue({ confirmation: 'DELETE' });
    dialog.submit();

    const request = http.expectOne('/api/auth/delete-account');
    expect(request.request.method).toBe('POST');
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(closed).toEqual([true]);
  });

  it('stays open and says so when the server refuses', async () => {
    const dialog = await create();
    const http = TestBed.inject(HttpTestingController);

    dialog.form.patchValue({ confirmation: 'DELETE' });
    dialog.submit();
    http
      .expectOne('/api/auth/delete-account')
      .flush(
        {
          statusCode: 409,
          error: 'CONFLICT',
          message: 'You are the only owner of "Production", so deleting your account would leave it without one.',
        },
        { status: 409, statusText: 'Conflict' },
      );

    expect(closed).toEqual([]);
    expect(dialog.error()).toContain('only owner');
    // And it can be tried again.
    expect(dialog.canSubmit).toBe(true);
  });
});
