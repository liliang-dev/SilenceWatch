import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LIMITS } from '@silencewatch/shared';
import { AuthService } from '../../../../core/auth/auth.service';
import { errorMessage } from '../../../../core/http/error-message';
import { I18n } from '../../../../core/i18n/i18n.service';
import { SettingsFeedback } from '../../settings-feedback';

/** Changing the password. It signs the user out everywhere, this browser included. */
@Component({
  selector: 'sw-password-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule],
  templateUrl: './password-tab.component.html',
  styleUrls: ['../../section.scss', './password-tab.component.scss'],
})
export class PasswordTabComponent {
  private readonly snackBar = inject(MatSnackBar);
  private readonly feedback = inject(SettingsFeedback);
  private readonly auth = inject(AuthService);
  protected readonly t = inject(I18n).t;

  protected readonly minLength = LIMITS.passwordMin;
  protected readonly busy = signal(false);

  protected readonly passwordForm = inject(FormBuilder).nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(LIMITS.passwordMin)]],
  });

  protected changePassword(): void {
    if (this.passwordForm.invalid || this.busy()) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    this.feedback.clear();

    this.auth.changePassword(this.passwordForm.getRawValue()).subscribe({
      next: () => {
        this.busy.set(false);
        this.snackBar.open(this.t('settings.passwordChanged'), this.t('common.ok'), {
          duration: 5000,
        });
        this.auth.logout();
      },
      error: (failure: unknown) => {
        this.busy.set(false);
        this.feedback.show(errorMessage(failure, this.t('settings.passwordChangeFailed'), this.t));
      },
    });
  }
}
