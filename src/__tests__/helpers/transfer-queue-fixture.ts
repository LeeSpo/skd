import type { Channel } from '@tauri-apps/api/core';
import type { TransferItem } from '@/lib/transfer-queue-reducer';
import type { EnqueueTransferInput, TransferOutcome } from '@/lib/transfer-queue-service';
import type { FileTransferResponse, TransferProgressEvent } from '@/lib/transfer-progress';

type JobEvent = { item: TransferItem; result?: TransferOutcome };
export interface PendingTransfer {
  id: string; input: EnqueueTransferInput;
  channel: Channel<TransferProgressEvent>;
  resolve: (response: FileTransferResponse) => void;
}
/** Deterministic IPC adapter: the native pump is tested separately over real SSH. */
export function createTransferQueueFixture() {
  let revision = 0;
  let rows: TransferItem[] = [];
  let active: string | undefined;
  let nextId = 0;
  const events = new Map<string, Channel<JobEvent>>();
  const listeners = new Set<(event: { payload: { revision: number; items: TransferItem[] } }) => void>();
  const pending: PendingTransfer[] = [];
  const snapshot = () => ({ revision, items: rows.map(row => ({ ...row })) });
  function publish(item?: TransferItem, result?: TransferOutcome) {
    revision++;
    if (item) events.get(item.id)?.onmessage({ item: { ...item }, result });
    for (const listener of listeners) listener({ payload: snapshot() });
  }
  function pump() {
    if (active) return;
    const row = rows.find(row => row.status === 'queued');
    if (!row) return;
    active = row.id;
    row.status = 'transferring';
    publish(row);
    const entry: PendingTransfer = {
      id: row.id, input: { ...row, connectionId: row.connectionId! },
      channel: { onmessage(progress: TransferProgressEvent) {
        if (row.status !== 'transferring') return;
        Object.assign(row, progress);
        row.progress = progress.totalBytes ? Math.min(99, Math.floor(progress.bytesTransferred * 100 / progress.totalBytes)) : 0;
        publish(row);
      } } as Channel<TransferProgressEvent>,
      resolve(response) {
        if (!['transferring', 'cancelling'].includes(row.status)) return;
        row.status = row.status === 'cancelling' ? 'cancelled' : response.success ? 'completed' : 'failed';
        if (row.status === 'completed') {
          row.bytesTransferred = response.bytes_transferred ?? row.bytesTransferred;
          row.totalBytes = row.bytesTransferred; row.progress = 100;
        }
        row.error = row.status === 'failed' ? response.error ?? undefined : undefined;
        publish(row, { status: row.status as TransferOutcome['status'], bytesTransferred: row.status === 'completed' ? row.bytesTransferred : null,
          error: row.status === 'cancelled' ? 'Transfer cancelled' : row.error });
        active = undefined; pump();
      },
    };
    pending.push(entry);
  }
  function accept(inputs: EnqueueTransferInput[], channel?: Channel<JobEvent>) {
    for (const input of inputs) {
      const id = input.id ?? `native-${nextId++}`;
      const row: TransferItem = { ...input, id, status: 'queued', bytesTransferred: 0, totalBytes: input.totalBytes, speed: 0, progress: 0 };
      rows.push(row); if (channel) events.set(id, channel); publish(row);
    }
    pump(); return inputs.map(input => input.id);
  }
  async function invoke(command: string, args?: Record<string, unknown>) {
    switch (command) {
      case 'get_transfer_queue': return snapshot();
      case 'enqueue_file_transfers': return accept(args!.items as EnqueueTransferInput[], args!.onEvent as Channel<JobEvent>);
      case 'cancel_transfer': {
        const row = rows.find(row => row.id === args!.transferId);
        if (!row || !['queued', 'transferring'].includes(row.status)) return false;
        row.status = row.status === 'queued' ? 'cancelled' : 'cancelling';
        publish(row, row.status === 'cancelled' ? { status: 'cancelled', bytesTransferred: null, error: 'Transfer cancelled' } : undefined);
        return true;
      }
      case 'retry_transfer': {
        const row = rows.find(row => row.id === args!.transferId)!;
        const id = `retry-${nextId++}`;
        accept([{ ...row, connectionId: row.connectionId!, id, source: 'browser' }]); return id;
      }
      case 'clear_completed_transfers': rows = rows.filter(row => ['queued', 'transferring', 'cancelling'].includes(row.status)); publish(); return;
      default: return undefined;
    }
  }
  return {
    pending, snapshot, accept, invoke,
    listen: async (_name: string, callback: (event: { payload: { revision: number; items: TransferItem[] } }) => void) => {
      listeners.add(callback); return () => { listeners.delete(callback); };
    },
    broadcast: (data: { revision: number; items: TransferItem[] }) => { for (const listener of listeners) listener({ payload: data }); },
  };
}
