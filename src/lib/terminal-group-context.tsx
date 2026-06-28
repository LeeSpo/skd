import React, { createContext, useContext, useReducer, useEffect, useRef, useMemo } from 'react';
import type { TerminalGroupState, TerminalGroupAction, TerminalGroup, TerminalTab } from './terminal-group-types';
import { terminalGroupReducer, createDefaultState } from './terminal-group-reducer';
import { migrateFromLegacy, STORAGE_KEY } from './terminal-group-serializer';

interface TerminalGroupContextType {
  state: TerminalGroupState;
  dispatch: React.Dispatch<TerminalGroupAction>;
  /** 当前活动组 */
  activeGroup: TerminalGroup | null;
  /** 当前活动标签页 */
  activeTab: TerminalTab | null;
  /** 当前活动连接信息（驱动面板联动） */
  activeConnection: {
    connectionId: string;
    name: string;
    protocol: string;
    host?: string;
    username?: string;
    status: 'connected' | 'connecting' | 'disconnected' | 'pending';
  } | null;
}

const TerminalGroupContext = createContext<TerminalGroupContextType | null>(null);

function initializeState(): TerminalGroupState {
  migrateFromLegacy();
  localStorage.removeItem(STORAGE_KEY);
  return createDefaultState();
}

export function TerminalGroupProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(terminalGroupReducer, undefined, initializeState);

  const prevGroupCountRef = useRef(Object.keys(state.groups).length);

  // When the number of groups changes (split/merge), fire window resize events
  // so all PtyTerminal instances refit to their new container dimensions.
  // Multiple staggered events ensure the terminal catches the final layout size
  // after react-resizable-panels finishes its CSS transitions.
  useEffect(() => {
    const groupCount = Object.keys(state.groups).length;
    if (groupCount !== prevGroupCountRef.current) {
      prevGroupCountRef.current = groupCount;
      const delays = [50, 150, 300];
      const timers = delays.map(ms =>
        setTimeout(() => window.dispatchEvent(new Event('resize')), ms)
      );
      return () => timers.forEach(clearTimeout);
    }
  }, [state.groups]);

  const contextValue = useMemo(() => {
    const activeGroup = state.groups[state.activeGroupId] ?? null;
    const activeTab = activeGroup?.tabs.find((t) => t.id === activeGroup.activeTabId) ?? null;
    const activeConnection = activeTab
      ? {
          connectionId: activeTab.id,
          name: activeTab.name,
          protocol: activeTab.protocol ?? '',
          host: activeTab.host,
          username: activeTab.username,
          status: activeTab.connectionStatus,
        }
      : null;

    return { state, dispatch, activeGroup, activeTab, activeConnection };
  }, [state]);

  return (
    <TerminalGroupContext.Provider value={contextValue}>
      {children}
    </TerminalGroupContext.Provider>
  );
}

export function useTerminalGroups(): TerminalGroupContextType {
  const context = useContext(TerminalGroupContext);
  if (!context) {
    throw new Error('useTerminalGroups must be used within a TerminalGroupProvider');
  }
  return context;
}