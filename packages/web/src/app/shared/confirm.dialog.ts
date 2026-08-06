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
  templateUrl: './confirm.dialog.html',
  styleUrl: './confirm.dialog.scss',
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
  protected readonly dialogRef = inject<MatDialogRef<ConfirmDialog, boolean>>(MatDialogRef);
}
