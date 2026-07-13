import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  CONNECT_PROGRESS_EVENT,
  type ConnectProgressEvent,
  type ConnectStage,
  isConnectStage,
} from './connection-diagnostics';
import { isHostKeyVerificationEnabled, parseUnknownHostKeyError } from './host-key-verification';

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
  payload: NonNullable<ReturnType<typeof parseUnknownHostKeyError>>;
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
): Promise<ConnectResponse> {
  const attempt = async (): Promise<ConnectResponse> => {
    const unlisten = onStage
      ? await listenConnectProgress(params.connection_id, onStage)
      : null;
    try {
      const response = await invoke<ConnectResponse>('ssh_connect', {
        request: {
          ...params,
          host_key_verification: isHostKeyVerificationEnabled(),
        },
      });
      onAttemptResult?.(response);
      return response;
    } finally {
      unlisten?.();
    }
  };

  const result = await attempt();
  if (result.success) {
    return result;
  }

  const payload = result.error ? parseUnknownHostKeyError(result.error) : null;
  if (payload) {
    onTrustRequired({ payload, retry: attempt });
    return {
      ...result,
      pendingHostKeyTrust: true,
      errorKind: result.errorKind ?? 'hostKeyUnknown',
    };
  }

  return result;
}

export async function sftpConnectWithHostKeyTrust(
  params: SftpConnectParams,
  onTrustRequired: (request: HostKeyTrustRequest) => void,
): Promise<ConnectResponse> {
  const attempt = async (): Promise<ConnectResponse> => invoke<ConnectResponse>('sftp_connect', {
    request: {
      ...params,
      host_key_verification: isHostKeyVerificationEnabled(),
    },
  });

  const result = await attempt();
  if (result.success) {
    return result;
  }

  const payload = result.error ? parseUnknownHostKeyError(result.error) : null;
  if (payload) {
    onTrustRequired({ payload, retry: attempt });
    return {
      ...result,
      pendingHostKeyTrust: true,
      errorKind: result.errorKind ?? 'hostKeyUnknown',
    };
  }

  return result;
}
