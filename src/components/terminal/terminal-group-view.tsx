import { lazy, Suspense, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useTerminalGroups } from '../../lib/terminal-group-context';
import type { TerminalTab } from '../../lib/terminal-group-types';
import { useTerminalCallbacks } from '../../lib/terminal-callbacks-context';
import { useTerminalThemeKey } from '../../lib/use-terminal-theme-key';
import {
  getActiveDrag,
  getContentDropHover,
  registerContentDropTarget,
  subscribeTabDrag,
  unregisterContentDropTarget,
} from '../../lib/tab-drag-state';
import { DropZoneOverlay } from './drop-zone-overlay';
import { GroupTabBar } from './group-tab-bar';
import { PanelSurfaceFallback } from '../ui/panel-chrome';
import { WelcomeScreen } from '../welcome-screen';
import { useConnectionAttempts } from '../../lib/connection-attempt-context';
import { ConnectionFailureView, ConnectionProgressSegments } from '../connection-progress';

interface TerminalGroupViewProps {
  groupId: string;
  /** Stable grids render tab bodies in a separate tab-keyed layer. */
  renderTabContents?: boolean;
}

const PtyTerminal = lazy(() => import('../pty-terminal').then((module) => ({
  default: module.PtyTerminal,
})));
const FileBrowserView = lazy(() => import('../file-browser-view').then((module) => ({
  default: module.FileBrowserView,
})));
const FileEditorView = lazy(() => import('../file-editor-view').then((module) => ({
  default: module.FileEditorView,
})));

function useActiveDrag() {
  return useSyncExternalStore(subscribeTabDrag, getActiveDrag, getActiveDrag);
}

function useContentDropHover() {
  return useSyncExternalStore(subscribeTabDrag, getContentDropHover, getContentDropHover);
}

export interface TerminalTabSurfaceProps {
  tab: TerminalTab;
  isActive: boolean;
  themeKey: number;
}

