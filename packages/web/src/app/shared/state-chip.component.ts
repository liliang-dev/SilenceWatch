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
  templateUrl: './state-chip.component.html',
  styleUrl: './state-chip.component.scss',
})
export class StateChipComponent {
  readonly state = input.required<CheckState>();
  readonly size = input<'sm' | 'lg'>('sm');

  /** "NEW" says nothing to a reader; what it means is that nothing has arrived yet. */
  protected readonly label = computed(() => (this.state() === 'NEW' ? 'WAITING' : this.state()));
}
