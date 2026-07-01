import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Terminal, X, ArrowDown } from 'lucide-react';
import { withRetry, CancelledError } from '@/lib/async-retry';
import { toast } from 'sonner';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import type { MonitorPanelProps, Process } from './monitor-types';
import { getUsageColor, scheduleIdleTask } from './monitor-utils';

export function ProcessesPanel({ connectionId, active = true }: MonitorPanelProps) {
  const { t } = useTranslation();
  const [processes, setProcesses] = useState<Process[]>([]);
  const [processToKill, setProcessToKill] = useState<Process | null>(null);
  const [processSortBy, setProcessSortBy] = useState<'cpu' | 'mem'>('cpu');

  const fetchProcesses = async (isCancelled: () => boolean = () => false): Promise<void> => {
    const result = await invoke<{
      success: boolean;
      processes?: Array<{
        pid: string;
        user: string;
        cpu: string;
        mem: string;
        command: string;
      }>;
      error?: string;
    }>('get_processes', { connectionId, sortBy: processSortBy });

    if (isCancelled()) return;

    if (result.success && result.processes) {
      setProcesses(
        result.processes.map(p => ({
          pid: parseInt(p.pid),
          user: p.user,
          cpu: parseFloat(p.cpu),
          mem: parseFloat(p.mem),
          command: p.command,
        })),
      );
    }
  };

  const handleKillProcess = async (process: Process) => {
    try {
      const result = await invoke<{
        success: boolean;
        output?: string;
        error?: string;
      }>('kill_process', {
        connectionId,
        pid: process.pid.toString(),
        signal: '15',
      });

      if (result.success) {
        toast.success(t('systemMonitor.processTerminated', { pid: process.pid }));
        void fetchProcesses().catch(e => console.error('Failed to refresh processes:', e));
      } else {
        toast.error(t('systemMonitor.failedToKillProcessWithError', { error: result.error || t('systemMonitor.unknownError') }));
      }
    } catch (error) {
      console.error('Failed to kill process:', error);
      toast.error(t('systemMonitor.failedToKillProcess', { error: String(error) }));
    }

    setProcessToKill(null);
  };

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    void withRetry(() => fetchProcesses(() => cancelled), () => cancelled, { maxRetries: 2 })
      .catch(err => { if (!(err instanceof CancelledError)) console.error('Processes initial fetch failed:', err); });

    const processInterval = setInterval(() => {
      scheduleIdleTask(() => { void fetchProcesses(() => cancelled).catch(() => {}); });
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(processInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchProcesses depends on processSortBy
  }, [connectionId, processSortBy, active]);

  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Terminal className="w-3 h-3 shrink-0" />
          <h3 className="text-xs font-medium truncate">{t('systemMonitor.runningProcesses')}</h3>
        </div>
        <Card>
          <CardContent className="p-0">
            <div className="rounded-md border h-40 overflow-auto">
              <table className="w-full caption-bottom text-sm">
                <thead className="[&_tr]:border-b">
                  <tr className="border-b transition-colors">
                    <th className="sticky top-0 z-10 bg-background text-foreground h-8 px-1 text-left align-middle font-medium whitespace-nowrap text-xs">{t('systemMonitor.pid')}</th>
                    <th
                      className="sticky top-0 z-10 bg-background text-foreground h-8 px-1 text-left align-middle font-medium whitespace-nowrap text-xs cursor-pointer hover:bg-muted/50 select-none"
                      onClick={() => setProcessSortBy('cpu')}
                    >
                      <div className="flex items-center gap-0.5">
                        {t('systemMonitor.cpu')}
                        {processSortBy === 'cpu' && <ArrowDown className="w-2.5 h-2.5" />}
                      </div>
                    </th>
                    <th
                      className="sticky top-0 z-10 bg-background text-foreground h-8 px-1 text-left align-middle font-medium whitespace-nowrap text-xs cursor-pointer hover:bg-muted/50 select-none"
                      onClick={() => setProcessSortBy('mem')}
                    >
                      <div className="flex items-center gap-0.5">
                        {t('systemMonitor.mem')}
                        {processSortBy === 'mem' && <ArrowDown className="w-2.5 h-2.5" />}
                      </div>
                    </th>
                    <th className="sticky top-0 z-10 bg-background text-foreground h-8 px-1 text-left align-middle font-medium whitespace-nowrap text-xs">{t('systemMonitor.command')}</th>
                    <th className="sticky top-0 z-10 bg-background text-foreground h-8 px-1 text-left align-middle font-medium whitespace-nowrap text-xs w-8" />
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {processes.slice(0, 8).map((process) => (
                    <tr key={process.pid} className="hover:bg-muted/50 border-b transition-colors">
                      <td className="p-1 align-middle whitespace-nowrap text-[10px]">{process.pid}</td>
                      <td className={`p-1 align-middle whitespace-nowrap text-[10px] font-semibold ${getUsageColor(process.cpu)}`}>
                        {process.cpu.toFixed(0)}%
                      </td>
                      <td className={`p-1 align-middle whitespace-nowrap text-[10px] font-semibold ${getUsageColor(process.mem)}`}>
                        {process.mem.toFixed(0)}%
                      </td>
                      <td className="p-1 align-middle whitespace-nowrap text-[10px] font-mono truncate max-w-0" title={process.command}>
                        {process.command}
                      </td>
                      <td className="p-1 align-middle whitespace-nowrap text-xs">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4"
                          onClick={() => setProcessToKill(process)}
                          title={t('systemMonitor.killProcess')}
                        >
                          <X className="h-2.5 w-2.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!processToKill} onOpenChange={(open) => !open && setProcessToKill(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('systemMonitor.terminateProcessTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              <Trans i18nKey="systemMonitor.terminateProcessDesc" values={{ pid: processToKill?.pid }} components={{ strong: <strong /> }} />
              <br />
              <span className="text-xs font-mono mt-2 block">
                {processToKill?.command}
              </span>
              <br />
              {t('systemMonitor.terminateProcessDetail')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => processToKill && void handleKillProcess(processToKill)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('systemMonitor.terminate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
