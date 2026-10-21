import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { I18n } from '../core/i18n/i18n.service';

/**
 * A set of recovery codes, shown the one time they can be read.
 *
 * Copy and download are offered because the point is to get them out of this page
 * and somewhere safe; a code only on a screen that is about to be closed is no
 * recovery at all.
 */
@Component({
  selector: 'sw-recovery-codes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
  template: `
    <ul class="codes" aria-label="{{ t('recovery.codesLabel') }}">
      @for (code of codes(); track code) {
        <li>{{ code }}</li>
      }
    </ul>
    <div class="actions">
      <button mat-stroked-button type="button" (click)="copy()">
        {{ copied() ? t('recovery.copied') : t('common.copy') }}
      </button>
      <button mat-stroked-button type="button" (click)="download()">
        {{ t('recovery.download') }}
      </button>
    </div>
  `,
  styles: `
    .codes {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin: 0 0 16px;
      padding: 14px;
      list-style: none;
      border: 1px solid var(--sw-border);
      border-radius: var(--sw-radius, 8px);
      background: var(--sw-surface-2);
      font-family: var(--sw-font-mono, ui-monospace, monospace);
      font-size: 0.9375rem;
      letter-spacing: 0.04em;
      user-select: all;
    }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  `,
})
export class RecoveryCodesComponent {
  readonly codes = input.required<string[]>();

  protected readonly t = inject(I18n).t;
  protected readonly copied = signal(false);

  protected copy(): void {
    void navigator.clipboard
      .writeText(this.codes().join('\n'))
      .then(() => this.copied.set(true))
      .catch(() => undefined);
  }

  protected download(): void {
    const file = new Blob([`SilenceWatch recovery codes\n\n${this.codes().join('\n')}\n`], {
      type: 'text/plain',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = 'silencewatch-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(link.href);
  }
}
