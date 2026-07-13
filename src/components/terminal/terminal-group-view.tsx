import { lazy, Suspense, useCallback, useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useTerminalGroups } from '../../lib/terminal-group-context';
import { useTerminalCallbacks } from '../../lib/terminal-callbacks-context';
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

function useThemeKey(): number {
  const [themeKey, setThemeKey] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'class') {
          setThemeKey((k) => k + 1);
          break;
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  return themeKey;
}

function useActiveDrag() {
  return useSyncExternalStore(subscribeTabDrag, getActiveDrag, getActiveDrag);
}

function useContentDropHover() {
  return useSyncExternalStore(subscribeTabDrag, getContentDropHover, getContentDropHover);
}

export function TerminalGroupView({ groupId }: TerminalGroupViewProps) {
  const { t } = useTranslation();
  const { state, dispatch } = useTerminalGroups();
  const {
    onDuplicateTab,
    onNewTab,
    onReconnectTab,
    onEditConnection,
    onOpenInEditorForTab,
  } = useTerminalCallbacks();
  const { attempts } = useConnectionAttempts();
  const group = state.groups[groupId];
  const isActive = state.activeGroupId === groupId;
  const themeKey = useThemeKey();
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
        // Full reconnect: re-establishes the backend SSH/SFTP session
        // before remounting the terminal (App.tsx dispatches RECONNECT_TAB on success).
        void onReconnectTab(tabId);
      } else {
        // Fallback: just remount the terminal component.
        dispatch({ type: 'RECONNECT_TAB', tabId });
      }
    },
    [dispatch, onReconnectTab],
  );

  const handleConnectionStatusChange = useCallback(
    (connectionId: string, status: 'connected' | 'connecting' | 'disconnected' | 'pending') => {
      dispatch({ type: 'UPDATE_TAB_STATUS', tabId: connectionId, status });
    },
    [dispatch],
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
      className="flex h-full w-full flex-col"
      onMouseDownCapture={handleMouseDown}
      onKeyDown={handleKeyDown}
      aria-label={`Terminal group ${groupId}`}
    >
      <GroupTabBar
        groupId={groupId}
        tabs={group.tabs}
        activeTabId={group.activeTabId}
        onReconnect={handleReconnect}
        onDuplicateTab={onDuplicateTab}
        onNewTab={onNewTab}
      />
      <div
        ref={contentRef}
        data-group-content={groupId}
        className={`relative min-h-0 flex-1 overflow-hidden ${
          isActive ? 'ring-inset ring-1 ring-border/50' : ''
        }`}
      >
        {showWelcome ? (
          <WelcomeScreen onNewConnection={() => {}} onOpenSettings={() => {}} />
        ) : (
          group.tabs.map((tab) => {
            const attempt = tab.protocol === 'SSH' ? attempts[tab.id] : undefined;
            const showProgress = attempt
              && attempt.status !== 'connected'
              && attempt.status !== 'failed';
            return (
              <div
                key={tab.id}
                className="absolute inset-0"
                style={{ display: tab.id === group.activeTabId ? 'block' : 'none' }}
              >
                {attempt?.status === 'failed' ? (
                  <ConnectionFailureView
                    attempt={attempt}
                    onRetry={() => handleReconnect(tab.id)}
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
                            onReconnect={() => handleReconnect(tab.id)}
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
                            isActive={isActive && tab.id === group.activeTabId}
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
          })
        )}
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
