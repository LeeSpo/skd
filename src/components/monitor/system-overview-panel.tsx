import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Activity } from 'lucide-react';
import { withRetry, CancelledError } from '@/lib/async-retry';
import { Card, CardContent } from '../ui/card';
import { Progress } from '../ui/progress';
import type { MonitorPanelProps, SystemStats } from './monitor-types';
import { getProgressColor, getUsageColor, scheduleIdleTask } from './monitor-utils';

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
      <div className="flex items-center gap-1.5">
        <Activity className="w-3 h-3 shrink-0" />
        <h3 className="text-xs font-medium truncate">{t('systemMonitor.systemOverview')}</h3>
      </div>
      <Card>
        <CardContent className="p-2 space-y-1.5">
          <div className="space-y-1">
            <div className="flex justify-between items-center gap-1">
              <span className="text-xs font-medium">{t('systemMonitor.cpu')}</span>
              <span className={`text-xs font-semibold ${getUsageColor(stats.cpu)}`}>
                {stats.cpu.toFixed(1)}%
              </span>
            </div>
            <Progress value={stats.cpu} className={`h-1.5 ${getProgressColor(stats.cpu)}`} />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center gap-1">
              <span className="text-xs font-medium">{t('systemMonitor.memory')}</span>
              <span
                className={`text-xs font-semibold ${getUsageColor(stats.memory)} truncate`}
                title={stats.memoryUsed && stats.memoryTotal ? `${stats.memoryUsed}MB / ${stats.memoryTotal}MB` : ''}
              >
                {stats.memory.toFixed(1)}%
              </span>
            </div>
            <Progress value={stats.memory} className={`h-1.5 ${getProgressColor(stats.memory)}`} />
            {stats.memoryUsed && stats.memoryTotal && (
              <div className="text-[9px] text-muted-foreground text-right leading-tight">
                {stats.memoryUsed}MB / {stats.memoryTotal}MB
              </div>
            )}
          </div>

          {stats.swapTotal !== undefined && stats.swapTotal > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between items-center gap-1">
                <span className="text-xs font-medium">{t('systemMonitor.swap')}</span>
                <span
                  className={`text-xs font-semibold ${getUsageColor(stats.swap || 0)} truncate`}
                  title={stats.swapUsed !== undefined && stats.swapTotal ? `${stats.swapUsed}MB / ${stats.swapTotal}MB` : ''}
                >
                  {(stats.swap || 0).toFixed(1)}%
                </span>
              </div>
              <Progress value={stats.swap || 0} className={`h-1.5 ${getProgressColor(stats.swap || 0)}`} />
              {stats.swapUsed !== undefined && stats.swapTotal && (
                <div className="text-[9px] text-muted-foreground text-right leading-tight">
                  {stats.swapUsed}MB / {stats.swapTotal}MB
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
