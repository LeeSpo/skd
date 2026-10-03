import React, { useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Copy, RefreshCw, ArrowLeft, ArrowRight, XCircle, ArrowUp, ArrowDown, MoveRight, FolderSync, Terminal, FileCode } from 'lucide-react';
import type { TerminalTab, SplitDirection } from '../../lib/terminal-group-types';
import type { PaneSession } from '../../lib/visible-pane-sessions';
import { getTabDisplayName } from '../../lib/terminal-group-utils';
import { tabTooltip } from '../../lib/session-chrome';
import { useTerminalGroups } from '../../lib/terminal-group-context';
import { useTerminalCallbacks } from '../../lib/terminal-callbacks-context';
import {
  calcTabInsertionIndex,
  clearTabDrag,
  findContentDropTargetAt,
  findTabBarDropTargetAt,
  getActiveDrag,
  getContentDropHover,
  registerTabBarDropTarget,
  setActiveDrag,
  setContentDropHover,
  subscribeTabDrag,
  unregisterTabBarDropTarget,
} from '../../lib/tab-drag-state';
import { getZoneFromPosition, isSplitDirection } from './drop-zone-overlay';
import { Button } from '../ui/button';
import { StatusDot } from '../ui/status-dot';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '../ui/context-menu';
import { NewTabMenu } from './new-tab-menu';
import { tabsRemovedByBulkClose } from '../../lib/session-close';

