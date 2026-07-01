import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Gauge } from 'lucide-react';
import { withRetry, CancelledError } from '@/lib/async-retry';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent } from '../ui/card';
import type { LatencyData, MonitorPanelProps } from './monitor-types';
import { scheduleIdleTask } from './monitor-utils';

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
      <div className="flex items-center gap-1.5">
        <Gauge className="w-3 h-3 shrink-0" />
        <h3 className="text-xs font-medium truncate">{t('systemMonitor.networkLatency')}</h3>
      </div>
      <Card>
        <CardContent className="p-2">
          <div className="h-24 text-foreground">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={latencyData} margin={{ top: 5, right: 2, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.2} />
                <defs>
                  <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 8, fill: 'currentColor' }}
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth={0.5}
                />
                <YAxis
                  tick={{ fontSize: 8, fill: 'currentColor' }}
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth={0.5}
                  width={30}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                  formatter={(value: number | string) => [`${value}ms`, t('systemMonitor.latency')]}
                  labelFormatter={(label) => `${t('systemMonitor.time')}: ${label}`}
                />
                <Area
                  type="monotone"
                  dataKey="latency"
                  stroke="#3b82f6"
                  strokeWidth={3}
                  fill="url(#latencyGradient)"
                  dot={false}
                  activeDot={{
                    r: 5,
                    fill: '#3b82f6',
                    stroke: '#fff',
                    strokeWidth: 2,
                    filter: 'drop-shadow(0 2px 4px rgba(59, 130, 246, 0.4))',
                  }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
