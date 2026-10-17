import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { I18n } from '../i18n/i18n.service';

/** "Sign in faster next time." Two buttons, and nothing to read twice. */
@Component({
  selector: 'sw-passkey-prompt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>{{ t('passkeyPrompt.title') }}</h2>
    <mat-dialog-content>
      <p class="body">{{ t('passkeyPrompt.body') }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="dialogRef.close(false)">
        {{ t('passkeyPrompt.later') }}
      </button>
      <button mat-flat-button type="button" cdkFocusInitial (click)="dialogRef.close(true)">
        {{ t('passkeyPrompt.add') }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .body { margin: 0; color: var(--sw-text-muted); line-height: 1.5; }
  `,
})
export class PasskeyPromptDialog {
  protected readonly dialogRef = inject<MatDialogRef<PasskeyPromptDialog, boolean>>(MatDialogRef);
  protected readonly t = inject(I18n).t;
}
