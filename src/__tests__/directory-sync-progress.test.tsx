import { listen } from '@tauri-apps/api/event';
import { createTransferQueueFixture } from './helpers/transfer-queue-fixture';
import { __resetTransferQueueForTests, cancelTransfer } from '@/lib/transfer-queue-service';
import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Channel, invoke } from '@tauri-apps/api/core';
import { DirectoryTransferDialog } from '@/components/directory-transfer-dialog';
import { SyncDialog } from '@/components/sync-dialog';
import type { TransferProgressEvent, FileTransferResponse } from '@/lib/transfer-progress';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class<T> { onmessage: (message: T) => void = () => {}; },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/ui/dialog', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
    DialogContent: Container, DialogHeader: Container, DialogFooter: Container, DialogTitle: Container,
  };
});
vi.mock('@/components/ui/scroll-area', () => ({ ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

interface Pending {
  channel: Channel<TransferProgressEvent>;
  resolve: (response: FileTransferResponse) => void;
}
let pending: Pending[];
let fixture: ReturnType<typeof createTransferQueueFixture>;
const files = ['a', 'b'].map(name => ({ relative_path: name, name, size: 100, modified: null, file_type: 'File' }));

beforeEach(() => {
  __resetTransferQueueForTests();
  fixture = createTransferQueueFixture();
  pending = fixture.pending;
  vi.mocked(listen).mockImplementation(fixture.listen as never);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (['get_transfer_queue', 'enqueue_file_transfers', 'cancel_transfer', 'retry_transfer', 'clear_completed_transfers'].includes(command)) {
      return fixture.invoke(command, args as Record<string, unknown>);
    }
    if (command === 'list_local_files_recursive') return Promise.resolve(files);
    if (command === 'list_remote_files_recursive') return Promise.resolve([]);
    return Promise.resolve({ success: true });
  });
});
afterEach(cleanup);

const directoryProps = {
  open: true, onOpenChange: vi.fn(), direction: 'upload' as const,
  connectionId: 'one', sourcePath: '/local', destPath: '/remote',
};
const syncProps = {
  open: true, onOpenChange: vi.fn(), connectionId: 'one', localPath: '/local', remotePath: '/remote',
  onLoadLocalDir: vi.fn(async () => []), onLoadRemoteDir: vi.fn(async () => []),
  onCreateRemoteDir: vi.fn(async () => {}), onDeleteRemoteItem: vi.fn(async () => {}),
};

async function startSync(expectedPending = 1) {
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  const sync = await screen.findByRole('button', { name: 'Sync (2 items)' });
  fireEvent.click(sync);
  await waitFor(() => expect(pending).toHaveLength(expectedPending));
}
function report(index: number, bytes: number, total: number | null = 100) {
  act(() => pending[index].channel.onmessage({ bytesTransferred: bytes, totalBytes: total }));
}
async function complete(index: number) {
  await act(async () => pending[index].resolve({ success: true, bytes_transferred: 100 }));
}
function percentage(value: number) {
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(String(value));
}

describe('directory transfer progress', () => {
  it('shows current-file bytes before completion and aggregates snapshots exactly once', async () => {
    const done = vi.fn();
    render(<StrictMode><DirectoryTransferDialog {...directoryProps} onComplete={done} /></StrictMode>);
    await waitFor(() => expect(pending).toHaveLength(1));
    report(0, 50);
    percentage(25);
    expect(done).not.toHaveBeenCalled();
    await complete(0);
    await waitFor(() => expect(pending).toHaveLength(2));
    report(1, 20);
    percentage(60);
    report(1, 40);
    percentage(70);
    report(1, 100);
    percentage(99);
    await complete(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Transfer complete')).toBeDefined();
  });

  it('cancelling from the global queue stops the rest of the directory batch', async () => {
    const done = vi.fn();
    render(<DirectoryTransferDialog {...directoryProps} onComplete={done} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => cancelTransfer(fixture.pending[0].id));
    await complete(0);
    expect(pending).toHaveLength(1);
    expect(done).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDefined();
  });

  it('streams downloads using remote sources and local destinations', async () => {
    const original = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === 'list_remote_files_recursive') return Promise.resolve(files);
      return original(command, args);
    });
    render(<DirectoryTransferDialog {...directoryProps} direction="download" sourcePath="/remote" destPath="/local" onComplete={vi.fn()} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(fixture.pending[0].input).toMatchObject({ direction: 'download', destinationPath: '/local/a', sourcePath: '/remote/a' });
    report(0, 50);
    percentage(25);
  });

  it('shows bytes and speed without percentage for unknown size and ignores cancellation', async () => {
    const done = vi.fn();
    render(<DirectoryTransferDialog {...directoryProps} onComplete={done} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    report(0, 50, null);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(/50 B \/ Unknown size/)).toBeDefined();
    expect(screen.getByText(/\/s$/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    report(0, 80, null);
    expect(screen.queryByText(/80 B/)).toBeNull();
    await complete(0);
    expect(pending).toHaveLength(1);
    expect(done).not.toHaveBeenCalled();
  });

  it('ignores closed dialogs and continues after a failed file', async () => {
    const done = vi.fn();
    const view = render(<DirectoryTransferDialog {...directoryProps} onComplete={done} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].resolve({ success: false, error: 'Disconnected' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    view.rerender(<DirectoryTransferDialog {...directoryProps} open={false} onComplete={done} />);
    report(1, 100);
    await complete(1);
    expect(done).not.toHaveBeenCalled();
  });
});

describe('sync transfer progress', () => {
  it('shows in-flight progress and accumulates completed files plus the current snapshot', async () => {
    const done = vi.fn();
    render(<SyncDialog {...syncProps} onSyncComplete={done} />);
    await startSync();
    report(0, 40);
    percentage(20);
    expect(done).not.toHaveBeenCalled();
    await complete(0);
    await waitFor(() => expect(pending).toHaveLength(2));
    report(1, 20);
    percentage(60);
    report(1, 60);
    percentage(80);
    expect(screen.getByText('160 B / 200 B')).toBeDefined();
    await complete(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('cancelling from the queue stops later sync entries', async () => {
    const done = vi.fn();
    render(<SyncDialog {...syncProps} onSyncComplete={done} />);
    await startSync();
    act(() => cancelTransfer(fixture.pending[0].id));
    await complete(0);
    expect(pending).toHaveLength(1);
    expect(done).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('resets an invalidated sync and lets the new connection start fresh', async () => {
    const done = vi.fn();
    const view = render(<SyncDialog {...syncProps} onSyncComplete={done} />);
    await startSync();
    view.rerender(<SyncDialog {...syncProps} connectionId="two" onSyncComplete={done} />);
    report(0, 100);
    await complete(0);
    expect(done).not.toHaveBeenCalled();
    expect(screen.queryByRole('progressbar')).toBeNull();
    await startSync(2);
    expect(fixture.pending[1].input.connectionId).toBe('two');
    report(1, 50);
    percentage(25);
  });

  it('shows unknown bytes/speed and discards progress and completion after unmount', async () => {
    const done = vi.fn();
    const view = render(<SyncDialog {...syncProps} onSyncComplete={done} />);
    await startSync();
    report(0, 40, null);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('40 B / Unknown size')).toBeDefined();
    expect(screen.getByText(/\/s$/)).toBeDefined();
    view.unmount();
    report(0, 100);
    await complete(0);
    expect(pending).toHaveLength(1);
    expect(done).not.toHaveBeenCalled();
  });
});
