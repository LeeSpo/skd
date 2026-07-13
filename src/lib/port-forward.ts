import { invoke } from '@tauri-apps/api/core';

export interface LocalForwardInfo {
  id: string;
  connection_id: string;
  bookmark_id?: string | null;
  name?: string | null;
  local_bind_host: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  local_status: 'listening' | 'error';
  target_status: 'checking' | 'reachable' | 'unreachable' | 'ssh_disconnected' | 'unknown';
  last_error?: string | null;
  last_checked_at?: number | null;
}

export interface StartLocalForwardParams {
  connection_id: string;
  bookmark_id?: string;
  name?: string;
  local_bind_host?: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
}

export function defaultLocalBindHost(): string {
  return '127.0.0.1';
}

export function defaultRemoteHost(): string {
  return 'localhost';
}

export type LocalForwardValidationError =
  | 'localBindHostRequired'
  | 'localPortInvalid'
  | 'remoteHostRequired'
  | 'remotePortInvalid';

/**
 * Client-side validation before invoking the backend.
 * Returns an error key fragment or null when valid.
 */
export function validateLocalForwardForm(input: {
  localBindHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
}): LocalForwardValidationError | null {
  if (!input.localBindHost.trim()) {
    return 'localBindHostRequired';
  }
  if (!Number.isFinite(input.localPort) || input.localPort < 0 || input.localPort > 65535) {
    return 'localPortInvalid';
  }
  if (!input.remoteHost.trim()) {
    return 'remoteHostRequired';
  }
  if (!Number.isFinite(input.remotePort) || input.remotePort < 1 || input.remotePort > 65535) {
    return 'remotePortInvalid';
  }
  return null;
}

export function formatForwardSummary(info: Pick<
  LocalForwardInfo,
  'local_bind_host' | 'local_port' | 'remote_host' | 'remote_port'
>): string {
  return `${info.local_bind_host}:${info.local_port} → ${info.remote_host}:${info.remote_port}`;
}

export async function startLocalForward(
  params: StartLocalForwardParams,
): Promise<LocalForwardInfo> {
  return invoke<LocalForwardInfo>('ssh_start_local_forward', {
    request: {
      connection_id: params.connection_id,
      bookmark_id: params.bookmark_id,
      name: params.name,
      local_bind_host: params.local_bind_host,
      local_port: params.local_port,
      remote_host: params.remote_host,
      remote_port: params.remote_port,
    },
  });
}

export async function stopLocalForward(
  connectionId: string,
  forwardId: string,
): Promise<void> {
  // Tauri renames command args to camelCase for the JS bridge.
  const result = await invoke<{ success: boolean; error?: string | null }>(
    'ssh_stop_local_forward',
    {
      connectionId,
      forwardId,
    },
  );
  if (!result.success) {
    throw new Error(result.error || 'Failed to stop port forward');
  }
}

export async function listLocalForwards(
  connectionId: string,
): Promise<LocalForwardInfo[]> {
  // Tauri renames command args to camelCase for the JS bridge.
  return invoke<LocalForwardInfo[]>('ssh_list_local_forwards', {
    connectionId,
  });
}

export async function testLocalForward(
  connectionId: string,
  forwardId: string,
): Promise<LocalForwardInfo> {
  return invoke<LocalForwardInfo>('ssh_test_local_forward', {
    connectionId,
    forwardId,
  });
}
