import { useCallback, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  FileCode,
  FolderSync,
  MoveRight,
  RefreshCw,
  Terminal,
  X,
} from 'lucide-react';
import type { SplitDirection, TerminalTab, WorkspacePage } from '../../lib/terminal-group-types';
import { livePages } from '../../lib/terminal-group-reducer';
import { visiblePaneSessions, type PaneSession } from '../../lib/visible-pane-sessions';
import { getTabDisplayName } from '../../lib/terminal-group-utils';
import { tabTooltip } from '../../lib/session-chrome';
import { useTerminalGroups } from '../../lib/terminal-group-context';
import { useTerminalCallbacks } from '../../lib/terminal-callbacks-context';
import {
  clearTabDrag,
  findContentDropTargetAt,
  getActiveDrag,
  getContentDropHover,
  setActiveDrag,
  setContentDropHover,
} from '../../lib/tab-drag-state';
import { getZoneFromPosition, isSplitDirection } from './drop-zone-overlay';
import { Button } from '../ui/button';
import { StatusDot } from '../ui/status-dot';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../ui/context-menu';
import { NewTabMenu } from './new-tab-menu';
import { SplitSessionLabels } from './group-tab-bar';

function useSplitDrag(
  session: { groupId: string; tabId: string; name: string } | null,
  onSplit: (direction: SplitDirection, targetGroupId: string) => void,
) {
  return useCallback((event: ReactPointerEvent) => {
    if (!session || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) + Math.abs(dy) < 5) return;
        dragging = true;
        ev.preventDefault();
        setActiveDrag({ tabId: session.tabId, sourceGroupId: session.groupId, tabName: session.name });
        document.body.style.userSelect = 'none';
      }
      const contentTarget = findContentDropTargetAt(ev.clientX, ev.clientY);
      if (!contentTarget) {
        setContentDropHover(null);
        return;
      }
      const rect = contentTarget.element.getBoundingClientRect();
      setContentDropHover({
        groupId: contentTarget.groupId,
        zone: getZoneFromPosition(ev.clientX, ev.clientY, rect),
      });
    };

    const onUp = (ev: PointerEvent | FocusEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      document.body.style.userSelect = '';
      if (dragging && getActiveDrag()) {
        const clientX = 'clientX' in ev ? ev.clientX : 0;
        const clientY = 'clientY' in ev ? ev.clientY : 0;
        const hover = getContentDropHover() ?? (() => {
          const contentTarget = clientX || clientY ? findContentDropTargetAt(clientX, clientY) : null;
          if (!contentTarget) return null;
          const rect = contentTarget.element.getBoundingClientRect();
          return { groupId: contentTarget.groupId, zone: getZoneFromPosition(clientX, clientY, rect) };
        })();
        if (hover && isSplitDirection(hover.zone)) onSplit(hover.zone, hover.groupId);
      }
      clearTabDrag();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
  }, [onSplit, session]);
}

