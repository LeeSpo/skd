import React, { useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Copy, RefreshCw, ArrowLeft, ArrowRight, XCircle, ArrowUp, ArrowDown, MoveRight, FolderSync, Terminal, FileCode } from 'lucide-react';
import type { TerminalTab, SplitDirection } from '../../lib/terminal-group-types';
import { getTabDisplayName } from '../../lib/terminal-group-utils';
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

// ── Component ──

interface GroupTabBarProps {
  groupId: string;
  tabs: TerminalTab[];
  activeTabId: string | null;
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
  onNewConnection,
  onNewLocalTerminal,
  onOpenSavedConnection,
  onDuplicateTab,
  onReconnect,
}: GroupTabBarProps) {
  const { t } = useTranslation();
  const { dispatch } = useTerminalGroups();
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

  const { onTabClose } = useTerminalCallbacks();

  const handleTabClose = useCallback(
    (tabId: string) => {
      void onTabClose?.(tabId);
      dispatch({ type: 'REMOVE_TAB', groupId, tabId });
    },
    [dispatch, groupId, onTabClose],
  );

  const handleTabSelect = useCallback(
    (tabId: string) => {
      dispatch({ type: 'ACTIVATE_TAB', groupId, tabId });
    },
    [dispatch, groupId],
  );

  const handleMoveToNewGroup = useCallback(
    (tabId: string, direction: SplitDirection) => {
      dispatch({ type: 'MOVE_TAB_TO_NEW_GROUP', groupId, tabId, direction });
    },
    [dispatch, groupId],
  );

  return (
    <>
      <div className="flex h-8 shrink-0 items-center border-b border-panel-border bg-panel-toolbar">
        <div
          ref={tabBarRef}
          data-tab-bar-group={groupId}
          className={`relative flex h-full flex-1 items-center overflow-x-auto transition-colors ${
            isDragOver ? 'bg-accent/40' : ''
          }`}
        >
          {tabs.map((tab, index) => (
            <React.Fragment key={tab.id}>
              {/* Insertion indicator line */}
              {dropIndex === index && (
                <div className="w-0.5 h-4 bg-primary shrink-0" />
              )}
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    data-tab-id={tab.id}
                    className={`group box-border flex h-full min-w-0 cursor-pointer select-none items-center gap-1.5 border-r border-t-2 border-panel-border px-2.5 outline-none focus:outline-none focus-visible:outline-none ${
                      tab.id === activeTabId
                        ? 'border-t-primary bg-surface-raised text-foreground'
                        : 'border-t-transparent text-muted-foreground hover:bg-surface-hover hover:text-foreground'
                    } ${activeDrag?.tabId === tab.id ? 'opacity-40' : ''}`}
                    onPointerDown={(e) => handlePointerDown(e, tab.id, tab.name)}
                    onDragStart={handleNativeDragStart}
                    draggable={false}
                    onClick={() => handleTabSelect(tab.id)}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      {tab.tabType === 'file-browser' ? (
                        <FolderSync className="h-3.5 w-3.5 shrink-0 text-warning" />
                      ) : tab.tabType === 'editor' ? (
                        <FileCode className="h-3.5 w-3.5 shrink-0 text-success" />
                      ) : (
                        <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <StatusDot
                        variant={
                          tab.connectionStatus === 'connected'
                            ? 'connected'
                            : tab.connectionStatus === 'connecting'
                              ? 'connecting'
                              : 'disconnected'
                        }
                      />
                      <span className="truncate text-sm leading-none">{getTabDisplayName(tab, tabs)}</span>
                    </div>

                    <Button
                      variant="ghost"
                      size="toolbar"
                      className="size-4 opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTabClose(tab.id);
                      }}
                    >
                      <X className="w-3 h-3" />
                    </Button>
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
                    <ContextMenuItem onClick={() => dispatch({ type: 'CLOSE_OTHER_TABS', groupId, tabId: tab.id })}>
                      <XCircle className="mr-2 h-4 w-4" />
                      {t('contextMenu.closeOtherTabs')}
                    </ContextMenuItem>
                  )}
                  {/* Close to Right */}
                  {index < tabs.length - 1 && (
                    <ContextMenuItem onClick={() => dispatch({ type: 'CLOSE_TABS_TO_RIGHT', groupId, tabId: tab.id })}>
                      <ArrowRight className="mr-2 h-4 w-4" />
                      {t('contextMenu.closeTabsToRight')}
                    </ContextMenuItem>
                  )}
                  {/* Close to Left */}
                  {index > 0 && (
                    <ContextMenuItem onClick={() => dispatch({ type: 'CLOSE_TABS_TO_LEFT', groupId, tabId: tab.id })}>
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
          ))}
          {/* Insertion indicator at the end */}
          {dropIndex === tabs.length && (
            <div className="w-0.5 h-4 bg-primary shrink-0" />
          )}
        </div>

        <NewTabMenu
          groupId={groupId}
          onOpenSavedConnection={onOpenSavedConnection}
          onNewConnection={onNewConnection}
          onNewLocalTerminal={onNewLocalTerminal}
        />
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
