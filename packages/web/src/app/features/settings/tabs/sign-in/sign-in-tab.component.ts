import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LIMITS, type AuthConfigDto } from '@silencewatch/shared';
import { AuthConfigService } from '../../../../core/auth/auth-config.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { PasskeyError } from '../../../../core/auth/sign-in.service';
import { PasskeysService, type PasskeyDto } from '../../../../core/auth/passkeys.service';
import { errorMessage } from '../../../../core/http/error-message';
import { I18n } from '../../../../core/i18n/i18n.service';
import { confirmWith } from '../../../../shared/confirm.dialog';
import { RecoveryCodesComponent } from '../../../../shared/recovery-codes.component';
import { RelativeTimePipe } from '../../../../shared/relative-time.pipe';
import { SettingsFeedback } from '../../settings-feedback';

/**
 * How this account signs in: its passkeys and recovery codes, or its password,
 * according to what the instance offers. The rest — the people who sign in with
 * Google or Microsoft — has nothing to manage here.
 */
@Component({
  selector: 'sw-sign-in-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    RecoveryCodesComponent,
    RelativeTimePipe,
  ],
  templateUrl: './sign-in-tab.component.html',
  styleUrls: ['../../section.scss', './sign-in-tab.component.scss'],
})
export class SignInTabComponent implements OnInit {
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly feedback = inject(SettingsFeedback);
  private readonly auth = inject(AuthService);
  private readonly configs = inject(AuthConfigService);
  private readonly passkeyApi = inject(PasskeysService);
  protected readonly t = inject(I18n).t;

  protected readonly minLength = LIMITS.passwordMin;
  protected readonly config = signal<AuthConfigDto | null>(null);
  protected readonly passkeys = signal<PasskeyDto[]>([]);
  protected readonly codesLeft = signal<number | null>(null);
  protected readonly newCodes = signal<string[]>([]);
  protected readonly busy = signal(false);

  protected readonly passwordForm = inject(FormBuilder).nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(LIMITS.passwordMin)]],
  });

  ngOnInit(): void {
    this.configs
      .load()
      .then(async (config) => {
        this.config.set(config);
        if (config.passkey) await this.refreshPasskeys();
        if (config.recoveryCodes) this.codesLeft.set(await this.passkeyApi.recoveryCodesLeft());
      })
      .catch((failure: unknown) =>
        this.feedback.show(errorMessage(failure, this.t('settings.signInLoadFailed'), this.t)),
      );
  }

  protected async addPasskey(): Promise<void> {
    await this.guarded(async () => {
      await this.passkeyApi.add();
      await this.refreshPasskeys();
      this.snackBar.open(this.t('settings.passkeyAdded'), this.t('common.ok'), { duration: 5000 });
    });
  }

  protected removePasskey(passkey: PasskeyDto): void {
    confirmWith(this.dialog, {
      title: this.t('settings.passkeyRemoveTitle'),
      message: this.t('settings.passkeyRemoveBody'),
      confirmLabel: this.t('settings.passkeyRemove'),
      destructive: true,
    }).subscribe(() => {
      void this.guarded(async () => {
        await this.passkeyApi.remove(passkey.id);
        await this.refreshPasskeys();
      });
    });
  }

  /** Replaces the old set; the new one is shown here and nowhere else. */
  protected async newRecoveryCodes(): Promise<void> {
    await this.guarded(async () => {
      this.newCodes.set(await this.passkeyApi.newRecoveryCodes());
      this.codesLeft.set(this.newCodes().length);
    });
  }

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
        this.passwordForm.reset();
        this.snackBar.open(this.t('settings.passwordChanged'), this.t('common.ok'), {
          duration: 5000,
        });
      },
      error: (failure: unknown) => {
        this.busy.set(false);
        this.feedback.show(errorMessage(failure, this.t('settings.passwordChangeFailed'), this.t));
      },
    });
  }

  /** The last passkey of an account whose only way in is a passkey is not one to remove. */
  protected canRemove(): boolean {
    return this.config()?.mode !== 'passkey' || this.passkeys().length > 1;
  }

  protected label(passkey: PasskeyDto): string {
    return passkey.name?.trim() || this.t('settings.passkeyUnnamed');
  }

  private async refreshPasskeys(): Promise<void> {
    this.passkeys.set(await this.passkeyApi.list());
  }

  private async guarded(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.feedback.clear();
    try {
      await action();
    } catch (failure: unknown) {
      // Closing the browser's prompt is a decision, not a fault.
      if (!(failure instanceof PasskeyError && failure.reason === 'cancelled')) {
        this.feedback.show(
          failure instanceof PasskeyError
            ? this.t('login.passkeyFailed')
            : errorMessage(failure, this.t('settings.signInFailed'), this.t),
        );
      }
    } finally {
      this.busy.set(false);
    }
  }
}
