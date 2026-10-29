import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ConnectionData } from '@/lib/connection-storage';
import { useConnectionAttempts } from '@/lib/connection-attempt-context';
import { useTerminalGroups } from '@/lib/terminal-group-context';
import { formatConnectError } from '@/lib/connection-diagnostics';
import { parseUnknownHostKeyError } from '@/lib/host-key-verification';
import { resolvePrivateKeyContent } from '@/lib/resolve-private-key';
import {
  cancelledConnectResponse,
  invokeFileConnectWithProgress,
  sftpConnectWithHostKeyTrust,
  type ConnectResponse,
  type HostKeyTrustRequest,
} from '@/lib/ssh-connect';

type FileConnectionConfig = Pick<ConnectionData,
  'protocol' | 'host' | 'port' | 'username' | 'authMethod' | 'password'
  | 'privateKeySource' | 'privateKeyPath' | 'privateKeyContent' | 'passphrase' | 'ftpsEnabled'>;

interface FileAttempt {
  controller: AbortController;
  operation: Promise<ConnectResponse>;
}

/** Own a file connection through progress, interactive trust, retries and tab closure. */
export function useFileConnections(
  onTrustRequired: (request: HostKeyTrustRequest, onCancelled?: () => void) => void,
) {
  const sessions = useRef(new Map<string, FileAttempt>());
  const configs = useRef(new Map<string, FileConnectionConfig>());
  const { beginAttempt, reportStage, awaitHostKey, failAttempt, clearAttempt } = useConnectionAttempts();
  const { dispatch } = useTerminalGroups();
  const { t } = useTranslation();

  useEffect(() => {
    const current = sessions.current;
    const currentConfigs = configs.current;
    return () => {
      for (const session of current.values()) session.controller.abort();
      current.clear();
      currentConfigs.clear();
    };
  }, []);

  const cancelFileConnection = useCallback((connectionId: string, forgetConfig = true) => {
    const session = sessions.current.get(connectionId);
    session?.controller.abort();
    if (session) void session.operation.finally(() => {
      if (sessions.current.get(connectionId) === session) sessions.current.delete(connectionId);
    });
    clearAttempt(connectionId);
    if (forgetConfig) configs.current.delete(connectionId);
  }, [clearAttempt]);

  const connectFileWithDiagnostics = useCallback((
    connectionId: string,
    config: FileConnectionConfig,
    onConnected?: () => void,
  ): Promise<ConnectResponse> => {
    const previous = sessions.current.get(connectionId);
    configs.current.set(connectionId, { ...config });
    previous?.controller.abort();
    const session: FileAttempt = {
      controller: new AbortController(),
      operation: Promise.resolve(cancelledConnectResponse()),
    };
    sessions.current.set(connectionId, session);
    const signal = session.controller.signal;
    const isCurrent = () => !signal.aborted && sessions.current.get(connectionId) === session;
    beginAttempt(connectionId, { protocol: config.protocol, ftpsEnabled: config.ftpsEnabled });
    dispatch({ type: 'UPDATE_TAB_STATUS', tabId: connectionId, status: 'connecting' });

    const onResult = (response: ConnectResponse) => {
      if (!isCurrent()) return;
      if (response.success) {
        reportStage(connectionId, 'connected');
        dispatch({ type: 'UPDATE_TAB_STATUS', tabId: connectionId, status: 'connected' });
        sessions.current.delete(connectionId);
        onConnected?.();
      } else if (response.errorKind === 'hostKeyUnknown'
        || (response.error && parseUnknownHostKeyError(response.error))) {
        awaitHostKey(connectionId);
      } else {
        if (response.errorKind === 'cancelled') clearAttempt(connectionId);
        else failAttempt(connectionId, response);
        dispatch({ type: 'UPDATE_TAB_STATUS', tabId: connectionId, status: 'disconnected' });
        sessions.current.delete(connectionId);
      }
    };

    session.operation = (async () => {
      // Finish an aborted request before reusing its backend session id.
      await previous?.operation;
      if (!isCurrent()) return cancelledConnectResponse();
      await invoke(config.protocol === 'SFTP' ? 'sftp_standalone_disconnect' : 'ftp_disconnect', {
        connectionId,
      }).catch(() => {});
      if (!isCurrent()) return cancelledConnectResponse();
      let response: ConnectResponse;
      try {
        if (config.protocol === 'SFTP') {
          const keyContent = config.authMethod === 'publickey'
            ? await resolvePrivateKeyContent(config) : undefined;
          if (!isCurrent()) return cancelledConnectResponse();
          response = await sftpConnectWithHostKeyTrust({
            connection_id: connectionId,
            host: config.host,
            port: config.port || 22,
            username: config.username,
            auth_method: config.authMethod || 'password',
            password: config.password || '',
            key_content: keyContent || null,
            passphrase: config.passphrase || null,
          }, (request) => {
            if (!isCurrent()) return;
            awaitHostKey(connectionId);
            onTrustRequired({
              connectionId,
              payload: request.payload,
              retry: () => {
                if (!isCurrent()) return Promise.resolve(cancelledConnectResponse());
                beginAttempt(connectionId, { protocol: 'SFTP' });
                session.operation = request.retry();
                return session.operation;
              },
            }, () => {
              if (!isCurrent()) return;
              cancelFileConnection(connectionId, false);
              dispatch({ type: 'UPDATE_TAB_STATUS', tabId: connectionId, status: 'disconnected' });
            });
          }, (stage) => { if (isCurrent()) reportStage(connectionId, stage); }, onResult, signal);
        } else {
          response = await invokeFileConnectWithProgress('ftp_connect', {
            connection_id: connectionId,
            host: config.host,
            port: config.port || 21,
            username: config.username || '',
            password: config.password || '',
            anonymous: config.authMethod === 'anonymous',
            ftps_enabled: config.ftpsEnabled ?? false,
          }, (stage) => { if (isCurrent()) reportStage(connectionId, stage); }, signal);
          onResult(response);
        }
      } catch (error) {
        response = { success: false, errorKind: 'unknown', error: String(error) };
        onResult(response);
      }
      if (!signal.aborted && !response.success && response.errorKind !== 'cancelled') {
        const formatted = formatConnectError(t, response);
        if (formatted) toast.error(formatted.title, { description: formatted.description });
      }
      return response;
    })();
    return session.operation;
  }, [awaitHostKey, beginAttempt, cancelFileConnection, clearAttempt, dispatch, failAttempt, onTrustRequired, reportStage, t]);

  const getFileConnectionConfig = useCallback((connectionId: string) => configs.current.get(connectionId), []);
  return { connectFileWithDiagnostics, cancelFileConnection, getFileConnectionConfig };
}