export function SplitSessionLabels({
  sessions,
  ownerGroupId,
  renderOwnerChrome,
  onFocusGroup,
}: {
  sessions: PaneSession[];
  ownerGroupId?: string;
  renderOwnerChrome?: (tab: TerminalTab) => React.ReactNode;
  onFocusGroup: (groupId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full min-w-0 items-stretch">
      {sessions.map((session, index) => {
        const owner = session.groupId === ownerGroupId;
        return (
          <div
            key={session.groupId}
            className={`relative flex min-w-0 flex-1 ${index > 0 ? 'border-l border-border' : ''}`}
          >
            {owner && renderOwnerChrome?.(session.tab)}
            <button
              type="button"
              data-tauri-drag-region="false"
              data-split-pane={session.groupId}
              aria-pressed={owner ? true : undefined}
              className={`flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${owner ? 'px-7' : 'px-2'}`}
              onPointerDown={owner ? undefined : (event) => event.stopPropagation()}
              onClick={owner ? undefined : (event) => {
                event.stopPropagation();
                onFocusGroup(session.groupId);
              }}
            >
              {session.tab.connectionStatus !== 'connected' && (
                <StatusDot
                  variant={session.tab.connectionStatus}
                  aria-label={t(`statusBar.${session.tab.connectionStatus}`)}
                />
              )}
              <span className="min-w-0 truncate text-center text-[13px] leading-none">
                {getTabDisplayName(session.tab, session.tabs)}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Component ──

interface GroupTabBarProps {
  groupId: string;
  tabs: TerminalTab[];
  activeTabId: string | null;
  /** `titlebar` fills the window toolbar. `pane` is only used when that slot is absent. */
  variant?: 'titlebar' | 'pane';
  /** This pane has keyboard focus. An unfocused pane keeps its visible tab readable, without the raised fill. */
  focused?: boolean;
  /** Hide the new-tab button on a bar that is not the place a new session should land. */
  showNewTab?: boolean;
  /** Visible sessions across the split, in pane order. Drawn inside the active segment. */
  splitSessions?: PaneSession[];
  onNewConnection?: () => void;
  onNewLocalTerminal?: () => void | Promise<void>;
  onOpenSavedConnection?: (connectionId: string, targetGroupId: string) => void | Promise<void>;
  onDuplicateTab?: (tabId: string) => void;
  onReconnect?: (tabId: string) => void;
}

function useActiveDrag() {
  return useSyncExternalStore(subscribeTabDrag, getActiveDrag, getActiveDrag);
}

export function GroupTabBar({
  groupId,
  tabs,
  activeTabId,
  variant = 'pane',
  focused = true,
  showNewTab = true,
  splitSessions,
  onNewConnection,
  onNewLocalTerminal,
  onOpenSavedConnection,
  onDuplicateTab,
  onReconnect,
}: GroupTabBarProps) {
  const { t } = useTranslation();
  const { state, dispatch } = useTerminalGroups();
  const activeDrag = useActiveDrag();
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; name: string } | null>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef<number | null>(null);

  // Register this tab bar container as a drop target
  useEffect(() => {
    const el = tabBarRef.current;
    if (el) {
      registerTabBarDropTarget(groupId, el);
      return () => {
        unregisterTabBarDropTarget(groupId);
      };
    }
  }, [groupId]);

  // Clear local indicators when global drag ends (including when another bar owns the drag)
  useEffect(() => {
    const unsub = subscribeTabDrag(() => {
      if (!getActiveDrag()) {
        setDropIndex(null);
        setIsDragOver(false);
        setDragGhost(null);
        if (autoScrollRef.current !== null) {
          cancelAnimationFrame(autoScrollRef.current);
          autoScrollRef.current = null;
        }
      }
    });
    return unsub;
  }, []);

  // ── Pointer-based custom drag ──

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, tabId: string, tabName: string) => {
      if (e.button !== 0) return; // left click only
      e.preventDefault(); // prevent native drag ghost + text selection

      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      const DRAG_THRESHOLD = 5;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        if (!dragging) {
          if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
          dragging = true;
          setActiveDrag({ tabId, sourceGroupId: groupId, tabName });
          document.body.style.userSelect = 'none';
        }

        // Update ghost position
        setDragGhost({ x: ev.clientX, y: ev.clientY, name: tabName });

        // 1) Prefer tab-bar hit (reorder / move into group)
        const tabBarTarget = findTabBarDropTargetAt(ev.clientX, ev.clientY);
        if (tabBarTarget) {
          setContentDropHover(null);
          const idx = calcTabInsertionIndex(tabBarTarget.element, ev.clientX);
          if (tabBarTarget.groupId === groupId) {
            setIsDragOver(true);
            setDropIndex(idx);
          } else {
            // Different group — target bar owns its insertion line via hit-test on pointerup;
            // we still clear our local indicator.
            setIsDragOver(false);
            setDropIndex(null);
          }

          // Auto-scroll the target tab bar near edges
          const rect = tabBarTarget.element.getBoundingClientRect();
          const EDGE_THRESHOLD = 50;
          const SCROLL_SPEED = 8;

          if (autoScrollRef.current !== null) {
            cancelAnimationFrame(autoScrollRef.current);
            autoScrollRef.current = null;
          }
          if (ev.clientX < rect.left + EDGE_THRESHOLD) {
            autoScrollRef.current = requestAnimationFrame(() => {
              tabBarTarget.element.scrollLeft -= SCROLL_SPEED;
            });
          } else if (ev.clientX > rect.right - EDGE_THRESHOLD) {
            autoScrollRef.current = requestAnimationFrame(() => {
              tabBarTarget.element.scrollLeft += SCROLL_SPEED;
            });
          }
          return;
        }

        // 2) Content area hit → edge split / center merge
        if (autoScrollRef.current !== null) {
          cancelAnimationFrame(autoScrollRef.current);
          autoScrollRef.current = null;
        }
        setIsDragOver(false);
        setDropIndex(null);

        const contentTarget = findContentDropTargetAt(ev.clientX, ev.clientY);
        if (contentTarget) {
          const rect = contentTarget.element.getBoundingClientRect();
          const zone = getZoneFromPosition(ev.clientX, ev.clientY, rect);
          setContentDropHover({ groupId: contentTarget.groupId, zone });
        } else {
          setContentDropHover(null);
        }
      };

      const onUp = (ev: PointerEvent | FocusEvent) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        window.removeEventListener('blur', onUp);
        document.body.style.userSelect = '';

        if (autoScrollRef.current !== null) {
          cancelAnimationFrame(autoScrollRef.current);
          autoScrollRef.current = null;
        }

        if (!dragging || !getActiveDrag()) {
          clearTabDrag();
          setDragGhost(null);
          setDropIndex(null);
          setIsDragOver(false);
          return;
        }

        const clientX = 'clientX' in ev ? ev.clientX : 0;
        const clientY = 'clientY' in ev ? ev.clientY : 0;
        const drag = getActiveDrag();
        if (!drag) {
          clearTabDrag();
          setDragGhost(null);
          return;
        }

        const { tabId: dragTabId, sourceGroupId } = drag;

        // Prefer tab bar drops
        const dropTarget =
          clientX || clientY ? findTabBarDropTargetAt(clientX, clientY) : null;
        if (dropTarget) {
          const targetIndex = calcTabInsertionIndex(dropTarget.element, clientX);

          if (sourceGroupId === dropTarget.groupId) {
            const fromIndex = tabs.findIndex((t) => t.id === dragTabId);
            if (fromIndex !== -1) {
              const adjustedTarget = targetIndex > fromIndex ? targetIndex - 1 : targetIndex;
              if (adjustedTarget !== fromIndex) {
                dispatch({
                  type: 'REORDER_TAB',
                  groupId: sourceGroupId,
                  fromIndex,
                  toIndex: adjustedTarget,
                });
              }
            }
          } else {
            dispatch({
              type: 'MOVE_TAB',
              sourceGroupId,
              targetGroupId: dropTarget.groupId,
              tabId: dragTabId,
              targetIndex,
            });
          }
        } else {
          // Content-area drop: use last hover or re-hit-test
          const hover =
            getContentDropHover() ??
            (() => {
              if (!(clientX || clientY)) return null;
              const contentTarget = findContentDropTargetAt(clientX, clientY);
              if (!contentTarget) return null;
              const rect = contentTarget.element.getBoundingClientRect();
              const zone = getZoneFromPosition(clientX, clientY, rect);
              return { groupId: contentTarget.groupId, zone };
            })();

          if (hover) {
            if (isSplitDirection(hover.zone)) {
              dispatch({
                type: 'MOVE_TAB_TO_NEW_GROUP',
                groupId: sourceGroupId,
                tabId: dragTabId,
                direction: hover.zone,
                targetGroupId: hover.groupId,
              });
            } else if (hover.zone === 'center' && sourceGroupId !== hover.groupId) {
              dispatch({
                type: 'MOVE_TAB',
                sourceGroupId,
                targetGroupId: hover.groupId,
                tabId: dragTabId,
              });
            }
          }
        }

        clearTabDrag();
        setDragGhost(null);
        setDropIndex(null);
        setIsDragOver(false);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
      window.addEventListener('blur', onUp);
    },
    [groupId, tabs, dispatch],
  );

  // Suppress native dragstart in case browser tries to initiate HTML5 DnD
  const handleNativeDragStart = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const { onRequestCloseTabs } = useTerminalCallbacks();

  const requestCloseTabIds = useCallback(
    (tabIds: string[]) => {
      if (tabIds.length === 0) return;
      onRequestCloseTabs?.(tabIds.map((tabId) => ({ groupId, tabId })));
    },
    [groupId, onRequestCloseTabs],
  );

  const handleTabClose = useCallback(
    (tabId: string) => {
      requestCloseTabIds([tabId]);
    },
    [requestCloseTabIds],
  );

  const handleBulkClose = useCallback(
    (action: 'others' | 'left' | 'right', pivotTabId: string) => {
      requestCloseTabIds(tabsRemovedByBulkClose(tabs, action, pivotTabId));
    },
    [requestCloseTabIds, tabs],
  );

  const handleTabSelect = useCallback(
    (tabId: string) => {
      if (state.activeGroupId !== groupId) {
        dispatch({ type: 'ACTIVATE_GROUP', groupId });
      }
      dispatch({ type: 'ACTIVATE_TAB', groupId, tabId });
    },
    [dispatch, groupId, state.activeGroupId],
  );

  const handleMoveToNewGroup = useCallback(
    (tabId: string, direction: SplitDirection) => {
      dispatch({ type: 'MOVE_TAB_TO_NEW_GROUP', groupId, tabId, direction });
    },
    [dispatch, groupId],
  );

  const titlebar = variant === 'titlebar';

  const tabIcon = (tab: TerminalTab) => (
    tab.tabType === 'file-browser' ? (
      <FolderSync className="size-3.5 shrink-0 text-muted-foreground" />
    ) : tab.tabType === 'editor' ? (
      <FileCode className="size-3.5 shrink-0 text-muted-foreground" />
    ) : (
      <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
    )
  );

  const closeButton = (tab: TerminalTab) => (
    <Button
      variant="ghost"
      size="toolbar"
      data-tauri-drag-region="false"
      className="absolute inset-0 size-3.5 shrink-0 rounded-sm p-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
      aria-label={t('menuBar.closeTabNamed', { name: getTabDisplayName(tab, tabs) })}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        handleTabClose(tab.id);
      }}
    >
      <X className="size-3" />
    </Button>
  );

  return (
    <>
      <div
        data-variant={variant}
        data-tauri-drag-region={titlebar ? true : undefined}
        className={
          titlebar
            ? 'terminal-tab-strip flex h-full w-full min-w-0 items-center px-1'
            : 'terminal-tab-strip flex h-9 w-full min-w-0 shrink-0 items-center bg-workspace px-1'
        }
      >
        <div
          ref={tabBarRef}
          data-tab-bar-group={groupId}
          data-tauri-drag-region={titlebar ? true : undefined}
          className={`relative flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto ${isDragOver ? 'bg-surface-hover' : ''}`}
        >
          {tabs.length === 0 && splitSessions && splitSessions.length > 0 && (
            <div
              data-split-summary
              className="terminal-tab relative box-border flex h-7 min-w-0 flex-1 basis-0 items-stretch overflow-hidden rounded-[var(--radius-control)] border border-transparent font-medium text-foreground titlebar-tab-active"
            >
              <SplitSessionLabels
                sessions={splitSessions}
                onFocusGroup={(nextGroupId) => dispatch({ type: 'ACTIVATE_GROUP', groupId: nextGroupId })}
              />
            </div>
          )}
          {tabs.map((tab, index) => {
            const splitColumns = tab.id === activeTabId && splitSessions && splitSessions.length > 1
              ? splitSessions
              : null;
            return (
            <React.Fragment key={tab.id}>
              {/* Insertion indicator line */}
              {dropIndex === index && (
                <div className="w-px h-4 bg-primary shrink-0" />
              )}
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    data-tab-id={tab.id}
                    data-tauri-drag-region="false"
                    title={splitColumns
                      ? splitColumns.map((session) => getTabDisplayName(session.tab, session.tabs)).join(' · ')
                      : tabTooltip(tab, getTabDisplayName(tab, tabs), t(`statusBar.${tab.connectionStatus}`))}
                    className={`terminal-tab group relative box-border flex h-7 cursor-pointer select-none items-center overflow-hidden rounded-[var(--radius-control)] border border-transparent ${
                      splitColumns ? 'min-w-0' : 'min-w-[4.5rem] flex-1 basis-0 justify-center gap-1.5 px-2.5'
                    } ${
                      tab.id === activeTabId
                        ? focused
                          ? 'titlebar-tab-active font-medium text-foreground'
                          : 'font-medium text-foreground'
                        : 'titlebar-tab-idle text-muted-foreground'
                    } ${activeDrag?.tabId === tab.id ? 'opacity-40' : ''}`}
                    style={splitColumns ? { flexGrow: splitColumns.length, flexBasis: 0, minWidth: `${splitColumns.length * 4.5}rem` } : undefined}
                    onPointerDown={(e) => handlePointerDown(e, tab.id, tab.name)}
                    onDragStart={handleNativeDragStart}
                    draggable={false}
                    onClick={() => handleTabSelect(tab.id)}
                  >
                    {splitColumns ? (
                      <SplitSessionLabels
                        sessions={splitColumns}
                        ownerGroupId={groupId}
                        onFocusGroup={(nextGroupId) => dispatch({ type: 'ACTIVATE_GROUP', groupId: nextGroupId })}
                        renderOwnerChrome={(owner) => (
                          <span className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2">
                            <span className="group-hover:invisible group-focus-within:invisible">
                              {tabIcon(owner)}
                            </span>
                            {closeButton(owner)}
                          </span>
                        )}
                      />
                    ) : (
                      <>
                        <span className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2">
                          <span className="group-hover:invisible group-focus-within:invisible">
                            {tabIcon(tab)}
                          </span>
                          {closeButton(tab)}
                        </span>
                        <button
                          type="button"
                          data-tauri-drag-region="false"
                          aria-pressed={tab.id === activeTabId}
                          className="flex w-full min-w-0 items-center justify-center gap-1.5 rounded-sm px-7 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {tab.connectionStatus !== 'connected' && (
                            <StatusDot
                              variant={tab.connectionStatus}
                              aria-label={t(`statusBar.${tab.connectionStatus}`)}
                            />
                          )}
                          <span className="min-w-0 truncate text-center text-[13px] leading-none">{getTabDisplayName(tab, tabs)}</span>
                        </button>
                      </>
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  {/* Reconnect when disconnected */}
                  {onReconnect && (
                    <>
                      <ContextMenuItem onClick={() => onReconnect(tab.id)}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        {t('contextMenu.reconnect')}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                    </>
                  )}
                  {/* Duplicate */}
                  {onDuplicateTab && (
                    <>
                      <ContextMenuItem onClick={() => onDuplicateTab(tab.id)}>
                        <Copy className="mr-2 h-4 w-4" />
                        {t('contextMenu.duplicateTab')}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                    </>
                  )}
                  {/* Close */}
                  <ContextMenuItem onClick={() => handleTabClose(tab.id)}>
                    <X className="mr-2 h-4 w-4" />
                    {t('contextMenu.closeTab')}
                  </ContextMenuItem>
                  {/* Close Others */}
                  {tabs.length > 1 && (
                    <ContextMenuItem onClick={() => handleBulkClose('others', tab.id)}>
                      <XCircle className="mr-2 h-4 w-4" />
                      {t('contextMenu.closeOtherTabs')}
                    </ContextMenuItem>
                  )}
                  {/* Close to Right */}
                  {index < tabs.length - 1 && (
                    <ContextMenuItem onClick={() => handleBulkClose('right', tab.id)}>
                      <ArrowRight className="mr-2 h-4 w-4" />
                      {t('contextMenu.closeTabsToRight')}
                    </ContextMenuItem>
                  )}
                  {/* Close to Left */}
                  {index > 0 && (
                    <ContextMenuItem onClick={() => handleBulkClose('left', tab.id)}>
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      {t('contextMenu.closeTabsToLeft')}
                    </ContextMenuItem>
                  )}
                  <ContextMenuSeparator />
                  {/* Move to New Group submenu */}
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <MoveRight className="mr-2 h-4 w-4" />
                      {t('contextMenu.moveTabToNewGroup')}
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      <ContextMenuItem onClick={() => handleMoveToNewGroup(tab.id, 'right')}>
                        <ArrowRight className="mr-2 h-4 w-4" />
                          {t('common.right')}
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleMoveToNewGroup(tab.id, 'left')}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                          {t('common.left')}
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleMoveToNewGroup(tab.id, 'down')}>
                        <ArrowDown className="mr-2 h-4 w-4" />
                          {t('common.down')}
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleMoveToNewGroup(tab.id, 'up')}>
                        <ArrowUp className="mr-2 h-4 w-4" />
                          {t('common.up')}
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                </ContextMenuContent>
              </ContextMenu>
            </React.Fragment>
            );
          })}
          {/* Insertion indicator at the end */}
          {dropIndex === tabs.length && (
            <div className="w-px h-4 bg-primary shrink-0" />
          )}
        </div>

        {showNewTab && (
          <div data-tauri-drag-region="false" className="shrink-0">
            <NewTabMenu
              groupId={groupId}
              triggerClassName="rounded-[var(--radius-control)]"
              onOpenSavedConnection={onOpenSavedConnection}
              onNewConnection={onNewConnection}
              onNewLocalTerminal={onNewLocalTerminal}
            />
          </div>
        )}
      </div>

      {/* Floating drag ghost — rendered via portal-like fixed positioning */}
      {dragGhost && (
        <div
          className="fixed z-[9999] pointer-events-none px-3 py-1.5 bg-background border border-primary rounded-md shadow-lg text-sm flex items-center gap-2"
          style={{
            left: dragGhost.x + 12,
            top: dragGhost.y - 16,
            userSelect: 'none',
          }}
        >
          <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate max-w-[200px]">{dragGhost.name}</span>
        </div>
      )}
    </>
  );
}
