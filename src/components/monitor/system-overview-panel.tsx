import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { withRetry, CancelledError } from '@/lib/async-retry';
import { Card, CardContent } from '../ui/card';
import { Progress } from '../ui/progress';
import type { MonitorPanelProps, SystemStats } from './monitor-types';
import { getProgressColor, getUsageColor, scheduleIdleTask } from './monitor-utils';

function formatCapacity(used: number, total: number): string {
  const divisor = total >= 1024 ? 1024 : 1;
  const unit = total >= 1024 ? 'GB' : 'MB';
  return `${Number((used / divisor).toFixed(1))} / ${Number((total / divisor).toFixed(1))} ${unit}`;
}

function UsageMetric({ label, value, used, total }: {
  label: string;
  value: number;
  used?: number;
  total?: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2 text-ui-label">
        <span>{label}</span>
        {used !== undefined && total !== undefined && (
          <span className="ml-auto truncate text-ui-label text-muted-foreground tabular-nums" title={`${used} MB / ${total} MB`}>
            {formatCapacity(used, total)}
          </span>
        )}
        <span className={`ml-auto shrink-0 text-ui-body font-medium tabular-nums ${getUsageColor(value)}`}>
          {value.toFixed(1)}%
        </span>
      </div>
      <Progress aria-label={label} value={value} className={`h-1 ${getProgressColor(value)}`} />
    </div>
  );
}

export function SystemOverviewPanel({ connectionId, active = true }: MonitorPanelProps) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<SystemStats>({
    cpu: 0,
    memory: 0,
    diskUsage: 0,
    uptime: '0:00:00',
  });

  useEffect(() => {
    if (!active) return;

    const fetchSystemStats = async (isCancelled: () => boolean = () => false): Promise<void> => {
      const result = await invoke<{
        cpu_percent: number;
        memory: { total: number; used: number; free: number; available: number };
        swap: { total: number; used: number; free: number; available: number };
        disk: { total: string; used: string; available: string; use_percent: number };
        uptime: string;
        load_average?: string;
      }>('get_system_stats', { connectionId });

      if (isCancelled()) return;

      const memoryPercent = result.memory.total > 0
        ? (result.memory.used / result.memory.total) * 100
        : 0;
      const swapPercent = result.swap.total > 0
        ? (result.swap.used / result.swap.total) * 100
        : 0;

      setStats({
        cpu: result.cpu_percent,
        memory: memoryPercent,
        memoryTotal: result.memory.total,
        memoryUsed: result.memory.used,
        swap: swapPercent,
        swapTotal: result.swap.total,
        swapUsed: result.swap.used,
        diskUsage: result.disk.use_percent,
        uptime: result.uptime,
      });
    };

    let cancelled = false;

    void withRetry(() => fetchSystemStats(() => cancelled), () => cancelled, { maxRetries: 2 })
      .catch(err => { if (!(err instanceof CancelledError)) console.error('Stats initial fetch failed:', err); });

    const statsInterval = setInterval(() => {
      scheduleIdleTask(() => { void fetchSystemStats(() => cancelled).catch(() => {}); });
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(statsInterval);
    };
  }, [connectionId, active]);

  return (
    <div className="space-y-1.5">
      <h3 className="text-ui-body font-medium truncate">{t('systemMonitor.systemOverview')}</h3>
      <Card>
        <CardContent className="p-2 space-y-3">
          <UsageMetric label={t('systemMonitor.cpu')} value={stats.cpu} />
          <UsageMetric label={t('systemMonitor.memory')} value={stats.memory} used={stats.memoryUsed} total={stats.memoryTotal} />
          {stats.swapTotal !== undefined && stats.swapTotal > 0 && (
            <UsageMetric label={t('systemMonitor.swap')} value={stats.swap ?? 0} used={stats.swapUsed} total={stats.swapTotal} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
