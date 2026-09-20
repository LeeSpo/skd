import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from './ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import {
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PanelBottomClose,
  PanelBottomOpen,
  Maximize2,
  LayoutGrid,
  Network,
} from 'lucide-react';

interface MenuBarProps {
  workspaceTitle?: string;
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
  workspaceTitle,
  onOpenSettings,
  onOpenPortForward,
  portForwardEnabled = false,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  onToggleBottomPanel,
  onToggleZenMode,
  onApplyPreset,
  leftSidebarVisible,
  rightSidebarVisible,
  bottomPanelVisible,
  showExtraPanelToggles = true,
  showBottomPanelToggle = showExtraPanelToggles,
  showRightPanelToggle = showExtraPanelToggles,
  zenMode,
}: MenuBarProps) {
  const { t } = useTranslation();

  return (
    <div
      className="window-chrome relative flex h-11 shrink-0 items-center gap-3 border-b border-panel-border bg-sidebar"
      // macOS traffic-light inset — keeps native window controls unobstructed
      style={{ paddingLeft: '80px' }}
    >
      <TooltipProvider>
        <div className="flex shrink-0 items-center pl-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="menubar"
                aria-label={t('menuBar.toggleConnectionManager')}
                aria-pressed={!!leftSidebarVisible}
                onClick={onToggleLeftSidebar}
              >
                {leftSidebarVisible
                  ? <PanelLeftClose className="size-[18px]" />
                  : <PanelLeftOpen className="size-[18px]" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('menuBar.toggleConnectionManager')}</TooltipContent>
          </Tooltip>

        </div>
        <div className="flex h-full min-w-0 flex-1 items-center gap-2 cursor-default" data-tauri-drag-region>
          <span className="pointer-events-none text-[13px] font-semibold">{t('app.title')}</span>
          <span className="pointer-events-none text-muted-foreground/50" aria-hidden="true">/</span>
          <span className="pointer-events-none truncate text-[12px] text-muted-foreground">
            {workspaceTitle || t('menuBar.workspace')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3 pr-3">
          <div className="flex items-center gap-1">

          {showBottomPanelToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="menubar"
                  aria-label={t('menuBar.toggleBottomPanel')}
                  aria-pressed={!!bottomPanelVisible}
                  onClick={onToggleBottomPanel}
                >
                  {bottomPanelVisible
                    ? <PanelBottomClose className="size-[18px]" />
                    : <PanelBottomOpen className="size-[18px]" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('menuBar.toggleBottomPanel')}</TooltipContent>
            </Tooltip>
          )}

          {showRightPanelToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="menubar"
                  aria-label={t('menuBar.toggleMonitorPanel')}
                  aria-pressed={!!rightSidebarVisible}
                  onClick={onToggleRightSidebar}
                >
                  {rightSidebarVisible
                    ? <PanelRightClose className="size-[18px]" />
                    : <PanelRightOpen className="size-[18px]" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('menuBar.toggleMonitorPanel')}</TooltipContent>
            </Tooltip>
          )}

          </div>

          <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="menubar"
                aria-label={t('menuBar.toggleZenMode')}
                aria-pressed={!!zenMode}
                onClick={onToggleZenMode}
              >
                <Maximize2 className="size-[18px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('menuBar.toggleZenMode')}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="menubar" aria-label={t('menuBar.layoutPresets')}>
                    <LayoutGrid className="size-[18px]" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t('menuBar.layoutPresets')}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t('menuBar.layoutPresets')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onApplyPreset?.('Default')}>{t('menuBar.defaultLayout')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onApplyPreset?.('Minimal')}>{t('menuBar.minimalTerminalOnly')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onApplyPreset?.('Focus Mode')}>{t('menuBar.focusMode')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onApplyPreset?.('Full Stack')}>{t('menuBar.fullStackAllPanels')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onApplyPreset?.('Zen Mode')}>{t('menuBar.zenMode')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>

          <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="menubar"
                aria-label={t('menuBar.portForwarding')}
                onClick={onOpenPortForward}
                disabled={!portForwardEnabled}
              >
                <Network className="size-[18px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('menuBar.portForwarding')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="menubar" aria-label={t('common.options')} onClick={onOpenSettings}>
                <Settings className="size-[18px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.options')}</TooltipContent>
          </Tooltip>
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
