import { Injectable, computed, inject, signal } from '@angular/core';
import type { BillingStateDto } from '@silencewatch/shared';
import { BillingApi } from './api/billing.api';

/**
 * Whether this instance sells subscriptions, and the state of the signed-in
 * account's. The Settings page asks it once to decide whether to show the
 * subscription tab, and the tab reads and refreshes the same state.
 *
 * `null` until the first answer, which is not "off": a page that hid the tab
 * while waiting would make it flicker into view on every visit.
 */
@Injectable({ providedIn: 'root' })
export class BillingStore {
  private readonly api = inject(BillingApi);

  readonly state = signal<BillingStateDto | null>(null);
  readonly enabled = computed(() => this.state()?.enabled === true);
  /** The question has been answered, whatever the answer was. */
  readonly known = computed(() => this.state() !== null);

  /** Loads the state. A failure leaves the previous one, and is the caller's to report. */
  refresh(): Promise<BillingStateDto> {
    return new Promise((resolve, reject) => {
      this.api.state().subscribe({
        next: (state) => {
          this.state.set(state);
          resolve(state);
        },
        error: (failure: unknown) => reject(failure),
      });
    });
  }
}
