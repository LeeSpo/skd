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

export async function transferFile(
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

export function aggregateTransferBytes(completedBytes: number, currentBytes: number): number {
  return completedBytes + currentBytes;
}
