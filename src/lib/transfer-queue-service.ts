// Adapted from R-Shell PR #168, 4a0e8a3b727e3c3e3002af20893f3052e38dd228
// (MIT). Rust owns the single pump; this module is a per-webview adapter.
import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useSyncExternalStore } from 'react';
import { createProgressAdapter, type TransferProgressSnapshot } from './transfer-progress';
import type { TransferAction, TransferItem, TransferDirection } from './transfer-queue-reducer';

export type TransferSource = 'browser' | 'directory' | 'sync' | 'editor' | 'finder' | 'legacy';
export interface EnqueueTransferInput {
  id?: string; connectionId: string; connectionName?: string; fileName: string;
  direction: TransferDirection; sourcePath: string; destinationPath: string;
  totalBytes: number | null; source?: TransferSource; ownerId?: string;
}
export interface TransferOutcome {
  status: 'completed' | 'failed' | 'cancelled'; bytesTransferred: number | null; error?: string | null;
}
export interface SubmittedTransfer { id: string; done: Promise<TransferOutcome>; cancel: () => void }
interface Snapshot { revision: number; items: TransferItem[] }
interface JobEvent { item: TransferItem; result?: TransferOutcome | null }
interface Submission {
  accepted: boolean; cancelRequested: boolean; settled: boolean;
  resolve: (outcome: TransferOutcome) => void;
  progress: ReturnType<typeof createProgressAdapter>;
  channel: Channel<JobEvent>;
}
let items: TransferItem[] = [];
let revision = -1;
let generation = 0;
let ready: Promise<void> | undefined;
let unlisten: (() => void) | undefined;
const subscribers = new Set<() => void>();
const settledListeners = new Set<(item: TransferItem) => void>();
const notified = new Set<string>();
const submissions = new Map<string, Submission>();
const pending = new Set<string>();
const trackers = new Map<string, ReturnType<typeof createProgressAdapter>>();
const measured = new Map<string, TransferProgressSnapshot>();
const connectionNames = new Map<string, string>();
export function setTransferConnectionNames(names: Array<{ id: string; name: string }>) {
  for (const connection of names) connectionNames.set(connection.id, connection.name);
  items = items.map(item => ({ ...item, connectionName: connectionNames.get(item.connectionId ?? '') ?? item.connectionName }));
  notify();
}
const terminal = (status: TransferItem['status']) => ['completed', 'failed', 'cancelled'].includes(status);
const notify = () => { for (const listener of subscribers) listener(); };

