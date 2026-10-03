import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { LIMITS } from '@silencewatch/shared';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/error-message';
import { I18n } from '../../core/i18n/i18n.service';

export interface DeleteAccountData {
  projects: number;
  checks: number;
}

/**
 * The last question before an account is destroyed.
 *
 * It says plainly that the loss is immediate and has no way back, says what is
 * lost in numbers, and then asks for two things a stray click cannot supply: a
 * word typed out, and the password. The word is the guard against a mistake; the
 * password is what the server insists on, because a signed-in browser left open
 * is not proof that its owner means it.
 *
 * The request is made from inside the dialog so that a wrong password is
 * answered where it was typed, with the dialog still open, rather than after
 * it has closed on an error nobody can act on.
 */
@Component({
  selector: 'sw-delete-account',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './delete-account.dialog.html',
  styleUrl: './delete-account.dialog.scss',
})
export class DeleteAccountDialog {
  protected readonly data = inject<DeleteAccountData>(MAT_DIALOG_DATA);
  protected readonly dialogRef = inject<MatDialogRef<DeleteAccountDialog, boolean>>(MatDialogRef);

  private readonly auth = inject(AuthService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly plural = this.i18n.plural;

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** The word to type, in the language of the page. */
  protected readonly word = this.t('deleteAccount.word');

  protected readonly form = this.formBuilder.nonNullable.group({
    confirmation: ['', [Validators.required]],
    password: ['', [Validators.required, Validators.maxLength(LIMITS.passwordMax)]],
  });

  /**
   * Typed right, regardless of case or stray spaces: the point is that it was
   * written out on purpose, not that a capital letter was found.
   */
  protected get confirmed(): boolean {
    const typed = this.form.controls.confirmation.value.trim().toLocaleUpperCase();
    return typed === this.word.toLocaleUpperCase();
  }

  protected get canSubmit(): boolean {
    return this.confirmed && this.form.valid && !this.busy();
  }

  protected submit(): void {
    if (!this.canSubmit) {
      this.form.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.dialogRef.disableClose = true;

    this.auth.deleteAccount(this.form.controls.password.value).subscribe({
      next: () => this.dialogRef.close(true),
      error: (failure: unknown) => {
        this.busy.set(false);
        this.dialogRef.disableClose = false;
        this.error.set(errorMessage(failure, this.t('deleteAccount.failed'), this.t));
      },
    });
  }
}
