import { useTranslation } from 'react-i18next';
import {
  Activity,
  ArrowDownUp,
  Cpu,
  Gauge,
  HardDrive,
  LayoutGrid,
  Terminal,
} from 'lucide-react';
import { MONITOR_PANELS, type MonitorPanelId } from '@/lib/monitor-panel-types';

type PanelLabelKey =
  | 'systemMonitor.panelPicker.overview'
  | 'systemMonitor.panelPicker.processes'
  | 'systemMonitor.panelPicker.disk'
  | 'systemMonitor.panelPicker.gpu'
  | 'systemMonitor.panelPicker.network'
  | 'systemMonitor.panelPicker.latency';

const PANEL_LABEL_KEYS: Record<MonitorPanelId, PanelLabelKey> = {
  overview: 'systemMonitor.panelPicker.overview',
  processes: 'systemMonitor.panelPicker.processes',
  disk: 'systemMonitor.panelPicker.disk',
  gpu: 'systemMonitor.panelPicker.gpu',
  network: 'systemMonitor.panelPicker.network',
  latency: 'systemMonitor.panelPicker.latency',
};
import { cn } from '@/lib/utils';
import { Toggle } from '../ui/toggle';

const PANEL_ICONS: Record<MonitorPanelId, typeof Activity> = {
  overview: Activity,
  processes: Terminal,
  disk: HardDrive,
  gpu: Cpu,
  network: ArrowDownUp,
  latency: Gauge,
};

interface MonitorPanelPickerProps {
  enabled: Set<MonitorPanelId>;
  onChange: (panels: Set<MonitorPanelId>) => void;
}

export function MonitorPanelPicker({ enabled, onChange }: MonitorPanelPickerProps) {
  const { t } = useTranslation();

  const togglePanel = (panelId: MonitorPanelId) => {
    const next = new Set(enabled);
    if (next.has(panelId)) {
      next.delete(panelId);
    } else {
      next.add(panelId);
    }
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <LayoutGrid className="w-3 h-3 shrink-0" />
        <h3 className="text-xs font-medium truncate">{t('systemMonitor.panelPicker.title')}</h3>
      </div>
      <div className="flex flex-wrap gap-1">
        {MONITOR_PANELS.map((panel) => {
          const Icon = PANEL_ICONS[panel.id];
          const isEnabled = enabled.has(panel.id);

          return (
            <Toggle
              key={panel.id}
              size="sm"
              pressed={isEnabled}
              onPressedChange={() => togglePanel(panel.id)}
              className={cn(
                'h-6 gap-1 px-1.5 text-[9px]',
              )}
              aria-label={t(PANEL_LABEL_KEYS[panel.id])}
            >
              <Icon className="w-2.5 h-2.5 shrink-0" />
              <span>{t(PANEL_LABEL_KEYS[panel.id])}</span>
            </Toggle>
          );
        })}
      </div>
    </div>
  );
}