import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { CheckState } from '@silencewatch/shared';

/**
 * The state of a check, rendered identically everywhere it appears.
 *
 * Colour is never the only signal: each state also carries its own word and a
 * dot, so the screen stays readable in greyscale and for colour-blind users.
 * Only `UP` pulses — a heartbeat is the one thing worth animating in a product
 * about heartbeats, and a page full of movement would say nothing.
 */
@Component({
  selector: 'sw-state-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="chip" [class]="'is-' + state().toLowerCase()" [attr.data-size]="size()">
      <span class="dot" aria-hidden="true"></span>
      <span class="text">{{ label() }}</span>
    </span>
  `,
  styles: `
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 9px 3px 7px;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, currentColor 26%, transparent);
      background: var(--chip-soft);
      color: var(--chip-color);
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.03em;
      white-space: nowrap;
      line-height: 1.45;
    }

    .chip[data-size='lg'] {
      padding: 5px 13px 5px 10px;
      font-size: 0.8125rem;
      gap: 8px;
    }

    .dot {
      width: 6px;
      height: 6px;
      flex: none;
      border-radius: 50%;
      background: currentColor;
    }

    .chip[data-size='lg'] .dot {
      width: 8px;
      height: 8px;
    }

    .is-up {
      --chip-color: var(--sw-up);
      --chip-soft: var(--sw-up-soft);
    }

    .is-up .dot {
      animation: beat 2.6s ease-out infinite;
    }

    .is-late {
      --chip-color: var(--sw-late);
      --chip-soft: var(--sw-late-soft);
    }

    .is-down {
      --chip-color: var(--sw-down);
      --chip-soft: var(--sw-down-soft);
    }

    .is-paused {
      --chip-color: var(--sw-paused);
      --chip-soft: var(--sw-paused-soft);
    }

    .is-new {
      --chip-color: var(--sw-new);
      --chip-soft: var(--sw-new-soft);
    }

    @keyframes beat {
      0% {
        box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 55%, transparent);
      }
      70% {
        box-shadow: 0 0 0 6px transparent;
      }
      100% {
        box-shadow: 0 0 0 0 transparent;
      }
    }
  `,
})
export class StateChipComponent {
  readonly state = input.required<CheckState>();
  readonly size = input<'sm' | 'lg'>('sm');

  /** "NEW" says nothing to a reader; what it means is that nothing has arrived yet. */
  protected readonly label = computed(() => (this.state() === 'NEW' ? 'WAITING' : this.state()));
}
