import { Injectable, signal } from '@angular/core';

/**
 * The one error banner above the tabs. A tab that fails says so here instead of
 * drawing its own, so a failure is in the same place whichever tab raised it.
 * Provided by the settings page, so it lives and dies with it.
 */
@Injectable()
export class SettingsFeedback {
  readonly error = signal<string | null>(null);

  clear(): void {
    this.error.set(null);
  }

  show(message: string): void {
    this.error.set(message);
  }
}
