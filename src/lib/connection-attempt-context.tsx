import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type {
  ConnectDiagnosticResponse,
  ConnectStage,
} from './connection-diagnostics';
import { isConnectStage } from './connection-diagnostics';

export type ConnectionAttemptStatus =
  | 'connecting'
  | 'awaitingHostKey'
  | 'failed'
  | 'connected';

export interface ConnectionAttemptState {
  status: ConnectionAttemptStatus;
  currentStage: ConnectStage | null;
  failedStage: ConnectStage | null;
  errorKind: string | null;
  message: string | null;
}

type AttemptMap = Record<string, ConnectionAttemptState>;

type AttemptAction =
  | { type: 'BEGIN'; connectionId: string }
  | { type: 'PROGRESS'; connectionId: string; stage: ConnectStage }
  | { type: 'AWAIT_HOST_KEY'; connectionId: string }
  | { type: 'FAIL'; connectionId: string; response: ConnectDiagnosticResponse }
  | { type: 'CLEAR'; connectionId: string };

const initialAttempt: ConnectionAttemptState = {
  status: 'connecting',
  currentStage: null,
  failedStage: null,
  errorKind: null,
  message: null,
};

export function connectionAttemptReducer(state: AttemptMap, action: AttemptAction): AttemptMap {
  switch (action.type) {
    case 'BEGIN':
      return { ...state, [action.connectionId]: initialAttempt };
    case 'PROGRESS':
      return {
        ...state,
        [action.connectionId]: {
          ...(state[action.connectionId] ?? initialAttempt),
          status: action.stage === 'connected' ? 'connected' : 'connecting',
          currentStage: action.stage,
          failedStage: null,
          errorKind: null,
          message: null,
        },
      };
    case 'AWAIT_HOST_KEY':
      return {
        ...state,
        [action.connectionId]: {
          ...(state[action.connectionId] ?? initialAttempt),
          status: 'awaitingHostKey',
          currentStage: 'verifyingHostKey',
        },
      };
    case 'FAIL': {
      const fallbackStage = state[action.connectionId]?.currentStage ?? null;
      const failedStage = isConnectStage(action.response.failedStage)
        ? action.response.failedStage
        : fallbackStage;
      return {
        ...state,
        [action.connectionId]: {
          ...(state[action.connectionId] ?? initialAttempt),
          status: 'failed',
          failedStage,
          errorKind: action.response.errorKind ?? 'unknown',
          message: action.response.error?.trim() || null,
        },
      };
    }
    case 'CLEAR': {
      if (!(action.connectionId in state)) return state;
      const next = { ...state };
      delete next[action.connectionId];
      return next;
    }
  }
}

interface ConnectionAttemptContextValue {
  attempts: AttemptMap;
  beginAttempt: (connectionId: string) => void;
  reportStage: (connectionId: string, stage: ConnectStage) => void;
  awaitHostKey: (connectionId: string) => void;
  failAttempt: (connectionId: string, response: ConnectDiagnosticResponse) => void;
  clearAttempt: (connectionId: string) => void;
}

const noop = () => undefined;
const defaultContext: ConnectionAttemptContextValue = {
  attempts: {},
  beginAttempt: noop,
  reportStage: noop,
  awaitHostKey: noop,
  failAttempt: noop,
  clearAttempt: noop,
};

const ConnectionAttemptContext = createContext<ConnectionAttemptContextValue>(defaultContext);

export function ConnectionAttemptProvider({ children }: { children: ReactNode }) {
  const [attempts, dispatch] = useReducer(connectionAttemptReducer, {});
  const beginAttempt = useCallback((connectionId: string) => {
    dispatch({ type: 'BEGIN', connectionId });
  }, []);
  const reportStage = useCallback((connectionId: string, stage: ConnectStage) => {
    dispatch({ type: 'PROGRESS', connectionId, stage });
  }, []);
  const awaitHostKey = useCallback((connectionId: string) => {
    dispatch({ type: 'AWAIT_HOST_KEY', connectionId });
  }, []);
  const failAttempt = useCallback((connectionId: string, response: ConnectDiagnosticResponse) => {
    dispatch({ type: 'FAIL', connectionId, response });
  }, []);
  const clearAttempt = useCallback((connectionId: string) => {
    dispatch({ type: 'CLEAR', connectionId });
  }, []);

  const value = useMemo(() => ({
    attempts,
    beginAttempt,
    reportStage,
    awaitHostKey,
    failAttempt,
    clearAttempt,
  }), [attempts, beginAttempt, reportStage, awaitHostKey, failAttempt, clearAttempt]);

  return (
    <ConnectionAttemptContext.Provider value={value}>
      {children}
    </ConnectionAttemptContext.Provider>
  );
}

export function useConnectionAttempts(): ConnectionAttemptContextValue {
  return useContext(ConnectionAttemptContext);
}
