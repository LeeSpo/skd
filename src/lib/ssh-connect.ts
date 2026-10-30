import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  CONNECT_PROGRESS_EVENT,
  type ConnectProgressEvent,
  type ConnectStage,
  isConnectStage,
} from './connection-diagnostics';
import { loadConnectionTimeoutSecs, loadKeepAliveIntervalSecs } from './connection-settings';
import { isHostKeyVerificationEnabled, parseHostKeyTrustError } from './host-key-verification';
import type { KeyboardInteractiveCoordinator } from './keyboard-interactive-context';

export interface SshConnectParams {
  connection_id: string;
  host: string;
  port: number;
  username: string;
  auth_method: string;
  password?: string | null;
  key_content?: string | null;
  passphrase?: string | null;
}

export type SftpConnectParams = SshConnectParams;

export interface ConnectResponse {
  success: boolean;
  error?: string;
  /** Backend may send known ConnectErrorKind values or future kinds. */
  errorKind?: string;
  /** Backend may send known ConnectStage values or future stages. */
  failedStage?: string;
  pendingHostKeyTrust?: boolean;
}

export type HostKeyTrustRequest = {
  connectionId?: string;
  payload: NonNullable<ReturnType<typeof parseHostKeyTrustError>>;
  retry: () => Promise<ConnectResponse>;
};

export type ConnectProgressHandler = (stage: ConnectStage) => void;

/**
 * Subscribe to backend connect progress events for a single connection id.
 * Returns an unlisten function.
 */
export async function listenConnectProgress(
  connectionId: string,
  onStage: ConnectProgressHandler,
): Promise<UnlistenFn> {
  return listen<ConnectProgressEvent>(CONNECT_PROGRESS_EVENT, (event) => {
    const payload = event.payload;
    if (!payload || payload.connectionId !== connectionId) {
      return;
    }
    if (isConnectStage(payload.stage)) {
      onStage(payload.stage);
    }
  });
}

export async function sshConnectWithHostKeyTrust(
  params: SshConnectParams,
  onTrustRequired: (request: HostKeyTrustRequest) => void,
  onStage?: ConnectProgressHandler,
  onAttemptResult?: (response: ConnectResponse) => void,
  keyboardInteractive?: KeyboardInteractiveCoordinator,
): Promise<ConnectResponse> {
  const attempt = async (): Promise<ConnectResponse> => {
    await keyboardInteractive?.ensureReady();
    const unlisten = onStage
      ? await listenConnectProgress(params.connection_id, onStage)
      : null;
    try {
      const response = await invoke<ConnectResponse>('ssh_connect', {
        request: {
          ...params,
          host_key_verification: isHostKeyVerificationEnabled(),
          tcp_timeout_secs: loadConnectionTimeoutSecs(),
          keepalive_interval_secs: loadKeepAliveIntervalSecs(),
        },
      });
      onAttemptResult?.(response);
      return response;
    } finally {
      unlisten?.();
      keyboardInteractive?.finish(params.connection_id);
    }
  };

  const result = await attempt();
  if (result.success) {
    return result;
  }

  const payload = result.error ? parseHostKeyTrustError(result.error) : null;
  if (payload) {
    onTrustRequired({ payload, retry: attempt });
    return {
      ...result,
      pendingHostKeyTrust: true,
      errorKind: result.errorKind ?? (payload.changed ? 'hostKeyMismatch' : 'hostKeyUnknown'),
    };
  }

  return result;
}

export async function sftpConnectWithHostKeyTrust(
  params: SftpConnectParams,
  onTrustRequired: (request: HostKeyTrustRequest) => void,
  onStage?: ConnectProgressHandler,
  onAttemptResult?: (response: ConnectResponse) => void,
  signal?: AbortSignal,
): Promise<ConnectResponse> {
  const attempt = async (): Promise<ConnectResponse> => {
    const response = await invokeFileConnectWithProgress('sftp_connect', {
      ...params,
      host_key_verification: isHostKeyVerificationEnabled(),
      tcp_timeout_secs: loadConnectionTimeoutSecs(),
      keepalive_interval_secs: loadKeepAliveIntervalSecs(),
    }, onStage, signal);
    onAttemptResult?.(response);
    const payload = response.error ? parseHostKeyTrustError(response.error) : null;
    if (!response.success && payload && !signal?.aborted) {
      onTrustRequired({ connectionId: params.connection_id, payload, retry: attempt });
      return {
        ...response,
        pendingHostKeyTrust: true,
        errorKind: response.errorKind ?? (payload.changed ? 'hostKeyMismatch' : 'hostKeyUnknown'),
      };
    }
    return response;
  };
  return attempt();
}

export const cancelledConnectResponse = (): ConnectResponse => ({
  success: false,
  errorKind: 'cancelled',
});

/** File connection commands share the transport progress channel with SSH. */
export async function invokeFileConnectWithProgress(
  command: 'sftp_connect' | 'ftp_connect',
  request: { connection_id: string } & Record<string, unknown>,
  onStage?: ConnectProgressHandler,
  signal?: AbortSignal,
): Promise<ConnectResponse> {
  let unlisten: UnlistenFn | undefined;
  const stopListening = () => { unlisten?.(); unlisten = undefined; };
  const cancel = () => {
    stopListening();
    void invoke('ssh_cancel_connect', { connectionId: request.connection_id }).catch(() => {});
  };
  try {
    if (signal?.aborted) return cancelledConnectResponse();
    if (onStage) {
      unlisten = await listenConnectProgress(request.connection_id, (stage) => {
        if (!signal?.aborted) onStage(stage);
      });
    }
    if (signal?.aborted) return cancelledConnectResponse();
    signal?.addEventListener('abort', cancel, { once: true });
    const response = await invoke<ConnectResponse>(command, { request });
    if (signal?.aborted) {
      if (response.success) {
        await invoke(command === 'sftp_connect' ? 'sftp_standalone_disconnect' : 'ftp_disconnect', {
          connectionId: request.connection_id,
        }).catch(() => {});
      }
      return cancelledConnectResponse();
    }
    return response;
  } catch (error) {
    return signal?.aborted ? cancelledConnectResponse() : {
      success: false,
      errorKind: 'unknown',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    signal?.removeEventListener('abort', cancel);
    stopListening();
  }
}
