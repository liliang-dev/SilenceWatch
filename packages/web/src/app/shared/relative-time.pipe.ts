import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18n } from '../core/i18n/i18n.service';

/**
 * "3 minutes ago" / "in 2 hours" — how people read a monitoring screen.
 *
 * The absolute timestamp always stays available as a tooltip; relative time is
 * for scanning, not for forensics.
 *
 * The locale is the application's own, not the browser's. A machine set to
 * French used to produce "il y a 3 minutes" in a column headed "Last ping",
 * next to "never" and "just now" in English — and a test suite that passed or
 * failed depending on whose laptop ran it. Now the words around the number and
 * the number's own phrasing both follow the language chosen in the preferences.
 *
 * Impure on purpose: a pure pipe is only re-run when its input changes, and the
 * input here is a timestamp, which does not change when the language does.
 */
@Pipe({ name: 'swRelativeTime', pure: false })
export class RelativeTimePipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  private static readonly units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ];

  private formatter: Intl.RelativeTimeFormat | null = null;
  private formatterLanguage: string | null = null;

  transform(value: string | Date | null | undefined): string {
    if (value === null || value === undefined) return this.i18n.t('time.never');

    const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
    if (Number.isNaN(timestamp)) return '—';

    const deltaSeconds = (timestamp - Date.now()) / 1000;
    const magnitude = Math.abs(deltaSeconds);
    if (magnitude < 10) return this.i18n.t('time.justNow');

    for (const [unit, seconds] of RelativeTimePipe.units) {
      if (magnitude >= seconds) {
        return this.format().format(Math.round(deltaSeconds / seconds), unit);
      }
    }
    return this.i18n.t('time.justNow');
  }

  private format(): Intl.RelativeTimeFormat {
    const language = this.i18n.language();
    if (this.formatter === null || this.formatterLanguage !== language) {
      this.formatter = new Intl.RelativeTimeFormat(language, {
        numeric: 'auto',
      });
      this.formatterLanguage = language;
    }
    return this.formatter;
  }
}

/** Duration in milliseconds, rendered compactly: 850ms, 4.2s, 3m 20s. */
@Pipe({ name: 'swDuration' })
export class DurationPipe implements PipeTransform {
  transform(milliseconds: number | null | undefined): string {
    if (milliseconds === null || milliseconds === undefined) return '—';
    if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;

    const seconds = milliseconds / 1_000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;

    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60);
    if (minutes < 60) return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;

    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
}
