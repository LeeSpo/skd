import { useTranslation } from 'react-i18next';
import { Maximize2, Network, PanelBottomClose, PanelBottomOpen, PanelLeftOpen, PanelRightClose, PanelRightOpen, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTitlebarSlotSetter } from '@/lib/titlebar-slot-context';

interface WindowToolbarProps {
  workspaceTitle?: string;
  workspaceSubtitle?: string;
  /** When false, a single group's tabs fill the center slot. */
  showSessionTitle?: boolean;
  onOpenSettings?: () => void;
  onOpenPortForward?: () => void;
  portForwardEnabled?: boolean;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
  onToggleBottomPanel?: () => void;
  onToggleZenMode?: () => void;
  leftSidebarVisible?: boolean;
  rightSidebarVisible?: boolean;
  bottomPanelVisible?: boolean;
  showExtraPanelToggles?: boolean;
  showBottomPanelToggle?: boolean;
  showRightPanelToggle?: boolean;
  zenMode?: boolean;
}

const interactive = { 'data-tauri-drag-region': 'false' } as const;

export function WindowToolbar({
  workspaceTitle, workspaceSubtitle, showSessionTitle = true,
  onOpenSettings, onOpenPortForward, portForwardEnabled = false, onToggleLeftSidebar,
  onToggleRightSidebar, onToggleBottomPanel, onToggleZenMode,
  leftSidebarVisible, rightSidebarVisible, bottomPanelVisible, showExtraPanelToggles = true,
  showBottomPanelToggle = showExtraPanelToggles, showRightPanelToggle = showExtraPanelToggles, zenMode,
}: WindowToolbarProps) {
  const { t } = useTranslation();
  const setTitlebarSlot = useTitlebarSlotSetter();
  return (
    <div className="workspace-toolbar window-chrome flex h-11 shrink-0 items-center gap-2 px-3" style={{ paddingLeft: leftSidebarVisible ? undefined : 80 }}>
      <TooltipProvider>
        {!leftSidebarVisible && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="menubar" aria-label={t('menuBar.toggleConnectionManager')} aria-pressed={false} onClick={onToggleLeftSidebar} {...interactive}>
                <PanelLeftOpen className="size-[17px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('menuBar.toggleConnectionManager')}</TooltipContent>
          </Tooltip>
        )}
        <div className="relative flex h-full min-w-0 flex-1 items-center">
          <div
            id="titlebar-tabs-slot"
            ref={setTitlebarSlot}
            data-tauri-drag-region
            className="flex h-full min-w-0 flex-1 items-center"
          />
          {showSessionTitle && (
            <div className="pointer-events-none absolute inset-0 flex min-w-0 items-center gap-2">
              <span className="truncate text-[length:var(--text-body)] font-semibold">{workspaceTitle || t('menuBar.workspace')}</span>
              {workspaceSubtitle && (
                <span className="truncate text-[length:var(--text-secondary)] text-muted-foreground">{workspaceSubtitle}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1" data-tauri-drag-region="false">
          {showBottomPanelToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="menubar" aria-label={t('menuBar.toggleBottomPanel')} aria-pressed={!!bottomPanelVisible} onClick={onToggleBottomPanel} {...interactive}>
                  {bottomPanelVisible ? <PanelBottomClose className="size-[17px]" /> : <PanelBottomOpen className="size-[17px]" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('menuBar.toggleBottomPanel')}</TooltipContent>
            </Tooltip>
          )}
          {showRightPanelToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="menubar" aria-label={t('menuBar.toggleMonitorPanel')} aria-pressed={!!rightSidebarVisible} onClick={onToggleRightSidebar} {...interactive}>
                  {rightSidebarVisible ? <PanelRightClose className="size-[17px]" /> : <PanelRightOpen className="size-[17px]" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('menuBar.toggleMonitorPanel')}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="menubar" aria-label={t('menuBar.toggleZenMode')} aria-pressed={!!zenMode} onClick={onToggleZenMode} {...interactive}>
                <Maximize2 className="size-[17px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('menuBar.toggleZenMode')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="menubar"
                aria-label={t('menuBar.portForwarding')}
                disabled={!portForwardEnabled}
                onClick={() => { if (portForwardEnabled) onOpenPortForward?.(); }}
                {...interactive}
              >
                <Network className="size-[17px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('menuBar.portForwarding')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="menubar" aria-label={t('common.options')} onClick={onOpenSettings} {...interactive}>
                <Settings className="size-[17px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.options')}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}
