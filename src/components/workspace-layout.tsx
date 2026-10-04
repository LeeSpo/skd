import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelLeftClose } from 'lucide-react';
import { inspectorSizing } from '@/lib/inspector-sizing';
import { useLayout } from '@/lib/layout-context';
import { TitlebarSlotProvider } from '@/lib/titlebar-slot-context';
import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface WorkspaceLayoutProps {
  sidebar: ReactNode;
  toolbar: ReactNode;
  children: ReactNode;
  inspector?: ReactNode;
}

/** Window chrome owns geometry; sessions stay in their existing stable layer. */
export function WorkspaceLayout({ sidebar, toolbar, children, inspector }: WorkspaceLayoutProps) {
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
  const inspectorLayout = inspectorSizing(
    width * Math.max(workspaceShare, 0) / 100,
    layout.rightSidebarSize,
    workspaceShare,
  );

  return (
    <TitlebarSlotProvider>
    <div ref={shellRef} className="workspace-shell h-full min-h-0 overflow-hidden">
      <ResizablePanelGroup direction="horizontal" autoSaveId="skd-main-layout">
        {layout.leftSidebarVisible && (
          <ResizablePanel key="left-sidebar" id="left-sidebar" order={1} defaultSize={layout.leftSidebarSize} minSize={minSidebarSize} maxSize={maxSidebarSize} onResize={setLeftSidebarSize}>
            <aside className="workspace-sidebar flex h-full min-h-0 flex-col" aria-label={t('connectionManager.connectionsHeader')}>
              <div className="sidebar-titlebar window-chrome flex h-11 shrink-0 items-center justify-end gap-2 pl-[80px] pr-2" data-tauri-drag-region>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="menubar" onClick={toggleLeftSidebar} aria-label={t('menuBar.toggleConnectionManager')} aria-pressed data-tauri-drag-region="false">
                        <PanelLeftClose className="size-[17px]" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('menuBar.toggleConnectionManager')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">{sidebar}</div>
            </aside>
          </ResizablePanel>
        )}
        {layout.leftSidebarVisible && <ResizableHandle key="sidebar-divider" />}
        <ResizablePanel key="main-content" id="main-content" order={2} defaultSize={workspaceShare} minSize={45}>
          <div className="workspace-column flex h-full min-h-0 flex-col">
            {toolbar}
            <div className="min-h-0 flex-1 overflow-hidden">
              <ResizablePanelGroup direction="horizontal" autoSaveId="skd-workspace-tools">
                <ResizablePanel key="workspace-content" id="workspace-content" order={1} className="min-w-0" defaultSize={inspector ? 100 - inspectorLayout.size : 100} minSize={45}>
                  {children}
                </ResizablePanel>
                {inspector && <ResizableHandle key="inspector-divider" />}
                {inspector && (
                  <ResizablePanel
                    key="right-sidebar"
                    id="right-sidebar"
                    order={2}
                    className="min-w-0"
                    defaultSize={inspectorLayout.size}
                    minSize={inspectorLayout.minSize}
                    maxSize={inspectorLayout.maxSize}
                    onResize={size => {
                      if (!Number.isFinite(size) || size <= 0 || workspaceShare <= 0) return;
                      setRightSidebarSize(size * workspaceShare / 100);
                    }}
                  >
                    {inspector}
                  </ResizablePanel>
                )}
              </ResizablePanelGroup>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
    </TitlebarSlotProvider>
  );
}
