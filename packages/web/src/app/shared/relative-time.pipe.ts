import { Pipe, PipeTransform } from '@angular/core';

/**
 * "3 minutes ago" / "in 2 hours" — how people read a monitoring screen.
 *
 * The absolute timestamp always stays available as a tooltip; relative time is
 * for scanning, not for forensics.
 *
 * The locale is pinned rather than taken from the browser. The application is
 * written in English throughout — every label, every state, every error the
 * server returns — so a machine set to French produced "il y a 3 minutes" in a
 * column headed "Last ping", next to "never" and "just now" in English. It also
 * made the test suite pass or fail depending on whose laptop it ran on, which
 * is the more expensive half of the same bug.
 *
 * This is the place to change when SilenceWatch is translated: the pipe would
 * take the active locale, and so would everything else at once.
 */
const LOCALE = 'en';
@Pipe({ name: 'swRelativeTime' })
export class RelativeTimePipe implements PipeTransform {
  private static readonly formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

  private static readonly units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ];

  transform(value: string | Date | null | undefined): string {
    if (value === null || value === undefined) return 'never';

    const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
    if (Number.isNaN(timestamp)) return '—';

    const deltaSeconds = (timestamp - Date.now()) / 1000;
    const magnitude = Math.abs(deltaSeconds);
    if (magnitude < 10) return 'just now';

    for (const [unit, seconds] of RelativeTimePipe.units) {
      if (magnitude >= seconds) {
        return RelativeTimePipe.formatter.format(Math.round(deltaSeconds / seconds), unit);
      }
    }
    return 'just now';
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
