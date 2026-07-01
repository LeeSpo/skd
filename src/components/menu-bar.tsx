import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
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
} from 'lucide-react';

interface MenuBarProps {
  onOpenSettings?: () => void;
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
      className="flex h-8 items-center gap-1 border-b border-border bg-background"
      // macOS traffic-light inset — keeps native window controls unobstructed
      style={{ paddingLeft: '80px' }}
    >
      <div
        className="h-full min-h-0 min-w-0 flex-1 cursor-default"
        data-tauri-drag-region
      />

      <div className="flex items-center gap-0.5 pr-1">
        <TooltipProvider>
          <Separator orientation="vertical" className="h-4 mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onToggleLeftSidebar}>
                {leftSidebarVisible
                  ? <PanelLeftClose className="w-4 h-4" />
                  : <PanelLeftOpen className="w-4 h-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t(leftSidebarVisible ? 'common.hide' : 'common.show')} {t('menuBar.toggleConnectionManager')}</TooltipContent>
          </Tooltip>

          {showBottomPanelToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onToggleBottomPanel}>
                  {bottomPanelVisible
                    ? <PanelBottomClose className="w-4 h-4" />
                    : <PanelBottomOpen className="w-4 h-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t(bottomPanelVisible ? 'common.hide' : 'common.show')} {t('menuBar.toggleBottomPanel')}</TooltipContent>
            </Tooltip>
          )}

          {showRightPanelToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onToggleRightSidebar}>
                  {rightSidebarVisible
                    ? <PanelRightClose className="w-4 h-4" />
                    : <PanelRightOpen className="w-4 h-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t(rightSidebarVisible ? 'common.hide' : 'common.show')} {t('menuBar.toggleMonitorPanel')}</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 w-7 p-0 ${zenMode ? 'bg-accent' : ''}`}
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
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
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

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onOpenSettings}>
                <Settings className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.options')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}