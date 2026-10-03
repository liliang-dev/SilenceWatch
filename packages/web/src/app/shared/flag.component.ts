import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A small flag, drawn rather than typed.
 *
 * The flag emoji would have been shorter, and Windows does not draw them: Chrome
 * there shows the two letters "FR" in a box instead of a flag. Inline SVG is the
 * same on every system, and — like the icons — needs nothing from the network,
 * which the served Content-Security-Policy would refuse anyway.
 */
@Component({
  selector: 'sw-flag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (country()) {
      @case ('fr') {
        <svg viewBox="0 0 3 2" role="img" aria-hidden="true">
          <rect width="1" height="2" fill="#0055a4" />
          <rect x="1" width="1" height="2" fill="#ffffff" />
          <rect x="2" width="1" height="2" fill="#ef4135" />
        </svg>
      }
      @case ('gb') {
        <svg viewBox="0 0 60 40" role="img" aria-hidden="true">
          <clipPath id="sw-flag-gb-cut">
            <path d="M30 20h30v20zv20h-30zh-30v-20zv-20h30z" />
          </clipPath>
          <rect width="60" height="40" fill="#012169" />
          <path d="M0 0 60 40M60 0 0 40" stroke="#ffffff" stroke-width="8" />
          <path
            d="M0 0 60 40M60 0 0 40"
            clip-path="url(#sw-flag-gb-cut)"
            stroke="#c8102e"
            stroke-width="5"
          />
          <path d="M30 0v40M0 20h60" stroke="#ffffff" stroke-width="12" />
          <path d="M30 0v40M0 20h60" stroke="#c8102e" stroke-width="7" />
        </svg>
      }
    }
  `,
  styles: `
    :host {
      display: inline-block;
      flex: none;
      width: 30px;
      height: 20px;
      overflow: hidden;
      border-radius: 3px;
      /* A hairline, so the white of a flag does not dissolve into a white card. */
      box-shadow: 0 0 0 1px rgb(0 0 0 / 14%);
      line-height: 0;
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
})
export class FlagComponent {
  readonly country = input.required<'fr' | 'gb'>();
}
