import { Injectable, signal } from '@angular/core';
import { readStored, writeStored } from './storage';

export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/** Read by `public/theme-init.js` too, so the first paint is already the right colour. */
export const THEME_STORAGE_KEY = 'silencewatch.theme';

/**
 * What someone who has not chosen gets: the dark theme. It is a default, not a
 * choice, so it is not stored: the day it changes, those people follow it.
 */
export const DEFAULT_THEME: ThemeChoice = 'dark';

/**
 * Light, dark, or whatever the device says.
 *
 * Dark is the default. "System" is a choice like the other two, so it is stored:
 * its absence means "has not chosen", which is dark. A stored light or dark
 * writes `data-theme`, which the stylesheet lets win over the device; "system"
 * removes it, and the stylesheet's `prefers-color-scheme` rule applies.
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
    writeStored(THEME_STORAGE_KEY, choice);
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
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : DEFAULT_THEME;
}
