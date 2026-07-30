import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { inject } from '@angular/core';

/**
 * Inline SVG icons.
 *
 * The Material icon font is not used on purpose: it is served from Google's CDN,
 * and the Content-Security-Policy of a self-hosted SilenceWatch is
 * `default-src 'self'`. Bundling a whole icon font for a dozen glyphs is worse
 * than shipping the dozen glyphs, so that is what happens here — no network, no
 * flash of unstyled text, and crisp at any size.
 *
 * Paths are from Material Symbols (Apache-2.0), traced on a 24×24 grid.
 */
const ICONS: Record<string, string> = {
  add: 'M11 13H5v-2h6V5h2v6h6v2h-6v6h-2z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z',
  delete:
    'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z',
  pause: 'M6 19h4V5H6zm8-14v14h4V5z',
  play: 'M8 5v14l11-7z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2m0 16H8V7h11z',
  search:
    'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14',
  more: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4m0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4m0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z',
  account:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6m0 14.2a7.2 7.2 0 0 1-6-3.22c.03-1.99 4-3.08 6-3.08s5.97 1.09 6 3.08a7.2 7.2 0 0 1-6 3.22',
  expand: 'm7 10 5 5 5-5z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
};

@Component({
  selector: 'sw-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    viewBox="0 0 24 24"
    [attr.width]="size()"
    [attr.height]="size()"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    [innerHTML]="path()"
  ></svg>`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      vertical-align: middle;
    }
  `,
})
export class IconComponent {
  readonly name = input.required<keyof typeof ICONS | string>();
  readonly size = input(20);

  private readonly sanitizer = inject(DomSanitizer);

  // The paths are compile-time constants from the map above, never user input.
  protected readonly path = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(`<path d="${ICONS[this.name()] ?? ICONS['check']}"/>`),
  );
}
