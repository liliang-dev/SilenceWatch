import { areaPath, barsPath, cumulative, linePath, SPARK_HEIGHT, SPARK_WIDTH } from './sparkline';

describe('sparkline', () => {
  it('rebuilds the curve of a total from what was added each day', () => {
    // 10 today, after 1 two days ago and 2 yesterday and 0 today.
    expect(cumulative(10, [1, 2, 0])).toEqual([8, 10, 10]);
    expect(cumulative(5, [0, 0, 0])).toEqual([5, 5, 5]);
  });

  it('draws a line across the whole width, highest value at the top', () => {
    const path = linePath([0, 5, 10]);
    expect(path.startsWith('M0 ')).toBe(true);
    expect(path).toContain(`L${SPARK_WIDTH} 3`);
    expect(path).toContain(`M0 ${SPARK_HEIGHT - 3}`);
  });

  it('puts a flat series in the middle, and draws nothing for one point', () => {
    expect(linePath([4, 4])).toBe(`M0 ${SPARK_HEIGHT / 2} L${SPARK_WIDTH} ${SPARK_HEIGHT / 2}`);
    expect(linePath([4])).toBe('');
  });

  it('closes the area down to the bottom', () => {
    expect(areaPath([1, 2])).toMatch(new RegExp(`L${SPARK_WIDTH} ${SPARK_HEIGHT} L0 ${SPARK_HEIGHT} Z$`));
  });

  it('draws a bar for each day that has one, and nothing for a month of zeros', () => {
    expect(barsPath([0, 0, 0])).toBe('');
    const bars = barsPath([0, 2, 1]);
    expect(bars.match(/M/g)).toHaveLength(2);
  });
});