function tabIcon(tab: TerminalTab) {
  if (tab.tabType === 'file-browser') {
    return <FolderSync className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  if (tab.tabType === 'editor') {
    return <FileCode className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return <Terminal className="size-3.5 shrink-0 text-muted-foreground" />;
}

/**
 * One titlebar segment per workspace page. A split page writes every visible
 * pane into that one capsule. Selecting another page restores that page's grid.
 */
export function WorkspaceTabBar() {
  const { state, dispatch } = useTerminalGroups();
  const { onDuplicateTab, onNewTab, onNewLocalTab, onOpenSavedConnection, onReconnectTab, onRequestCloseTabs } = useTerminalCallbacks();
  const pages = livePages(state);
  const activePageId = state.activePageId && pages.some((page) => page.id === state.activePageId)
    ? state.activePageId
    : pages[0]?.id;

  const activatePage = (pageId: string) => {
    if (pageId !== activePageId) dispatch({ type: 'ACTIVATE_PAGE', pageId });
  };

  const focusPane = (pageId: string, groupId: string) => {
    if (pageId !== activePageId) dispatch({ type: 'ACTIVATE_PAGE', pageId });
    dispatch({ type: 'ACTIVATE_GROUP', groupId });
  };

  const closeTab = (groupId: string, tabId: string) => {
    onRequestCloseTabs?.([{ groupId, tabId }]);
  };

  return (
    <div
      data-variant="titlebar"
      data-tauri-drag-region="true"
      className="terminal-tab-strip flex h-full w-full min-w-0 items-center px-1"
    >
      <div
        data-workspace-tab-bar
        data-tauri-drag-region="true"
        className="relative flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {pages.map((page) => (
          <PageSegment
            key={page.id}
            page={page}
            active={page.id === activePageId}
            sessions={visiblePaneSessions({ groups: state.groups, gridLayout: page.gridLayout })}
            onActivate={() => activatePage(page.id)}
            onFocusGroup={(groupId) => focusPane(page.id, groupId)}
            onClose={closeTab}
            onDuplicateTab={onDuplicateTab}
            onReconnect={onReconnectTab}
            onMoveToNewGroup={(groupId, tabId, direction, targetGroupId) => {
              if (!targetGroupId) activatePage(page.id);
              dispatch({ type: 'MOVE_TAB_TO_NEW_GROUP', groupId, tabId, direction, targetGroupId });
            }}
          />
        ))}
      </div>
      <div data-tauri-drag-region="false" className="shrink-0">
        <NewTabMenu
          groupId={state.activeGroupId}
          triggerClassName="rounded-[var(--radius-control)]"
          onOpenSavedConnection={onOpenSavedConnection}
          onNewConnection={onNewTab}
          onNewLocalTerminal={onNewLocalTab}
        />
      </div>
    </div>
  );
}

