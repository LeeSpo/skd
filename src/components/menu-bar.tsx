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
      className="window-chrome flex h-10 shrink-0 items-center border-b border-panel-border bg-sidebar"
      // macOS traffic-light inset — keeps native window controls unobstructed
      style={{ paddingLeft: '80px' }}
    >
      <div
        className="h-full min-h-0 min-w-0 flex-1 cursor-default"
        data-tauri-drag-region
      />

      <div className="flex shrink-0 items-center gap-3 pr-3">
        <TooltipProvider>
          <div className="flex items-center gap-1">

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
                  ? <PanelLeftClose className="w-4 h-4" />
                  : <PanelLeftOpen className="w-4 h-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('menuBar.toggleConnectionManager')}</TooltipContent>
          </Tooltip>

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
                    ? <PanelBottomClose className="w-4 h-4" />
                    : <PanelBottomOpen className="w-4 h-4" />}
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
                    ? <PanelRightClose className="w-4 h-4" />
                    : <PanelRightOpen className="w-4 h-4" />}
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
                <Maximize2 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('menuBar.toggleZenMode')}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="menubar" aria-label={t('menuBar.layoutPresets')}>
                    <LayoutGrid className="w-4 h-4" />
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
                <Network className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('menuBar.portForwarding')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="menubar" aria-label={t('common.options')} onClick={onOpenSettings}>
                <Settings className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.options')}</TooltipContent>
          </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}
