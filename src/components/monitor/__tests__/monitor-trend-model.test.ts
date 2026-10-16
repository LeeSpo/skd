import { describe, expect, it } from 'vitest';
import { buildTrendModel, type TrendPoint, type TrendSeries } from '../monitor-trend-model';

const series = (id: string, points: TrendPoint[]): TrendSeries => ({
  id, label: id, color: 'var(--chart-1)', points, formatValue: String,
});

describe('monitor trend projection', () => {
  it('handles empty, zero, constant, and single samples without invalid coordinates', () => {
    expect(buildTrendModel([]).hasData).toBe(false);
    for (const values of [[0], [0, 0], [5, 5]]) {
      const model = buildTrendModel([series('value', values.map((value, timestamp) => ({ timestamp, value })))]);
      expect(model.hasData).toBe(true);
      expect(model.series[0].segments.flat().every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
      if (values.length === 1) expect(model.series[0].segments[0][0].x).toBe(98);
    }
  });

  it('uses elapsed time, sorts samples, and leaves explicit gaps unconnected', () => {
    const model = buildTrendModel([series('value', [
      { timestamp: 300, value: 30 }, { timestamp: 0, value: 10 },
      { timestamp: 100, value: 20 }, { timestamp: 200, value: null },
    ])]);
    expect(model.timestamps).toEqual([0, 100, 200, 300]);
    const segments = model.series[0].segments;
    expect(segments.map(segment => segment.map(point => point.timestamp))).toEqual([[0, 100], [300]]);
    expect(segments[0][1].x - segments[0][0].x).toBeCloseTo((segments[1][0].x - segments[0][0].x) / 3);
  });

  it('shares the scale across series and preserves values on fixed percentage scales', () => {
    const model = buildTrendModel([
      series('small', [{ timestamp: 0, value: 10 }]),
      series('large', [{ timestamp: 0, value: 100 }]),
    ], [0, 100]);
    expect(model.series[0].segments[0][0].y).toBeGreaterThan(model.series[1].segments[0][0].y);
    expect(model.series[1].segments[0][0].y).toBe(4);
    const speed = buildTrendModel([series('speed', [{ timestamp: 0, value: 100000 }])]);
    expect(speed.series[0].segments[0][0].y).toBeGreaterThan(4);
    expect(speed.series[0].segments[0][0].value).toBe(100000);
  });

  it('discards invalid timestamps and treats nonfinite values as missing samples', () => {
    const model = buildTrendModel([series('value', [
      { timestamp: NaN, value: 1 }, { timestamp: 0, value: 5 },
      { timestamp: 1, value: Infinity }, { timestamp: 2, value: NaN },
      { timestamp: 3, value: 8 },
    ])]);
    expect(model.timestamps).toEqual([0, 1, 2, 3]);
    expect(model.series[0].segments.map(segment => segment.length)).toEqual([1, 1]);
    expect(buildTrendModel([series('missing', [{ timestamp: 0, value: null }])]).hasData).toBe(false);
  });
});