function PageSegment({
  page,
  active,
  sessions,
  onActivate,
  onFocusGroup,
  onClose,
  onDuplicateTab,
  onReconnect,
  onMoveToNewGroup,
}: {
  page: WorkspacePage;
  active: boolean;
  sessions: PaneSession[];
  onActivate: () => void;
  onFocusGroup: (groupId: string) => void;
  onClose: (groupId: string, tabId: string) => void;
  onDuplicateTab?: (tabId: string) => void;
  onReconnect?: (tabId: string) => void;
  onMoveToNewGroup: (groupId: string, tabId: string, direction: SplitDirection, targetGroupId?: string) => void;
}) {
  const { t } = useTranslation();
  const owner = sessions.find((session) => session.groupId === page.activeGroupId) ?? null;
  const summary = !owner && sessions.length > 0;
  const split = sessions.length > 1;
  const onPointerDown = useSplitDrag(
    owner ? { groupId: owner.groupId, tabId: owner.tab.id, name: owner.tab.name } : null,
    (direction, targetGroupId) => {
      if (!owner) return;
      onMoveToNewGroup(owner.groupId, owner.tab.id, direction, targetGroupId);
    },
  );
  if (sessions.length === 0) return null;

  const tone = active
    ? 'titlebar-tab-active font-medium text-foreground'
    : 'titlebar-tab-idle text-muted-foreground';

  if (summary) {
    return (
      <div
        data-page-id={page.id}
        data-split-summary
        className={`terminal-tab relative box-border flex h-7 min-w-0 flex-1 basis-0 items-stretch overflow-hidden rounded-[var(--radius-control)] border border-transparent font-medium text-foreground ${active ? 'titlebar-tab-active' : ''}`}
        onClick={onActivate}
      >
        <SplitSessionLabels sessions={sessions} onFocusGroup={onFocusGroup} />
      </div>
    );
  }

  const primary = owner ?? sessions[0];
  const capsule = split ? (
    <div
      data-page-id={page.id}
      data-tab-id={primary.tab.id}
      data-tauri-drag-region="false"
      title={sessions.map((session) => getTabDisplayName(session.tab, session.tabs)).join(' · ')}
      className={`terminal-tab group relative box-border flex h-7 min-w-0 cursor-pointer select-none items-stretch overflow-hidden rounded-[var(--radius-control)] border border-transparent ${tone}`}
      style={{ flexGrow: sessions.length, flexBasis: 0, minWidth: `${sessions.length * 4.5}rem` }}
      onPointerDown={onPointerDown}
      onClick={onActivate}
    >
      <SplitSessionLabels
        sessions={sessions}
        ownerGroupId={primary.groupId}
        onFocusGroup={onFocusGroup}
        renderOwnerChrome={(tab) => (
          <OwnerChrome tab={tab} tabs={primary.tabs} onClose={() => onClose(primary.groupId, tab.id)} />
        )}
      />
    </div>
  ) : (
    <div
      data-page-id={page.id}
      data-tab-id={primary.tab.id}
      data-tauri-drag-region="false"
      title={tabTooltip(primary.tab, getTabDisplayName(primary.tab, primary.tabs), t(`statusBar.${primary.tab.connectionStatus}`))}
      className={`terminal-tab group relative box-border flex h-7 min-w-[4.5rem] flex-1 basis-0 cursor-pointer select-none items-center justify-center gap-1.5 overflow-hidden rounded-[var(--radius-control)] border border-transparent px-2.5 ${tone}`}
      onPointerDown={onPointerDown}
      onClick={onActivate}
    >
      <OwnerChrome tab={primary.tab} tabs={primary.tabs} onClose={() => onClose(primary.groupId, primary.tab.id)} />
      <button
        type="button"
        data-tauri-drag-region="false"
        aria-pressed={active}
        className="flex w-full min-w-0 items-center justify-center gap-1.5 rounded-sm px-7 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <SessionName tab={primary.tab} tabs={primary.tabs} />
      </button>
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{capsule}</ContextMenuTrigger>
      <ContextMenuContent>
        {onReconnect && (
          <>
            <ContextMenuItem onClick={() => onReconnect(primary.tab.id)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('contextMenu.reconnect')}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {onDuplicateTab && (
          <>
            <ContextMenuItem onClick={() => onDuplicateTab(primary.tab.id)}>
              <Copy className="mr-2 h-4 w-4" />
              {t('contextMenu.duplicateTab')}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={() => onClose(primary.groupId, primary.tab.id)}>
          <X className="mr-2 h-4 w-4" />
          {t('contextMenu.closeTab')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <MoveRight className="mr-2 h-4 w-4" />
            {t('contextMenu.moveTabToNewGroup')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {([
              ['right', ArrowRight, 'common.right'],
              ['left', ArrowLeft, 'common.left'],
              ['down', ArrowDown, 'common.down'],
              ['up', ArrowUp, 'common.up'],
            ] as const).map(([direction, Icon, label]) => (
              <ContextMenuItem
                key={direction}
                onClick={() => onMoveToNewGroup(primary.groupId, primary.tab.id, direction)}
              >
                <Icon className="mr-2 h-4 w-4" />
                {t(label)}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SessionName({ tab, tabs }: { tab: TerminalTab; tabs: TerminalTab[] }) {
  const { t } = useTranslation();
  return (
    <>
      {tab.connectionStatus !== 'connected' && (
        <StatusDot variant={tab.connectionStatus} aria-label={t(`statusBar.${tab.connectionStatus}`)} />
      )}
      <span className="min-w-0 truncate text-center text-[length:var(--text-body)] leading-none">
        {getTabDisplayName(tab, tabs)}
      </span>
    </>
  );
}

function OwnerChrome({ tab, tabs, onClose }: { tab: TerminalTab; tabs: TerminalTab[]; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <span className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2">
      <span className="group-hover:invisible group-focus-within:invisible">{tabIcon(tab)}</span>
      <Button
        variant="ghost"
        size="toolbar"
        data-tauri-drag-region="false"
        className="absolute inset-0 size-3.5 shrink-0 rounded-sm p-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
        aria-label={t('menuBar.closeTabNamed', { name: getTabDisplayName(tab, tabs) })}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <X className="size-3" />
      </Button>
    </span>
  );
}
