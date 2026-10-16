import { useCallback, useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { buildTrendModel, type TrendSeries } from './monitor-trend-model';

export type { TrendSeries } from './monitor-trend-model';

interface MonitorTrendProps {
  label: string;
  series: readonly TrendSeries[];
  domain?: readonly [number, number];
  showLegend?: boolean;
}

function SeriesMark({ color, dash }: Pick<TrendSeries, 'color' | 'dash'>) {
  return (
    <svg aria-hidden="true" width="16" height="8" className="shrink-0" style={{ color }}>
      <line x1="0" y1="4" x2="16" y2="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray={dash} />
    </svg>
  );
}

export function MonitorTrend({ label, series, domain, showLegend = true }: MonitorTrendProps) {
  const { t } = useTranslation();
  const model = useMemo(() => buildTrendModel(series, domain), [series, domain]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [boundary, setBoundary] = useState<HTMLElement | null>(null);
  const hintId = useId();
  const bindBoundary = useCallback((element: HTMLDivElement | null) => {
    setBoundary(element?.closest<HTMLElement>('.inspector-panel') ?? null);
  }, []);
  const lastIndex = model.timestamps.length - 1;
  const foundIndex = cursor === null ? -1 : model.timestamps.indexOf(cursor);
  const index = foundIndex < 0 ? lastIndex : foundIndex;
  const timestamp = model.timestamps[index];
  const selected = model.series.map(item => ({
    ...item,
    point: item.segments.flat().find(point => point.timestamp === timestamp),
    value: item.points.find(point => point.timestamp === timestamp)?.value ?? null,
  }));

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!model.hasData) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const position = (event.clientX - rect.left) / rect.width * 100;
    const nearest = model.timestamps.reduce((previous, candidate) =>
      Math.abs(model.x(candidate) - position) < Math.abs(model.x(previous) - position) ? candidate : previous,
    );
    setCursor(nearest);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!model.hasData) return;
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? lastIndex
      : Math.max(0, Math.min(lastIndex, index + (event.key === 'ArrowLeft' ? -1 : 1)));
    setCursor(model.timestamps[next]);
    setOpen(true);
  };

  return (
    <div ref={bindBoundary} className="monitor-trend min-w-0 space-y-1.5">
      {showLegend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {model.series.map(item => {
            const latest = item.points[item.points.length - 1]?.value;
            return (
              <div key={item.id} className="flex min-w-0 items-center gap-1.5">
                <SeriesMark color={item.color} dash={item.dash} />
                <span className="text-ui-label text-muted-foreground">{item.label}</span>
                <span className="text-ui-body font-medium tabular-nums">
                  {latest !== null && latest !== undefined ? item.formatValue(latest) : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <Tooltip open={open && model.hasData} onOpenChange={setOpen} disableHoverableContent>
        <TooltipTrigger asChild>
          <div
            role="group"
            aria-label={label}
            {...(!open ? { 'aria-describedby': hintId } : {})}
            tabIndex={model.hasData ? 0 : undefined}
            className="monitor-trend-plot relative h-10 w-full min-w-0 rounded-sm outline-none"
            data-tauri-drag-region="false"
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setCursor(null)}
            onFocus={() => setCursor(null)}
            onKeyDown={handleKeyDown}
          >
            <span id={hintId} className="sr-only">{t('systemMonitor.trendNavigation')}</span>
            {!model.hasData ? (
              <span className="flex h-full items-center text-ui-label text-muted-foreground">{t('systemMonitor.waitingForData')}</span>
            ) : (
              <>
                <svg aria-hidden="true" viewBox="0 0 100 40" preserveAspectRatio="none" className="block h-full w-full overflow-visible">
                  {model.series.flatMap(item => item.segments.filter(segment => segment.length > 1).map((segment, segmentIndex) => (
                    <polyline
                      key={`${item.id}-${segmentIndex}`}
                      data-series={item.id}
                      points={segment.map(point => `${point.x},${point.y}`).join(' ')}
                      fill="none"
                      stroke={item.color}
                      strokeDasharray={item.dash}
                      vectorEffect="non-scaling-stroke"
                      className="monitor-trend-line"
                    />
                  )))}
                  {open && <line x1={model.x(timestamp)} x2={model.x(timestamp)} y1="2" y2="38" stroke="var(--muted-foreground)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
                </svg>
                {model.series.flatMap(item => item.segments.filter(segment => segment.length === 1).map((segment, segmentIndex) => (
                  <span key={`${item.id}-${segmentIndex}`} className="monitor-trend-dot" style={{ left: `${segment[0].x}%`, top: segment[0].y, backgroundColor: item.color }} />
                )))}
                {open && selected.map(item => item.point && (
                  <span key={item.id} className="monitor-trend-dot" style={{ left: `${item.point.x}%`, top: item.point.y, backgroundColor: item.color }} />
                ))}
              </>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          collisionBoundary={boundary ?? undefined}
          collisionPadding={8}
          className="monitor-trend-tooltip"
        >
          <div className="text-muted-foreground">{new Date(timestamp).toLocaleTimeString()}</div>
          <div aria-live="polite" aria-atomic="true">
            {selected.map(item => (
              <div key={item.id} className="flex items-center gap-2">
                <SeriesMark color={item.color} dash={item.dash} />
                <span className="min-w-0 break-words">{item.label}</span>
                <span className="ml-auto whitespace-nowrap tabular-nums">{item.value === null ? '—' : item.formatValue(item.value)}</span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