/** A tab body whose identity is the tab id, independent of its terminal group. */
export function TerminalTabSurface({ tab, isActive, themeKey }: TerminalTabSurfaceProps) {
  const { t } = useTranslation();
  const { dispatch } = useTerminalGroups();
  const { onReconnectTab, onEditConnection, onOpenInEditorForTab } = useTerminalCallbacks();
  const { attempts } = useConnectionAttempts();

  const handleReconnect = useCallback(() => {
    if (onReconnectTab) {
      void onReconnectTab(tab.id);
    } else {
      dispatch({ type: 'RECONNECT_TAB', tabId: tab.id });
    }
  }, [dispatch, onReconnectTab, tab.id]);

  const handleConnectionStatusChange = useCallback(
    (connectionId: string, status: 'connected' | 'connecting' | 'disconnected' | 'pending') => {
      dispatch({ type: 'UPDATE_TAB_STATUS', tabId: connectionId, status });
    },
    [dispatch],
  );

  const attempt = tab.protocol === 'SSH' ? attempts[tab.id] : undefined;
  const showProgress = attempt
    && attempt.status !== 'connected'
    && attempt.status !== 'failed';

  return (
    <div data-terminal-tab-surface={tab.id} className="relative h-full w-full overflow-hidden">
      {attempt?.status === 'failed' ? (
        <ConnectionFailureView
          attempt={attempt}
          onRetry={handleReconnect}
          onEdit={() => onEditConnection?.(tab.id)}
        />
      ) : (
        <>
          {tab.connectionStatus !== 'pending' && (
            <Suspense fallback={<PanelSurfaceFallback />}>
              {tab.tabType === 'file-browser' ? (
                <FileBrowserView
                  connectionId={tab.id}
                  connectionName={tab.name}
                  host={tab.host}
                  protocol={tab.protocol}
                  isConnected={tab.connectionStatus === 'connected'}
                  onReconnect={handleReconnect}
                  onOpenInEditor={
                    tab.protocol === 'SFTP' && onOpenInEditorForTab
                      ? (filePath, fileName, options) =>
                          onOpenInEditorForTab(tab.id, filePath, fileName, options)
                      : undefined
                  }
                />
              ) : tab.tabType === 'editor' && tab.editorFilePath && tab.editorConnectionId ? (
                <FileEditorView
                  connectionId={tab.editorConnectionId}
                  filePath={tab.editorFilePath}
                  fileName={tab.name}
                  isConnected={tab.connectionStatus === 'connected'}
                />
              ) : (
                <PtyTerminal
                  key={`${tab.id}-${tab.reconnectCount}`}
                  connectionId={tab.id}
                  connectionName={tab.name}
                  host={tab.host}
                  username={tab.username}
                  themeKey={themeKey}
                  isActive={isActive}
                  onConnectionStatusChange={handleConnectionStatusChange}
                />
              )}
            </Suspense>
          )}
          {(showProgress || tab.connectionStatus === 'pending') && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/80 p-6 backdrop-blur-sm">
              <div className="w-full max-w-xl space-y-3 rounded-lg border bg-background p-5 shadow-sm">
                <div className="text-sm font-medium">
                  {t('connectionDiagnostics.connectingTo', { name: tab.name })}
                </div>
                {attempt ? (
                  <ConnectionProgressSegments attempt={attempt} />
                ) : (
                  <div className="animate-pulse text-sm text-muted-foreground">
                    {t('terminalGroup.waitingForConnection')}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function TerminalGroupView({ groupId, renderTabContents = true }: TerminalGroupViewProps) {
  const { state, dispatch } = useTerminalGroups();
  const {
    onDuplicateTab,
    onNewTab,
    onReconnectTab,
  } = useTerminalCallbacks();
  const group = state.groups[groupId];
  const isActive = state.activeGroupId === groupId;
  const themeKey = useTerminalThemeKey();
  const contentRef = useRef<HTMLDivElement>(null);
  const activeDrag = useActiveDrag();
  const contentDropHover = useContentDropHover();

  useEffect(() => {
    const el = contentRef.current;
    if (el) {
      registerContentDropTarget(groupId, el);
      return () => {
        unregisterContentDropTarget(groupId);
      };
    }
  }, [groupId]);

  const handleMouseDown = useCallback(() => {
    if (!isActive) {
      dispatch({ type: 'ACTIVATE_GROUP', groupId });
    }
  }, [dispatch, groupId, isActive]);

  const handleReconnect = useCallback(
    (tabId: string) => {
      if (onReconnectTab) {
        void onReconnectTab(tabId);
      } else {
        dispatch({ type: 'RECONNECT_TAB', tabId });
      }
    },
    [dispatch, onReconnectTab],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Don't intercept keys that originate from within the terminal.
      // xterm.js uses a hidden <textarea> for keyboard input; calling
      // preventDefault() here would block the character from reaching
      // the textarea, which breaks Space (and Enter) input – especially
      // when an IME is active (keyCode 229 path relies on the browser
      // inserting the character into the textarea).
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.closest('.xterm')) {
        return;
      }

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleMouseDown();
      }
    },
    [handleMouseDown]
  );

  if (!group) return null;

  const isLastGroup = Object.keys(state.groups).length === 1;
  const showWelcome = group.tabs.length === 0 && isLastGroup;

  return (
    <section
      data-group-id={groupId}
      data-testid={`terminal-group-view-${groupId}`}
      className={`flex h-full w-full flex-col ${renderTabContents ? '' : 'pointer-events-none'}`}
      onMouseDownCapture={handleMouseDown}
      onKeyDown={handleKeyDown}
      aria-label={`Terminal group ${groupId}`}
    >
      <div className={renderTabContents ? '' : 'pointer-events-auto'}>
        <GroupTabBar
          groupId={groupId}
          tabs={group.tabs}
          activeTabId={group.activeTabId}
          onReconnect={handleReconnect}
          onDuplicateTab={onDuplicateTab}
          onNewTab={onNewTab}
        />
      </div>
      <div
        ref={contentRef}
        data-group-content={groupId}
        className={`relative min-h-0 flex-1 overflow-hidden ${
          isActive ? 'ring-inset ring-1 ring-border/50' : ''
        }`}
      >
        {showWelcome ? (
          <WelcomeScreen onNewConnection={() => {}} onOpenSettings={() => {}} />
        ) : renderTabContents ? (
          group.tabs.map((tab) => {
            return (
              <div
                key={tab.id}
                className="absolute inset-0"
                style={{ display: tab.id === group.activeTabId ? 'block' : 'none' }}
              >
                <TerminalTabSurface
                  tab={tab}
                  themeKey={themeKey}
                  isActive={isActive && tab.id === group.activeTabId}
                />
              </div>
            );
          })
        ) : null}
        <DropZoneOverlay
          groupId={groupId}
          visible={activeDrag != null}
          activeZone={
            contentDropHover?.groupId === groupId ? contentDropHover.zone : null
          }
        />
      </div>
    </section>
  );
}
