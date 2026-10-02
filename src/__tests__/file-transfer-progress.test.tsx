import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { Channel, invoke } from '@tauri-apps/api/core';
import { FileBrowserView } from '@/components/file-browser-view';
import type { TransferProgressEvent, FileTransferResponse } from '@/lib/transfer-progress';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class<T> { onmessage: (message: T) => void = () => {}; },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/file-panel', () => ({ FilePanel: React.forwardRef(() => <div />) }));
vi.mock('@/components/sync-dialog', () => ({ SyncDialog: () => null }));
vi.mock('@/components/directory-transfer-dialog', () => ({ DirectoryTransferDialog: () => null }));
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => null,
}));

interface Pending {
  channel: Channel<TransferProgressEvent>;
  resolve: (response: FileTransferResponse) => void;
}
let pending: Pending[];

beforeEach(() => {
  pending = [];
  vi.mocked(toast.success).mockClear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === 'upload_remote_file' || command === 'download_remote_file') {
      return new Promise(resolve => pending.push({ channel: (args as { onProgress: Channel<TransferProgressEvent> }).onProgress, resolve }));
    }
    return Promise.resolve(undefined);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function enqueue(names: string[]) {
  act(() => document.dispatchEvent(new CustomEvent('skd-drop-transfer', { detail: {
    targetMode: 'remote', sourcePath: '/local', targetPath: '/remote',
    files: names.map(name => ({ name, size: 1000, file_type: 'File' })),
  } })));
}
function showQueue() {
  fireEvent.click(screen.getByRole('button', { name: /transferQueue.transfers/ }));
}

describe('file transfer queue progress', () => {
  it('shows percentage and speed before invoke resolves, then completes at 100%', async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    render(<FileBrowserView connectionId="one" connectionName="host" isConnected />);
    enqueue(['a']);
    await waitFor(() => expect(pending).toHaveLength(1));
    showQueue();
    clock.mockReturnValue(2000);
    act(() => pending[0].channel.onmessage({ bytesTransferred: 400, totalBytes: 1000 }));
    expect(screen.getByText('40%')).toBeDefined();
    expect(screen.getByText('200 B/s')).toBeDefined();
    expect(screen.getByText('3s')).toBeDefined();
    act(() => pending[0].channel.onmessage({ bytesTransferred: 1000, totalBytes: 1000 }));
    expect(screen.getByText('99%')).toBeDefined();
    await act(async () => pending[0].resolve({ success: true, bytes_transferred: 1000 }));
    expect(screen.queryByText('99%')).toBeNull();
    expect(screen.getByText('transferQueue.done')).toBeDefined();
  });

  it('hides percentage and ETA for unknown sizes', async () => {
    render(<FileBrowserView connectionId="one" connectionName="host" isConnected />);
    enqueue(['unknown']);
    await waitFor(() => expect(pending).toHaveLength(1));
    showQueue();
    act(() => pending[0].channel.onmessage({ bytesTransferred: 512, totalBytes: null }));
    expect(screen.queryByText(/\d+%/)).toBeNull();
    expect(screen.getByText('512 B')).toBeDefined();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('starts the next item after failure', async () => {
    render(<FileBrowserView connectionId="one" connectionName="host" isConnected />);
    enqueue(['a', 'b']);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].resolve({ success: false, error: 'Disconnected' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(invoke).toHaveBeenLastCalledWith('upload_remote_file', expect.objectContaining({ localPath: '/local/b' }));
  });

  it('ignores completion/progress of cancelled items and processes queued work', async () => {
    render(<FileBrowserView connectionId="one" connectionName="host" isConnected />);
    enqueue(['a', 'b']);
    await waitFor(() => expect(pending).toHaveLength(1));
    showQueue();
    fireEvent.click(screen.getAllByRole('button', { name: 'transferQueue.cancel' })[0]);
    act(() => pending[0].channel.onmessage({ bytesTransferred: 900, totalBytes: 1000 }));
    expect(screen.queryByText('90%')).toBeNull();
    await act(async () => pending[0].resolve({ success: true, bytes_transferred: 1000 }));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(screen.queryByText('transferQueue.done')).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('keeps a retry queued until the cancelled attempt settles and rejects its late results', async () => {
    render(<FileBrowserView connectionId="one" connectionName="host" isConnected />);
    enqueue(['a']);
    await waitFor(() => expect(pending).toHaveLength(1));
    showQueue();
    fireEvent.click(screen.getByRole('button', { name: 'transferQueue.cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'transferQueue.retry' }));
    act(() => pending[0].channel.onmessage({ bytesTransferred: 900, totalBytes: 1000 }));
    expect(screen.queryByText('90%')).toBeNull();
    expect(pending).toHaveLength(1);
    await act(async () => pending[0].resolve({ success: true, bytes_transferred: 1000 }));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(screen.queryByText('transferQueue.done')).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    act(() => pending[0].channel.onmessage({ bytesTransferred: 1000, totalBytes: 1000 }));
    act(() => pending[1].channel.onmessage({ bytesTransferred: 400, totalBytes: 1000 }));
    expect(screen.getByText('40%')).toBeDefined();
  });

  it('ignores progress after switching the connection or unmounting', async () => {
    const view = render(<FileBrowserView connectionId="one" connectionName="host" isConnected />);
    enqueue(['a']);
    await waitFor(() => expect(pending).toHaveLength(1));
    showQueue();
    view.rerender(<FileBrowserView connectionId="two" connectionName="other" isConnected />);
    act(() => pending[0].channel.onmessage({ bytesTransferred: 500, totalBytes: 1000 }));
    expect(screen.queryByText('50%')).toBeNull();
    await act(async () => pending[0].resolve({ success: true, bytes_transferred: 1000 }));
    enqueue(['new']);
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(invoke).toHaveBeenLastCalledWith('upload_remote_file', expect.objectContaining({ connectionId: 'two', localPath: '/local/new' }));
    view.unmount();
    act(() => pending[1].channel.onmessage({ bytesTransferred: 500, totalBytes: 1000 }));
    await act(async () => pending[1].resolve({ success: true, bytes_transferred: 1000 }));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
