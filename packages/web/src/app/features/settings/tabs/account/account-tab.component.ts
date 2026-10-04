import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';
import { I18n } from '../../../../core/i18n/i18n.service';
import { ProjectStore } from '../../../../core/project.store';
import { DeleteAccountDialog, type DeleteAccountData } from '../../dialogs/delete-account.dialog';

/** Who is signed in, and the one thing that cannot be undone. */
@Component({
  selector: 'sw-account-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
  templateUrl: './account-tab.component.html',
  styleUrls: ['../../section.scss', './account-tab.component.scss'],
})
export class AccountTabComponent {
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly projects = inject(ProjectStore);
  protected readonly t = inject(I18n).t;

  /**
   * Opens the confirmation. The dialog makes the request itself, so it closes
   * with `true` only once the account is gone, and this just says so and leaves.
   */
  protected deleteAccount(): void {
    const projects = this.projects.all();
    const data: DeleteAccountData = {
      projects: projects.length,
      checks: projects.reduce((total, project) => total + (project.checkCount ?? 0), 0),
    };

    this.dialog
      .open(DeleteAccountDialog, { data, autoFocus: false, panelClass: 'sw-confirm' })
      .afterClosed()
      .subscribe((deleted) => {
        if (deleted !== true) return;
        this.snackBar.open(this.t('deleteAccount.done'), this.t('common.ok'), { duration: 6000 });
        void this.router.navigate(['/login']);
      });
  }
}
