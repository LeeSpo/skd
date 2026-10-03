import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelLeftClose, Settings } from 'lucide-react';
import { useLayout } from '@/lib/layout-context';
import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface WorkspaceLayoutProps {
  sidebar: ReactNode;
  toolbar: ReactNode;
  children: ReactNode;
  inspector?: ReactNode;
  status: ReactNode;
  onOpenSettings: () => void;
}

/** Window chrome owns geometry; sessions stay in their existing stable layer. */
export function WorkspaceLayout({ sidebar, toolbar, children, inspector, status, onOpenSettings }: WorkspaceLayoutProps) {
  const { t } = useTranslation();
  const { layout, toggleLeftSidebar, setLeftSidebarSize, setRightSidebarSize } = useLayout();
  const shellRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(window.innerWidth);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);
  const minSidebarSize = 200 / width * 100;
  const maxSidebarSize = 360 / width * 100;
  const workspaceShare = 100 - (layout.leftSidebarVisible ? layout.leftSidebarSize : 0);
  const inspectorShare = layout.rightSidebarSize / workspaceShare * 100;

  return (
    <div ref={shellRef} className="workspace-shell h-full min-h-0 overflow-hidden">
      <ResizablePanelGroup direction="horizontal" autoSaveId="skd-main-layout">
        {layout.leftSidebarVisible && (
          <ResizablePanel key="left-sidebar" id="left-sidebar" order={1} defaultSize={layout.leftSidebarSize} minSize={minSidebarSize} maxSize={maxSidebarSize} onResize={setLeftSidebarSize}>
            <aside className="workspace-sidebar flex h-full min-h-0 flex-col" aria-label={t('connectionManager.connectionsHeader')}>
              <div className="sidebar-titlebar window-chrome flex h-11 shrink-0 items-center gap-2 pl-[80px] pr-2" data-tauri-drag-region>
                <span className="pointer-events-none min-w-0 flex-1 truncate text-[13px] font-semibold">{t('app.title')}</span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="menubar" onClick={toggleLeftSidebar} aria-label={t('menuBar.toggleConnectionManager')} aria-pressed>
                        <PanelLeftClose className="size-[17px]" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('menuBar.toggleConnectionManager')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">{sidebar}</div>
              <div className="sidebar-footer flex h-10 shrink-0 items-center px-3">
                <Button variant="ghost" size="sm" onClick={onOpenSettings} className="h-7 w-full justify-start gap-2 px-2 text-muted-foreground" aria-label={t('common.options')}>
                  <Settings className="size-3.5" />
                  <span>{t('welcome.preferences')}</span>
                  <span className="ml-auto text-[11px] opacity-60" aria-hidden="true">⌘,</span>
                </Button>
              </div>
            </aside>
          </ResizablePanel>
        )}
        {layout.leftSidebarVisible && <ResizableHandle key="sidebar-divider" dividerTone="sidebar" />}
        <ResizablePanel key="main-content" id="main-content" order={2} defaultSize={workspaceShare} minSize={45}>
          <div className="workspace-column flex h-full min-h-0 flex-col bg-workspace">
            {toolbar}
            <div className="min-h-0 flex-1 overflow-hidden">
              <ResizablePanelGroup direction="horizontal" autoSaveId="skd-workspace-tools">
                <ResizablePanel key="workspace-content" id="workspace-content" order={1} defaultSize={inspector ? 100 - inspectorShare : 100} minSize={45}>
                  {children}
                </ResizablePanel>
                {inspector && <ResizableHandle key="inspector-divider" dividerTone="panel" />}
                {inspector && (
                  <ResizablePanel key="right-sidebar" id="right-sidebar" order={2} defaultSize={inspectorShare} minSize={18} maxSize={40} onResize={size => setRightSidebarSize(size * workspaceShare / 100)}>
                    {inspector}
                  </ResizablePanel>
                )}
              </ResizablePanelGroup>
            </div>
            {status}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
