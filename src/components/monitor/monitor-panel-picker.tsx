import { useTranslation } from 'react-i18next';
import {
  Activity,
  ArrowDownUp,
  Cpu,
  Gauge,
  HardDrive,
  LayoutGrid,
  Terminal,
  ChevronDown,
} from 'lucide-react';
import { MONITOR_PANELS, type MonitorPanelId } from '@/lib/monitor-panel-types';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

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
    <div className="flex shrink-0 justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-6 h-auto gap-1.5 px-1.5 text-ui-label text-muted-foreground"
            data-tauri-drag-region="false"
          >
            <LayoutGrid className="size-3" />
            {t('systemMonitor.panelPicker.title')}
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {MONITOR_PANELS.map((panel) => {
            const Icon = PANEL_ICONS[panel.id];
            const isEnabled = enabled.has(panel.id);

            return (
              <DropdownMenuCheckboxItem
                key={panel.id}
                checked={isEnabled}
                onCheckedChange={() => togglePanel(panel.id)}
                onSelect={(event) => event.preventDefault()}
              >
                <Icon className="size-3.5 text-muted-foreground" />
                <span>{t(PANEL_LABEL_KEYS[panel.id])}</span>
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
