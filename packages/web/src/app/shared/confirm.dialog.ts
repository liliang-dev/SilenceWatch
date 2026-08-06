import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface ConfirmData {
  title: string;
  /** What is about to happen, in the user's terms. */
  message: string;
  /** The verb, on the button. "Delete", not "OK" — the button should read like the action. */
  confirmLabel: string;
  /** Paints the confirm button as destructive. */
  destructive?: boolean;
}

/**
 * A confirmation that names what is being destroyed.
 *
 * `window.confirm` would be shorter, and it is what the channels page still
 * uses, but it cannot say "17 checks and their history" — and for anything
 * irreversible the number is the whole point of asking.
 */
@Component({
  selector: 'sw-confirm',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title class="title">{{ data.title }}</h2>
    <mat-dialog-content>
      <p class="message">{{ data.message }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="actions">
      <button mat-button type="button" (click)="dialogRef.close(false)">Cancel</button>
      <button
        mat-flat-button
        type="button"
        [class.destructive]="data.destructive"
        (click)="dialogRef.close(true)"
      >
        {{ data.confirmLabel }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .title {
      padding-bottom: 4px !important;
      font-size: 1.0625rem !important;
      font-weight: 600 !important;
    }

    .message {
      margin: 0;
      max-width: 42ch;
      line-height: 1.55;
      color: var(--sw-text-muted);
    }

    .actions {
      padding: 14px 24px 18px !important;
      gap: 8px;
    }

    /* Material 3 paints a filled button from the theme's primary, not from a
       button-specific token — so the colour is swapped at the source. */
    .destructive {
      --mat-sys-primary: var(--sw-down);
      --mat-sys-on-primary: #fff;
    }
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
  protected readonly dialogRef = inject<MatDialogRef<ConfirmDialog, boolean>>(MatDialogRef);
}