function settleNotice(item: TransferItem) {
  if (!terminal(item.status) || notified.has(item.id)) return;
  notified.add(item.id);
  for (const listener of settledListeners) listener(item);
}
function applySnapshot(snapshot: Snapshot, bootstrap = false) {
  if (snapshot.revision <= revision) return;
  revision = snapshot.revision;
  const visibleIds = new Set(snapshot.items.map(item => item.id));
  for (const [id, tracker] of trackers) {
    if (!visibleIds.has(id)) { tracker.close(); trackers.delete(id); measured.delete(id); }
  }
  for (const item of snapshot.items) pending.delete(item.id);
  const awaitingAcceptance = items.filter(item => pending.has(item.id));
  items = snapshot.items.map<TransferItem>(nativeItem => {
    const item = { ...nativeItem, connectionName: connectionNames.get(nativeItem.connectionId ?? '') ?? nativeItem.connectionName };
    if (item.status === 'transferring') {
      let tracker = trackers.get(item.id);
      if (!tracker) {
        tracker = createProgressAdapter(progress => measured.set(item.id, progress));
        trackers.set(item.id, tracker);
      }
      const previous = measured.get(item.id);
      // Queue revisions also change when another job is enqueued or cleared.
      // Those snapshots must not shorten the active file's speed sample window.
      if (!previous || previous.bytesTransferred !== item.bytesTransferred || previous.totalBytes !== item.totalBytes) {
        tracker.receive({ bytesTransferred: item.bytesTransferred, totalBytes: item.totalBytes });
      }
      const progress = measured.get(item.id);
      return progress ? { ...item, progress: progress.progress, speed: progress.speed } : item;
    }
    trackers.get(item.id)?.close(); trackers.delete(item.id); measured.delete(item.id);
    return { ...item, speed: 0 };
  }).concat(awaitingAcceptance);
  for (const item of items) {
    if (bootstrap && terminal(item.status)) notified.add(item.id);
    else settleNotice(item);
  }
  notify();
}
async function initialize() {
  const current = generation;
  const off = await listen<Snapshot>('transfer-queue-changed', event => {
    if (generation === current) applySnapshot(event.payload);
  });
  if (generation !== current) { off(); return; }
  unlisten = off;
  const snapshot = await invoke<Snapshot>('get_transfer_queue');
  if (generation === current) applySnapshot(snapshot, true);
}
export function initializeTransferQueue(): Promise<void> {
  return ready ??= initialize();
}
function subscribe(listener: () => void) {
  subscribers.add(listener);
  void initializeTransferQueue().catch(() => {});
  return () => { subscribers.delete(listener); };
}
export function getTransferById(id: string) { return items.find(item => item.id === id); }
export function onItemSettled(listener: (item: TransferItem) => void) {
  settledListeners.add(listener);
  return () => { settledListeners.delete(listener); };
}
function requestCancel(id: string) {
  return invoke<boolean>('cancel_transfer', { transferId: id }).catch(() => false);
}
export function cancelTransfer(id: string): void {
  const submitted = submissions.get(id);
  if (submitted && !submitted.settled) {
    submitted.cancelRequested = true;
    submitted.progress.close();
    if (!submitted.accepted) return; // Replay after registration, never lose an early cancel.
  }
  void requestCancel(id);
}
function newItem(input: EnqueueTransferInput, id: string): TransferItem {
  return { ...input, id, source: input.source ?? 'browser', status: 'queued', progress: 0,
    bytesTransferred: 0, speed: 0, totalBytes: input.totalBytes };
}
function finish(id: string, event: JobEvent) {
  const record = submissions.get(id);
  if (!record || record.settled || !event.result) return;
  record.settled = true; record.progress.close();
  record.channel.onmessage = () => {};
  submissions.delete(id); pending.delete(id);
  record.resolve(event.result);
}
function submitBatch(inputs: EnqueueTransferInput[], hooks?: { onProgress?: (p: TransferProgressSnapshot) => void; signal?: AbortSignal }) {
  const handles: SubmittedTransfer[] = [];
  const channels: Channel<JobEvent>[] = [];
  const requests = inputs.map(input => {
    const id = input.id ?? crypto.randomUUID();
    let resolve!: (outcome: TransferOutcome) => void;
    const done = new Promise<TransferOutcome>(r => { resolve = r; });
    const progress = createProgressAdapter(p => hooks?.onProgress?.(p));
    const channel = new Channel<JobEvent>();
    const record: Submission = { accepted: false, cancelRequested: false, settled: false, resolve, progress, channel };
    submissions.set(id, record); pending.add(id); items = [...items, newItem(input, id)];
    channel.onmessage = event => {
      if (record.settled) return;
      if (!record.accepted) {
        record.accepted = true;
        if (record.cancelRequested) void requestCancel(id);
      }
      if (event.item.status === 'transferring' && !record.cancelRequested) {
        progress.receive({ bytesTransferred: event.item.bytesTransferred, totalBytes: event.item.totalBytes });
      }
      finish(id, event);
    };
    const cancel = () => cancelTransfer(id);
    const signal = hooks?.signal;
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    void done.then(() => signal?.removeEventListener('abort', cancel));
    handles.push({ id, done, cancel }); channels.push(channel);
    return { ...input, id, source: input.source ?? 'browser' };
  });
  notify();
  // One call per batch preserves input order. Channels are multiplexed locally
  // so each managed submit has an independent lifecycle and completion promise.
  const batchChannel = new Channel<JobEvent>();
  batchChannel.onmessage = event => {
    const index = requests.findIndex(input => input.id === event.item.id);
    if (index >= 0) channels[index].onmessage(event);
  };
  const current = generation;
  void initializeTransferQueue().then(() => {
    const remaining = requests.filter(request => {
      const record = submissions.get(request.id);
      if (!record?.cancelRequested) return true;
      const item = getTransferById(request.id)!;
      const cancelled: TransferItem = { ...item, status: 'cancelled' };
      items = items.map(item => item.id === request.id ? cancelled : item);
      finish(request.id, { item: cancelled, result: { status: 'cancelled', bytesTransferred: null, error: 'Transfer cancelled' } });
      return false;
    });
    notify();
    if (generation !== current || remaining.length === 0) return;
    return invoke<string[]>('enqueue_file_transfers', { items: remaining, onEvent: batchChannel });
  }).then(() => {
    if (generation !== current) return;
    for (const handle of handles) {
      const record = submissions.get(handle.id);
      if (!record) continue;
      if (!record.accepted) { record.accepted = true; if (record.cancelRequested) void requestCancel(handle.id); }
    }
  }).catch((error: unknown) => {
    if (generation !== current) return;
    for (const handle of handles) {
      const record = submissions.get(handle.id);
      if (!record || record.settled) continue;
      const item = getTransferById(handle.id);
      if (!item) continue;
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = record.cancelRequested || message === 'Transfer cancelled';
      const failed: TransferItem = { ...item, status: cancelled ? 'cancelled' : 'failed', error: cancelled ? undefined : message };
      items = message === 'FTP_LEGACY_TRANSFER' ? items.filter(item => item.id !== handle.id) : items.map(item => item.id === handle.id ? failed : item);
      finish(handle.id, { item: failed, result: { status: cancelled ? 'cancelled' : 'failed', bytesTransferred: null, error: cancelled ? 'Transfer cancelled' : message } });
      if (message !== 'FTP_LEGACY_TRANSFER') settleNotice(failed);
    }
    notify();
  }).finally(() => {
    batchChannel.onmessage = handles.every(h => !submissions.has(h.id)) ? () => {} : batchChannel.onmessage;
  });
  void Promise.all(handles.map(h => h.done)).then(() => { batchChannel.onmessage = () => {}; });
  return handles;
}
export function submit(input: EnqueueTransferInput, options?: { onProgress?: (p: TransferProgressSnapshot) => void; signal?: AbortSignal }): SubmittedTransfer {
  return submitBatch([input], options)[0];
}
export function enqueue(inputs: EnqueueTransferInput[]): TransferItem[] {
  return submitBatch(inputs).map(handle => getTransferById(handle.id)!);
}
export function useTransferQueue(connectionId = '', connectionName?: string) {
  const transfers = useSyncExternalStore(subscribe, () => items);
  const dispatch = useCallback((action: TransferAction) => {
    switch (action.type) {
      case 'ENQUEUE': enqueue(action.items.map(item => ({ ...item, connectionId: item.connectionId ?? connectionId, connectionName: item.connectionName ?? connectionName }))); break;
      case 'CANCEL': cancelTransfer(action.id); break;
      case 'RETRY': void invoke('retry_transfer', { transferId: action.id }).catch(() => {}); break;
      case 'CLEAR_COMPLETED': case 'CLEAR_ALL': void invoke('clear_completed_transfers').catch(() => {}); break;
    }
  }, [connectionId, connectionName]);
  return { transfers, dispatch };
}
/** Test isolation; native queue lifetime is independent of this adapter. */
export function __resetTransferQueueForTests() {
  generation++; unlisten?.(); unlisten = undefined; ready = undefined; revision = -1;
  for (const record of submissions.values()) { record.progress.close(); record.channel.onmessage = () => {}; record.resolve({ status: 'cancelled', bytesTransferred: null }); }
  submissions.clear(); pending.clear(); trackers.clear(); measured.clear(); connectionNames.clear(); notified.clear(); items = [];
}
