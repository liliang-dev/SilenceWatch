/**
 * The small charts of the statistics tab, as SVG path data. Pure functions, so the
 * shapes are tested without a browser.
 */

/** The width and height of every chart's viewBox. */
export const SPARK_WIDTH = 120;
export const SPARK_HEIGHT = 36;
/** Room left above and below the line, so its stroke is not cut by the box. */
const PAD = 3;

/**
 * What a total was at the end of each day: the total now, less what was added
 * after that day. For a count that only grows by additions (accounts, checks,
 * subscriptions started), this is its curve over the period.
 */
export function cumulative(total: number, daily: readonly number[]): number[] {
  const values = new Array<number>(daily.length);
  let running = total;
  for (let index = daily.length - 1; index >= 0; index -= 1) {
    values[index] = running;
    running -= daily[index] ?? 0;
  }
  return values;
}

/** Vertical position of a value, between the lowest and highest of the series. */
function scaler(values: readonly number[]): (value: number) => number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const usable = SPARK_HEIGHT - PAD * 2;
  // A flat series sits in the middle rather than on the floor.
  return (value) => (span === 0 ? SPARK_HEIGHT / 2 : PAD + usable - ((value - min) / span) * usable);
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** The line through the values, left to right. Empty for fewer than two values. */
export function linePath(values: readonly number[]): string {
  if (values.length < 2) return '';
  const y = scaler(values);
  const step = SPARK_WIDTH / (values.length - 1);
  return values.map((value, index) => `${index === 0 ? 'M' : 'L'}${round(index * step)} ${round(y(value))}`).join(' ');
}

/** The same line, closed down to the bottom: the shaded area under it. */
export function areaPath(values: readonly number[]): string {
  const line = linePath(values);
  return line === '' ? '' : `${line} L${SPARK_WIDTH} ${SPARK_HEIGHT} L0 ${SPARK_HEIGHT} Z`;
}

/** One bar per value, from the bottom, as rectangles of a single path. Zero draws nothing. */
export function barsPath(values: readonly number[]): string {
  if (values.length === 0) return '';
  const max = Math.max(...values);
  if (max === 0) return '';
  const slot = SPARK_WIDTH / values.length;
  const width = Math.max(1, slot - 1);
  const usable = SPARK_HEIGHT - PAD;
  return values
    .map((value, index) => {
      if (value <= 0) return '';
      const height = Math.max(1.5, (value / max) * usable);
      const x = round(index * slot);
      const top = round(SPARK_HEIGHT - height);
      return `M${x} ${SPARK_HEIGHT} V${top} H${round(x + width)} V${SPARK_HEIGHT} Z`;
    })
    .join(' ');
}
