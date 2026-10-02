import { Channel, invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useRef } from 'react';

export interface TransferProgressEvent {
  bytesTransferred: number;
  totalBytes: number | null;
}

export interface TransferProgressSnapshot extends TransferProgressEvent {
  progress: number;
  speed: number;
}

export interface FileTransferResponse {
  success: boolean;
  bytes_transferred?: number | null;
  error?: string | null;
  cancelled?: boolean;
}

/** Each run captures a generation, including across StrictMode effect replay. */
export function useTransferScope(identity: string) {
  const lifecycle = useRef({ active: false, generation: 0 });
  useEffect(() => {
    const current = lifecycle.current;
    current.active = true;
    current.generation++;
    return () => { current.active = false; };
  }, [identity]);
  const capture = useCallback(() => {
    const generation = lifecycle.current.generation;
    return () => lifecycle.current.active && lifecycle.current.generation === generation;
  }, []);
  return useMemo(() => ({ capture }), [capture]);
}

/** This adapts progress only; completion remains the invoke response's job. */
export function createProgressAdapter(
  onProgress: (snapshot: TransferProgressSnapshot) => void,
  isActive: () => boolean = () => true,
  now: () => number = () => performance.now(),
) {
  let active = true;
  let previousBytes = 0;
  let previousTime = now();
  let speed = 0;
  return {
    receive: (event: TransferProgressEvent) => {
      if (!active || !isActive() || event.bytesTransferred < previousBytes) return;
      const time = now();
      const elapsed = time - previousTime;
      if (elapsed > 0 && event.bytesTransferred > previousBytes) {
        speed = (event.bytesTransferred - previousBytes) * 1000 / elapsed;
      }
      previousTime = time;
      previousBytes = event.bytesTransferred;
      onProgress({
        ...event,
        progress: event.totalBytes !== null && event.totalBytes > 0
          ? Math.min(99, Math.floor(event.bytesTransferred / event.totalBytes * 100))
          : 0,
        speed,
      });
    },
    close: () => { active = false; },
  };
}

export async function transferFileLegacy(
  direction: 'upload' | 'download',
  params: { connectionId: string; localPath: string; remotePath: string },
  onProgress: (snapshot: TransferProgressSnapshot) => void,
  isActive: () => boolean = () => true,
): Promise<FileTransferResponse> {
  const adapter = createProgressAdapter(onProgress, isActive);
  const channel = new Channel<TransferProgressEvent>();
  channel.onmessage = adapter.receive;
  try {
    return await invoke<FileTransferResponse>(`${direction}_remote_file`, {
      ...params,
      onProgress: channel,
    });
  } finally {
    adapter.close();
    // A queued native message may still arrive after invoke has settled.
    channel.onmessage = () => {};
  }
}

export async function transferFile(
  direction: 'upload' | 'download',
  params: { connectionId: string; localPath: string; remotePath: string },
  onProgress: (snapshot: TransferProgressSnapshot) => void,
  isActive: () => boolean = () => true,
  options?: { source?: 'directory' | 'sync' | 'editor'; signal?: AbortSignal; ownerId?: string; protocol?: string },
): Promise<FileTransferResponse> {
  if (options?.protocol === 'FTP') return transferFileLegacy(direction, params, onProgress, isActive);
  const { submit } = await import('./transfer-queue-service');
  const transfer = submit({
    connectionId: params.connectionId,
    fileName: params.remotePath.split('/').pop() ?? params.remotePath,
    direction, sourcePath: direction === 'upload' ? params.localPath : params.remotePath,
    destinationPath: direction === 'upload' ? params.remotePath : params.localPath,
    totalBytes: null, source: options?.source ?? 'browser', ownerId: options?.ownerId,
  }, { signal: options?.signal, onProgress: snapshot => { if (isActive()) onProgress(snapshot); } });
  const result = await transfer.done;
  // FTP retains its original path and cancellation behavior.
  if (result.error === 'FTP_LEGACY_TRANSFER') return transferFileLegacy(direction, params, onProgress, isActive);
  return { success: result.status === 'completed', bytes_transferred: result.bytesTransferred,
    error: result.error, cancelled: result.status === 'cancelled' };
}

export function aggregateTransferBytes(completedBytes: number, currentBytes: number): number {
  return completedBytes + currentBytes;
}
