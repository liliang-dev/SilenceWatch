import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { I18n } from '../i18n/i18n.service';
import { readStored, writeStored } from '../storage';
import { AuthConfigService } from './auth-config.service';
import { AuthService } from './auth.service';
import { PasskeysService } from './passkeys.service';
import { PasskeyError, RECOVERED_KEY, SignInService } from './sign-in.service';

const OFFERED_KEY = 'silencewatch.passkeyOffered';

/**
 * Offers a passkey, once, to someone who signs in another way.
 *
 * It comes right after a first sign-in, when it costs a tap and the sign-in is
 * recent enough to add one. It is offered one time per account and browser, whatever
 * the answer: a question asked at every sign-in is not an offer any more. After a
 * recovery code it is asked again whatever came before, because the passkeys the
 * account lists are on a device that is gone.
 */
@Injectable({ providedIn: 'root' })
export class PasskeyPromptService {
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly configs = inject(AuthConfigService);
  private readonly auth = inject(AuthService);
  private readonly passkeys = inject(PasskeysService);
  private readonly signIn = inject(SignInService);
  private readonly t = inject(I18n).t;
  private asked = false;

  async maybeOffer(): Promise<void> {
    const user = this.auth.user();
    if (this.asked || user === null || !this.signIn.passkeysSupported) return;
    this.asked = true;

    try {
      const config = await this.configs.load();
      if (!config.passkey) return;
      const recovered = takeRecoveredFlag();
      if (!recovered) {
        if (readStored(`${OFFERED_KEY}.${user.id}`) !== null) return;
        if ((await this.passkeys.list()).length > 0) return;
      }

      writeStored(`${OFFERED_KEY}.${user.id}`, '1');
      const { PasskeyPromptDialog } = await import('./passkey-prompt.dialog');
      const answer = await new Promise<boolean>((resolve) =>
        this.dialog
          .open<unknown, unknown, boolean>(PasskeyPromptDialog, { autoFocus: false, maxWidth: '420px' })
          .afterClosed()
          .subscribe((accepted) => resolve(accepted === true)),
      );
      if (!answer) return;

      await this.passkeys.add();
      this.snackBar.open(this.t('settings.passkeyAdded'), this.t('common.ok'), { duration: 5000 });
    } catch (failure: unknown) {
      // Whatever went wrong, the page works without it, and Settings has the same button.
      if (!(failure instanceof PasskeyError && failure.reason === 'cancelled')) {
        this.snackBar.open(this.t('login.passkeyFailed'), this.t('common.ok'), { duration: 6000 });
      }
    }
  }
}

/** Reads and clears the mark a recovery-code sign-in leaves. */
function takeRecoveredFlag(): boolean {
  try {
    const recovered = sessionStorage.getItem(RECOVERED_KEY) !== null;
    sessionStorage.removeItem(RECOVERED_KEY);
    return recovered;
  } catch {
    return false;
  }
}
