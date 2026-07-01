import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadEnabledPanels, saveEnabledPanels } from '@/lib/monitor-panel-storage';
import type { MonitorPanelId } from '@/lib/monitor-panel-types';
import { ScrollArea } from './ui/scroll-area';
import { MonitorPanelPicker } from './monitor/monitor-panel-picker';

interface SystemMonitorProps {
  connectionId?: string;
  active?: boolean;
}

const SystemOverviewPanel = lazy(() => import('./monitor/system-overview-panel').then((module) => ({
  default: module.SystemOverviewPanel,
})));
const ProcessesPanel = lazy(() => import('./monitor/processes-panel').then((module) => ({
  default: module.ProcessesPanel,
})));
const DiskUsagePanel = lazy(() => import('./monitor/disk-usage-panel').then((module) => ({
  default: module.DiskUsagePanel,
})));
const GpuMonitorPanel = lazy(() => import('./monitor/gpu-monitor-panel').then((module) => ({
  default: module.GpuMonitorPanel,
})));
const NetworkUsagePanel = lazy(() => import('./monitor/network-usage-panel').then((module) => ({
  default: module.NetworkUsagePanel,
})));
const NetworkLatencyPanel = lazy(() => import('./monitor/network-latency-panel').then((module) => ({
  default: module.NetworkLatencyPanel,
})));

function MonitorFallback() {
  return <div className="h-16 rounded border bg-muted/20" />;
}

export function SystemMonitor({ connectionId, active = true }: SystemMonitorProps) {
  const { t } = useTranslation();
  const [enabledPanels, setEnabledPanels] = useState(() => loadEnabledPanels());

  const handlePanelsChange = (panels: Set<MonitorPanelId>) => {
    setEnabledPanels(panels);
    saveEnabledPanels([...panels]);
  };

  if (!connectionId) {
    return null;
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-2.5">
        <MonitorPanelPicker enabled={enabledPanels} onChange={handlePanelsChange} />

        {enabledPanels.size === 0 && (
          <p className="text-[10px] text-muted-foreground text-center py-6 px-2">
            {t('systemMonitor.panelPicker.noneEnabled')}
          </p>
        )}

        <Suspense fallback={<MonitorFallback />}>
          {enabledPanels.has('overview') && (
            <SystemOverviewPanel connectionId={connectionId} active={active} />
          )}
          {enabledPanels.has('processes') && (
            <ProcessesPanel connectionId={connectionId} active={active} />
          )}
          {enabledPanels.has('gpu') && (
            <GpuMonitorPanel connectionId={connectionId} active={active} />
          )}
          {enabledPanels.has('disk') && (
            <DiskUsagePanel connectionId={connectionId} active={active} />
          )}
          {enabledPanels.has('network') && (
            <NetworkUsagePanel connectionId={connectionId} active={active} />
          )}
          {enabledPanels.has('latency') && (
            <NetworkLatencyPanel connectionId={connectionId} active={active} />
          )}
        </Suspense>
      </div>
    </ScrollArea>
  );
}
