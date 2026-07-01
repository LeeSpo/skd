import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { HardDrive } from 'lucide-react';
import { withRetry, CancelledError } from '@/lib/async-retry';
import { Card, CardContent } from '../ui/card';
import type { DiskUsage, MonitorPanelProps } from './monitor-types';
import { getUsageColor, scheduleIdleTask } from './monitor-utils';

export function DiskUsagePanel({ connectionId, active = true }: MonitorPanelProps) {
  const { t } = useTranslation();
  const [disks, setDisks] = useState<DiskUsage[]>([]);

  useEffect(() => {
    if (!active) return;

    const fetchDiskUsage = async (isCancelled: () => boolean = () => false): Promise<void> => {
      const result = await invoke<{
        success: boolean;
        disks: Array<{
          filesystem: string;
          path: string;
          total: string;
          used: string;
          available: string;
          usage: number;
        }>;
        error?: string;
      }>('get_disk_usage', { connectionId });

      if (isCancelled()) return;

      if (result.success) {
        setDisks(result.disks);
      } else {
        throw new Error(result.error ?? 'Disk usage fetch returned failure');
      }
    };

    let cancelled = false;

    void withRetry(() => fetchDiskUsage(() => cancelled), () => cancelled, {
      maxRetries: 3,
      onRetry: (n, err) => console.warn(`Disk usage retry ${n}:`, err),
    }).catch(err => { if (!(err instanceof CancelledError)) console.error('Disk usage failed after all retries:', err); });

    const interval = setInterval(() => {
      scheduleIdleTask(() => { void fetchDiskUsage(() => cancelled).catch(() => {}); });
    }, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connectionId, active]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <HardDrive className="w-3 h-3 shrink-0" />
        <h3 className="text-xs font-medium truncate">{t('systemMonitor.diskUsage')}</h3>
      </div>
      <Card>
        <CardContent className="p-0">
          {disks.length === 0 ? (
            <div className="p-2 text-[10px] text-muted-foreground">
              {t('systemMonitor.noDiskInfo')}
            </div>
          ) : (
            <div className="rounded-md border h-40 overflow-auto">
              <table className="w-full caption-bottom text-sm">
                <thead className="[&_tr]:border-b">
                  <tr className="border-b transition-colors">
                    <th className="sticky top-0 z-10 bg-background text-foreground h-7 px-1 text-left align-middle font-medium text-xs">{t('systemMonitor.path')}</th>
                    <th className="sticky top-0 z-10 bg-background text-foreground h-7 px-1 text-right align-middle font-medium text-xs">{t('systemMonitor.size')}</th>
                    <th className="sticky top-0 z-10 bg-background text-foreground h-7 px-1 text-right align-middle font-medium text-xs">{t('systemMonitor.usage')}</th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {disks.map((disk, index) => (
                    <tr key={index} className="hover:bg-muted/50 border-b transition-colors">
                      <td className="p-1 align-middle font-medium text-[10px] truncate max-w-0" title={`${disk.path} (${disk.filesystem})`}>
                        {disk.path}
                      </td>
                      <td className="p-1 align-middle text-right font-mono text-[10px] whitespace-nowrap">{disk.total}</td>
                      <td className="p-1 align-middle text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className={`font-mono text-[10px] font-semibold ${getUsageColor(disk.usage)}`}>
                            {disk.usage}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
