import { useTranslation } from 'react-i18next';
import { Ellipsis, Maximize2, Network, PanelBottomClose, PanelBottomOpen, PanelLeftOpen, PanelRightClose, PanelRightOpen, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuCheckboxItem,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { NewTabMenu } from '@/components/terminal/new-tab-menu';

interface MenuBarProps {
  workspaceTitle?: string;
  groupId?: string;
  onNewConnection?: () => void;
  onNewLocalTerminal?: () => void | Promise<void>;
  onOpenSavedConnection?: (connectionId: string, targetGroupId: string) => void | Promise<void>;
  onOpenSettings?: () => void;
  onOpenPortForward?: () => void;
  portForwardEnabled?: boolean;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
  onToggleBottomPanel?: () => void;
  onToggleZenMode?: () => void;
  onApplyPreset?: (preset: string) => void;
  leftSidebarVisible?: boolean;
  rightSidebarVisible?: boolean;
  bottomPanelVisible?: boolean;
  showExtraPanelToggles?: boolean;
  showBottomPanelToggle?: boolean;
  showRightPanelToggle?: boolean;
  zenMode?: boolean;
}

export function MenuBar({
  workspaceTitle, groupId, onNewConnection, onNewLocalTerminal, onOpenSavedConnection,
  onOpenSettings, onOpenPortForward, portForwardEnabled = false, onToggleLeftSidebar,
  onToggleRightSidebar, onToggleBottomPanel, onToggleZenMode, onApplyPreset,
  leftSidebarVisible, rightSidebarVisible, bottomPanelVisible, showExtraPanelToggles = true,
  showBottomPanelToggle = showExtraPanelToggles, showRightPanelToggle = showExtraPanelToggles, zenMode,
}: MenuBarProps) {
  const { t } = useTranslation();
  return (
    <div className="workspace-toolbar window-chrome flex h-11 shrink-0 items-center gap-2 px-3" style={{ paddingLeft: leftSidebarVisible ? undefined : 80 }}>
      <TooltipProvider>
        {!leftSidebarVisible && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="menubar" aria-label={t('menuBar.toggleConnectionManager')} aria-pressed={false} onClick={onToggleLeftSidebar}>
                <PanelLeftOpen className="size-[17px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('menuBar.toggleConnectionManager')}</TooltipContent>
          </Tooltip>
        )}
        <div className="flex h-full min-w-0 flex-1 items-center cursor-default" data-tauri-drag-region>
          <span className="pointer-events-none truncate text-[13px] font-medium">{workspaceTitle || t('menuBar.workspace')}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {showBottomPanelToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="menubar" aria-label={t('menuBar.toggleBottomPanel')} aria-pressed={!!bottomPanelVisible} onClick={onToggleBottomPanel}>
                  {bottomPanelVisible ? <PanelBottomClose className="size-[17px]" /> : <PanelBottomOpen className="size-[17px]" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('menuBar.toggleBottomPanel')}</TooltipContent>
            </Tooltip>
          )}
          {showRightPanelToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="menubar" aria-label={t('menuBar.toggleMonitorPanel')} aria-pressed={!!rightSidebarVisible} onClick={onToggleRightSidebar}>
                  {rightSidebarVisible ? <PanelRightClose className="size-[17px]" /> : <PanelRightOpen className="size-[17px]" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('menuBar.toggleMonitorPanel')}</TooltipContent>
            </Tooltip>
          )}
          {groupId && <NewTabMenu groupId={groupId} onNewConnection={onNewConnection} onNewLocalTerminal={onNewLocalTerminal} onOpenSavedConnection={onOpenSavedConnection} />}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="menubar" aria-label={t('menuBar.moreActions')}><Ellipsis className="size-[18px]" /></Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t('menuBar.moreActions')}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuCheckboxItem checked={!!zenMode} onCheckedChange={onToggleZenMode}>
                <Maximize2 className="mr-2 size-3.5" />{t('menuBar.toggleZenMode')}
              </DropdownMenuCheckboxItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t('menuBar.layoutPresets')}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuLabel>{t('menuBar.layoutPresets')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onApplyPreset?.('Default')}>{t('menuBar.defaultLayout')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onApplyPreset?.('Minimal')}>{t('menuBar.minimalTerminalOnly')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onApplyPreset?.('Focus Mode')}>{t('menuBar.focusMode')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onApplyPreset?.('Full Stack')}>{t('menuBar.fullStackAllPanels')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onApplyPreset?.('Zen Mode')}>{t('menuBar.zenMode')}</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!portForwardEnabled} onSelect={onOpenPortForward}>
                <Network className="mr-2 size-3.5" />{t('menuBar.portForwarding')}
              </DropdownMenuItem>
              {!leftSidebarVisible && <DropdownMenuItem onSelect={onOpenSettings}><Settings className="mr-2 size-3.5" />{t('common.options')}</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TooltipProvider>
    </div>
  );
}
