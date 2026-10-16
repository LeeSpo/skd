import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { withRetry, CancelledError } from '@/lib/async-retry';
import { Card, CardContent } from '../ui/card';
import type { LatencyData, MonitorPanelProps } from './monitor-types';
import { CHART_COLORS } from '@/lib/chart-colors';
import { scheduleIdleTask } from './monitor-utils';
import { MonitorTrend } from './monitor-trend';

export function NetworkLatencyPanel({ connectionId, active = true }: MonitorPanelProps) {
  const { t } = useTranslation();
  const [latencyData, setLatencyData] = useState<LatencyData[]>([]);

  useEffect(() => {
    if (!active) return;

    const fetchLatency = async (isCancelled: () => boolean = () => false) => {
      const result = await invoke<{
        success: boolean;
        latency_ms?: number;
        error?: string;
      }>('get_network_latency', {
        connectionId,
        target: '8.8.8.8',
      });

      if (isCancelled()) return;

      if (result.success && result.latency_ms !== undefined) {
        const now = new Date();
        const newDataPoint: LatencyData = {
          time: now.toLocaleTimeString().slice(0, 8),
          latency: Math.round(result.latency_ms * 10) / 10,
          timestamp: now.getTime(),
        };
        setLatencyData(prev => [...prev, newDataPoint].slice(-60));
      }
    };

    let cancelled = false;

    void withRetry(() => fetchLatency(() => cancelled), () => cancelled, { maxRetries: 2 })
      .catch(err => { if (!(err instanceof CancelledError)) console.error('Latency initial fetch failed:', err); });

    const interval = setInterval(() => {
      scheduleIdleTask(() => { void fetchLatency(() => cancelled).catch(() => {}); });
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connectionId, active]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-ui-body font-medium truncate">{t('systemMonitor.networkLatency')}</h3>
        <span className="text-ui-body font-medium tabular-nums">
          {latencyData.length > 0 ? `${latencyData[latencyData.length - 1].latency} ms` : '—'}
        </span>
      </div>
      <Card>
        <CardContent className="p-2">
          <MonitorTrend
            label={t('systemMonitor.networkLatency')}
            showLegend={false}
            series={[{
              id: 'latency', label: t('systemMonitor.latency'), color: CHART_COLORS.monitorPrimary,
              formatValue: value => `${value.toFixed(1)} ms`,
              points: latencyData.map(point => ({ timestamp: point.timestamp, value: point.latency })),
            }]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
