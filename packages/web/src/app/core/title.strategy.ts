import { Injectable, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import type { MessageKey } from './i18n/en';
import { I18n } from './i18n/i18n.service';

const SUFFIX = 'SilenceWatch';

/**
 * Window titles from message keys.
 *
 * A route declares `title: 'title.checks'`; this looks the key up in the
 * language that is current — now and whenever it changes, so the tab does not
 * keep announcing the old language until the next navigation.
 */
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly document = inject(Title);
  private readonly i18n = inject(I18n);

  /** The key of the page being shown. */
  private key: MessageKey | null = null;

  constructor() {
    super();
    effect(() => {
      this.i18n.language();
      this.apply();
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.key = (this.buildTitle(snapshot) as MessageKey | undefined) ?? null;
    this.apply();
  }

  private apply(): void {
    this.document.setTitle(this.key === null ? SUFFIX : `${this.i18n.t(this.key)} — ${SUFFIX}`);
  }
}
