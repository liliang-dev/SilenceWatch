import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { LIMITS, type AuthConfigDto, type UserDto } from '@silencewatch/shared';
import { AuthConfigService } from '../../../core/auth/auth-config.service';
import { PasskeysService } from '../../../core/auth/passkeys.service';
import { PasskeyError, SignInService, type Provider } from '../../../core/auth/sign-in.service';
import { errorMessage } from '../../../core/http/error-message';
import { I18n } from '../../../core/i18n/i18n.service';
import { ProjectStore } from '../../../core/project.store';
import { RecoveryCodesComponent } from '../../../shared/recovery-codes.component';

/**
 * The one way in.
 *
 * What the page offers is what the instance has (`AUTH_MODE`): a passkey, a
 * password, or Google and Microsoft beside a passkey. The same page is the first
 * visit by a setup link (`/setup`), where the address is fixed by the link and the
 * only thing left is to create the account.
 *
 * Signing in never says why it failed: a wrong password, an unknown address, a
 * locked account and a refused passkey all read the same. Creating an account may
 * be specific, because there the person needs to know what to change.
 */
@Component({
  selector: 'sw-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressBarModule,
    RecoveryCodesComponent,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit {
  private readonly signIn = inject(SignInService);
  private readonly passkeys = inject(PasskeysService);
  private readonly configs = inject(AuthConfigService);
  private readonly projects = inject(ProjectStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly formBuilder = inject(FormBuilder);
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  protected readonly minLength = LIMITS.passwordMin;

  /** Null while the instance is being asked how it lets people in. */
  protected readonly config = signal<AuthConfigDto | null>(null);
  protected readonly view = signal<'signin' | 'signup' | 'recovery' | 'codes'>('signin');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly codes = signal<string[]>([]);
  protected readonly codesSaved = signal(false);

  /** True on /setup: the address is the link's, and the account is the only thing to make. */
  protected readonly setup = signal(false);
  protected readonly setupBroken = signal(false);

  protected readonly canSignUp = computed(() => this.setup() || (this.config()?.signup ?? false));

  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(LIMITS.passwordMin)]],
    code: [''],
  });

  ngOnInit(): void {
    this.configs
      .load()
      .then((config) => {
        this.config.set(config);
        if (this.route.snapshot.queryParamMap.get('failed') === '1') {
          this.error.set(this.t('login.providerRefused'));
        }
        if (this.route.snapshot.data['setup'] === true) this.startSetup();
      })
      .catch(() => this.error.set(this.t('error.offline')));
  }

  /** Takes the token out of the link's fragment and keeps it for the sign-up. */
  private startSetup(): void {
    const token = window.location.hash.slice(1);
    const email = this.route.snapshot.queryParamMap.get('email') ?? '';
    // Out of the address bar and the history at once: it is a secret, and whoever
    // looks over the shoulder or at the history should not get it.
    window.history.replaceState(null, '', `${window.location.pathname}?email=${encodeURIComponent(email)}`);

    if (token === '' || email === '') {
      this.setupBroken.set(true);
      return;
    }
    this.setup.set(true);
    this.signIn.rememberSetupToken(token);
    this.form.patchValue({ email });
    this.form.controls.email.disable();
    this.view.set('signup');
  }

  protected show(view: 'signin' | 'signup' | 'recovery'): void {
    this.view.set(view);
    this.error.set(null);
  }

  protected submit(): void {
    const view = this.view();
    const config = this.config();
    if (config === null || this.busy() || view === 'codes') return;

    if (view === 'recovery') return void this.run(() => this.recover(), 'signin');

    if (config.password) {
      if (!this.passwordFormValid()) return;
      const { password } = this.form.getRawValue();
      const email = this.email();
      return void this.run(
        () =>
          view === 'signup'
            ? this.signIn.signUpWithPassword(email, password)
            : this.signIn.withPassword(email, password),
        view,
      );
    }

    // Passkeys only: creating an account is the one thing that needs an address.
    if (view === 'signup') {
      if (this.form.controls.email.invalid) {
        this.form.controls.email.markAsTouched();
        return;
      }
      return void this.run(() => this.createWithPasskey(), 'signup');
    }
    void this.run(() => this.signIn.withPasskey(), 'signin');
  }

  protected usePasskey(): void {
    if (this.busy()) return;
    void this.run(() => this.signIn.withPasskey(), 'signin');
  }

  protected useProvider(provider: Provider): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.signIn.withProvider(provider, this.nextUrl()).catch(() => {
      this.busy.set(false);
      this.error.set(this.t('login.failed'));
    });
  }

  /** Continues from the screen that shows the recovery codes. */
  protected continueToApp(): void {
    void this.enter();
  }

  private email(): string {
    return this.form.getRawValue().email.trim().toLowerCase();
  }

  private passwordFormValid(): boolean {
    const emailOk = this.form.controls.email.disabled || this.form.controls.email.valid;
    if (emailOk && this.form.controls.password.valid) return true;
    this.form.markAllAsTouched();
    return false;
  }

  private async createWithPasskey(): Promise<UserDto> {
    const user = await this.signIn.signUpWithPasskey(this.email());
    // The account has this one credential and nothing else to get back in with:
    // its recovery codes are made now, while the sign-in is as fresh as it gets.
    if (this.config()?.recoveryCodes === true) {
      this.codes.set(await this.passkeys.newRecoveryCodes());
      this.view.set('codes');
    }
    return user;
  }

  private async recover(): Promise<UserDto> {
    const { code } = this.form.getRawValue();
    return this.signIn.withRecoveryCode(this.email(), code);
  }

  private async run(attempt: () => Promise<UserDto>, doing: 'signin' | 'signup'): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await attempt();
      if (this.setup()) this.signIn.forgetSetupToken();
      // The recovery codes are shown first, and the person leaves when they say so.
      if (this.view() !== 'codes') await this.enter();
    } catch (failure: unknown) {
      this.error.set(this.failureMessage(failure, doing));
    } finally {
      this.busy.set(false);
    }
  }

  private async enter(): Promise<void> {
    // A fresh session means a fresh project list.
    this.projects.clear();
    this.projects.load(true);
    await this.router.navigateByUrl(this.nextUrl());
  }

  private failureMessage(failure: unknown, doing: 'signin' | 'signup'): string {
    if (failure instanceof PasskeyError) {
      if (failure.reason === 'unsupported') return this.t('login.passkeyUnsupported');
      return this.t(failure.reason === 'cancelled' ? 'login.passkeyCancelled' : 'login.passkeyFailed');
    }
    if (failure instanceof HttpErrorResponse && failure.status === 429) {
      return this.t('error.tooManyAttempts');
    }
    // Signing in says one thing about every refusal. Creating an account may say
    // what is wrong with it.
    if (doing === 'signup' && failure instanceof HttpErrorResponse && failure.status !== 0) {
      return errorMessage(failure, this.t('login.signUpFailed'), this.t);
    }
    return failure instanceof HttpErrorResponse && failure.status === 0
      ? this.t('error.offline')
      : this.t('login.failed');
  }

  private nextUrl(): string {
    const next = this.route.snapshot.queryParamMap.get('next');
    // Only same-site paths: a "next" pointing elsewhere would be an open redirect.
    return next !== null && next.startsWith('/') && !next.startsWith('//') ? next : '/checks';
  }
}
