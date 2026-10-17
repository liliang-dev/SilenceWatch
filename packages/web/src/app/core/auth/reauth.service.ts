import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

/**
 * Asks the person to sign in again, for what wants a recent sign-in.
 *
 * One dialog at a time: a page that fires several requests which are all refused
 * for the same reason must ask once and let them all through.
 */
@Injectable({ providedIn: 'root' })
export class ReauthService {
  private readonly dialog = inject(MatDialog);
  private pending: Promise<boolean> | null = null;

  confirm(): Promise<boolean> {
    this.pending ??= import('./reauth.dialog')
      .then(({ ReauthDialog }) =>
        new Promise<boolean>((resolve) => {
          this.dialog
            .open<unknown, unknown, boolean>(ReauthDialog, { autoFocus: false, maxWidth: '420px' })
            .afterClosed()
            .subscribe((confirmed) => resolve(confirmed === true));
        }),
      )
      .finally(() => (this.pending = null));
    return this.pending;
  }
}
