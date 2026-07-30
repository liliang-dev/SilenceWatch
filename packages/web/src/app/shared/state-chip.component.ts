import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { CheckState } from '@silencewatch/shared';

/**
 * The state of a check, shown the same way everywhere.
 *
 * Colour is never the only signal: each state also has its own label and dot, so
 * the list is readable in greyscale and for colour-blind users.
 */
@Component({
  selector: 'sw-state-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="chip" [class]="'state-' + state().toLowerCase()">
      <span class="dot" aria-hidden="true"></span>
      {{ label() }}
    </span>
  `,
  styles: `
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px 3px 8px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.03em;
      white-space: nowrap;
      border: 1px solid currentColor;
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
    }

    .state-up { color: var(--sw-state-up); }
    .state-late { color: var(--sw-state-late); }
    .state-down { color: var(--sw-state-down); }
    .state-paused { color: var(--sw-state-paused); }
    .state-new { color: var(--sw-state-new); }
  `,
})
export class StateChipComponent {
  readonly state = input.required<CheckState>();

  protected label(): string {
    return this.state() === 'NEW' ? 'WAITING' : this.state();
  }
}
