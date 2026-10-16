export interface TrendPoint {
  timestamp: number;
  value: number | null;
}

export interface TrendSeries {
  id: string;
  label: string;
  color: string;
  points: readonly TrendPoint[];
  formatValue: (value: number) => string;
  dash?: string;
}

interface PlotPoint extends TrendPoint {
  value: number;
  x: number;
  y: number;
}

/** Normalized x coordinates and a 40px viewBox avoid resize observers entirely. */
export function buildTrendModel(series: readonly TrendSeries[], domain?: readonly [number, number]) {
  const normalized = series.map(item => ({
    ...item,
    points: [...new Map(item.points
      .filter(point => Number.isFinite(point.timestamp))
      .map(point => [point.timestamp, {
        ...point,
        value: point.value !== null && Number.isFinite(point.value) ? point.value : null,
      }])).values()].sort((a, b) => a.timestamp - b.timestamp),
  }));
  const timestamps = [...new Set(normalized.flatMap(item => item.points.map(point => point.timestamp)))].sort((a, b) => a - b);
  const values = normalized.flatMap(item => item.points.flatMap(point => point.value === null ? [] : [point.value]));
  const maximum = Math.max(0, ...values);
  const [minimum, upper] = domain ?? [0, Math.max(1, maximum * 1.1)];
  const range = upper - minimum || 1;
  const start = timestamps[0] ?? 0;
  const end = timestamps[timestamps.length - 1] ?? start;
  const x = (timestamp: number) => end === start ? 98 : 2 + (timestamp - start) / (end - start) * 96;
  const y = (value: number) => 36 - Math.max(0, Math.min(1, (value - minimum) / range)) * 32;

  return {
    timestamps,
    hasData: values.length > 0,
    x,
    series: normalized.map(item => {
      const segments: PlotPoint[][] = [];
      let segment: PlotPoint[] = [];
      for (const point of item.points) {
        if (point.value === null) {
          if (segment.length) segments.push(segment);
          segment = [];
        } else {
          segment.push({ ...point, value: point.value, x: x(point.timestamp), y: y(point.value) });
        }
      }
      if (segment.length) segments.push(segment);
      return { ...item, segments };
    }),
  };
}
