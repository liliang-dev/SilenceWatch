import { Injectable, signal } from '@angular/core';
import { readStored, removeStored, writeStored } from './storage';

export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/** Read by `public/theme-init.js` too, so the first paint is already the right colour. */
export const THEME_STORAGE_KEY = 'silencewatch.theme';

/**
 * Light, dark, or whatever the device says.
 *
 * "System" is the default and is the absence of a choice: no attribute is set,
 * and the stylesheet's `prefers-color-scheme` rule applies, as it did before
 * this could be chosen. Only an explicit light or dark writes `data-theme`,
 * which the stylesheet lets win over the device.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly current = signal<ThemeChoice>(storedChoice());

  readonly choice = this.current.asReadonly();

  constructor() {
    this.reflect(this.current());
  }

  set(choice: ThemeChoice): void {
    this.current.set(choice);
    if (choice === 'system') removeStored(THEME_STORAGE_KEY);
    else writeStored(THEME_STORAGE_KEY, choice);
    this.reflect(choice);
  }

  private reflect(choice: ThemeChoice): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
  }
}

function storedChoice(): ThemeChoice {
  const stored = readStored(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}
