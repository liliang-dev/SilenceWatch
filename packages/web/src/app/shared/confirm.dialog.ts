import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { filter, type Observable } from 'rxjs';

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
 * Asks before something irreversible, and emits only if the answer is yes.
 *
 * The whole application confirms through this one function. `window.confirm`
 * was shorter, and four screens used it, which is exactly the problem: it
 * cannot be styled, it says "localhost:4200 says", it blocks the event loop,
 * and the message it shows is a single unformatted string. It also cannot be
 * tested without stubbing a global.
 */
export function confirmWith(dialog: MatDialog, data: ConfirmData): Observable<true> {
  return dialog
    .open(ConfirmDialog, { data, autoFocus: false })
    .afterClosed()
    .pipe(filter((confirmed): confirmed is true => confirmed === true));
}

/**
 * A confirmation that names what is being destroyed.
 *
 * The counts belong in `message`: for anything irreversible, "17 checks and
 * their history" is the whole point of asking, and "are you sure?" is not.
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
