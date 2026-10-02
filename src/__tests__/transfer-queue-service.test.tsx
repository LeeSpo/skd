// Adapted from upstream PR #168 queue lifecycle tests; native pump runs in Rust.
import React from 'react';
import { act, cleanup, renderHook, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createTransferQueueFixture } from './helpers/transfer-queue-fixture';
import { __resetTransferQueueForTests, enqueue, submit, cancelTransfer, getTransferById, onItemSettled, useTransferQueue, initializeTransferQueue } from '@/lib/transfer-queue-service';
import { FileEditorView } from '@/components/file-editor-view';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class<T> { onmessage: (m: T) => void = () => {}; } }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/code-editor', () => ({ CodeEditor: () => null }));
let fixture: ReturnType<typeof createTransferQueueFixture>;
const input = (name = 'file', connectionId = 'one') => ({ connectionId, fileName: name, direction: 'upload' as const, sourcePath: `/local/${name}`, destinationPath: `/remote/${name}`, totalBytes: 1000 });
beforeEach(() => {
  __resetTransferQueueForTests();
  fixture = createTransferQueueFixture();
  vi.mocked(listen).mockReset().mockImplementation(fixture.listen as never);
  vi.mocked(invoke).mockReset().mockImplementation(fixture.invoke as never);
});
afterEach(() => { cleanup(); __resetTransferQueueForTests(); });

describe('shared transfer queue interface', () => {
  it('submits a batch once, preserves its order and drives no frontend transfer pump', async () => {
    const [first, second] = enqueue([input('a'), input('b', 'two')]);
    await waitFor(() => expect(fixture.pending).toHaveLength(1));
    expect(getTransferById(second.id)?.status).toBe('queued');
    expect(fixture.pending[0].id).toBe(first.id);
    fixture.pending[0].resolve({ success: false, error: 'read failed' });
    expect(fixture.pending[1].id).toBe(second.id);
    expect(invoke).toHaveBeenCalledWith('enqueue_file_transfers', expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ id: first.id }), expect.objectContaining({ id: second.id })]) }));
    expect(invoke).not.toHaveBeenCalledWith('upload_remote_file', expect.anything());
  });

  it('captures progress before completion, uses actual bytes and suppresses late callbacks', async () => {
    const progress = vi.fn();
    const handle = submit(input(), { onProgress: progress });
    await waitFor(() => expect(fixture.pending).toHaveLength(1));
    fixture.pending[0].channel.onmessage({ bytesTransferred: 800, totalBytes: 1000 });
    expect(progress.mock.lastCall?.[0].progress).toBe(80);
    fixture.pending[0].resolve({ success: true, bytes_transferred: 900 });
    expect(await handle.done).toMatchObject({ status: 'completed', bytesTransferred: 900 });
    const count = progress.mock.calls.length;
    fixture.pending[0].channel.onmessage({ bytesTransferred: 1000, totalBytes: 1000 });
    expect(progress).toHaveBeenCalledTimes(count);
    expect(getTransferById(handle.id)?.bytesTransferred).toBe(900);
  });

  it('handles completion sent synchronously before the enqueue response', async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      const response = await fixture.invoke(command, args as Record<string, unknown>);
      if (command === 'enqueue_file_transfers') fixture.pending[0].resolve({ success: true, bytes_transferred: 12 });
      return response;
    });
    const transfer = submit(input());
    expect(await transfer.done).toMatchObject({ status: 'completed', bytesTransferred: 12 });
  });

  it('does not distort speed when unrelated queue revisions repeat the same byte snapshot', async () => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const handle = submit(input());
      await waitFor(() => expect(fixture.pending).toHaveLength(1));
      now = 1000;
      fixture.pending[0].channel.onmessage({ bytesTransferred: 500, totalBytes: 1000 });
      expect(getTransferById(handle.id)?.speed).toBe(500);
      now = 1500;
      fixture.accept([{ ...input('waiting'), id: 'waiting' }]);
      now = 2000;
      fixture.pending[0].channel.onmessage({ bytesTransferred: 1000, totalBytes: 1000 });
      expect(getTransferById(handle.id)?.bytesTransferred).toBe(1000);
      expect(getTransferById(handle.id)?.speed).toBe(500);
      fixture.pending[0].resolve({ success: true, bytes_transferred: 1000 });
      await handle.done;
    } finally { clock.mockRestore(); }
  });

  it('aborting before acceptance creates no backend transfer', async () => {
    const abort = new AbortController();
    const handle = submit(input(), { signal: abort.signal });
    abort.abort();
    expect(await handle.done).toMatchObject({ status: 'cancelled' });
    expect(fixture.pending).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalledWith('enqueue_file_transfers', expect.anything());
  });

  it('replays cancellation when requested while acceptance is pending', async () => {
    let accept!: () => void;
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === 'enqueue_file_transfers') return new Promise(resolve => { accept = () => { void fixture.invoke(command, args as Record<string, unknown>).then(resolve); }; });
      return fixture.invoke(command, args as Record<string, unknown>);
    });
    const handle = submit(input());
    await waitFor(() => expect(accept).toBeDefined());
    handle.cancel(); accept();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cancel_transfer', { transferId: handle.id }));
    // Depending on whether cancellation landed before START, a queued job may settle immediately.
    if (fixture.pending.length) fixture.pending[0].resolve({ success: true });
    expect(await handle.done).toMatchObject({ status: 'cancelled' });
  });

  it('running cancellation waits for cleanup and cannot turn back into success', async () => {
    const first = submit(input('a')); const second = submit(input('b'));
    await waitFor(() => expect(fixture.pending).toHaveLength(1));
    first.cancel();
    await waitFor(() => expect(getTransferById(first.id)?.status).toBe('cancelling'));
    expect(fixture.pending).toHaveLength(1);
    fixture.pending[0].resolve({ success: true, bytes_transferred: 1000 });
    expect(await first.done).toMatchObject({ status: 'cancelled' });
    expect(fixture.pending[1].id).toBe(second.id);
    fixture.pending[1].resolve({ success: true, bytes_transferred: 1000 });
    expect(await second.done).toMatchObject({ status: 'completed' });
  });

  it('keeps cancellation when a pending enqueue later fails', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(invoke).mockImplementation((command, args) => command === 'enqueue_file_transfers'
      ? new Promise((_resolve, fail) => { reject = fail; })
      : fixture.invoke(command, args as Record<string, unknown>));
    const notice = vi.fn(); const off = onItemSettled(notice);
    const handle = submit(input());
    await waitFor(() => expect(reject).toBeDefined());
    handle.cancel(); reject(new Error('Connection closed'));
    expect(await handle.done).toMatchObject({ status: 'cancelled' });
    expect(getTransferById(handle.id)?.status).toBe('cancelled');
    expect(notice.mock.lastCall?.[0].status).toBe('cancelled'); off();
  });

  it('queued cancellation and clearing history cannot strand done promises', async () => {
    const first = submit(input('a')); const second = submit(input('b'));
    await waitFor(() => expect(fixture.pending).toHaveLength(1));
    second.cancel();
    expect(await second.done).toMatchObject({ status: 'cancelled' });
    await fixture.invoke('clear_completed_transfers');
    expect(getTransferById(second.id)).toBeUndefined();
    expect(fixture.pending).toHaveLength(1);
    first.cancel(); fixture.pending[0].resolve({ success: false }); await first.done;
  });

  it('all mounted queue views see native Finder jobs and reject older snapshots', async () => {
    const one = renderHook(() => useTransferQueue('one'));
    const two = renderHook(() => useTransferQueue('two'));
    await initializeTransferQueue();
    act(() => { fixture.accept([{ ...input('finder', 'two'), source: 'finder' }]); });
    expect(one.result.current.transfers[0].source).toBe('finder');
    expect(two.result.current.transfers).toBe(one.result.current.transfers);
    act(() => { fixture.broadcast({ revision: 0, items: [] }); });
    expect(one.result.current.transfers).toHaveLength(1);
    one.unmount();
    act(() => fixture.pending[0].resolve({ success: true, bytes_transferred: 1000 }));
    expect(two.result.current.transfers[0].status).toBe('completed');
  });

  it('subscribes before querying and never rolls back a newer event with bootstrap data', async () => {
    let query!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation((command, args) => command === 'get_transfer_queue' ? new Promise(resolve => { query = resolve; }) : fixture.invoke(command, args as Record<string, unknown>));
    const ready = initializeTransferQueue();
    await waitFor(() => expect(query).toBeDefined());
    fixture.accept([{ ...input(), id: 'native' }]);
    query({ revision: 0, items: [] }); await ready;
    expect(getTransferById('native')?.status).toBe('transferring');
  });

  it('notifies a terminal item once, and retries with a fresh identity', async () => {
    const listener = vi.fn(); const off = onItemSettled(listener);
    const transfer = submit(input());
    await waitFor(() => expect(fixture.pending).toHaveLength(1));
    fixture.pending[0].resolve({ success: false, error: 'write failed' }); await transfer.done;
    fixture.broadcast({ ...fixture.snapshot(), revision: fixture.snapshot().revision + 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    const id = await fixture.invoke('retry_transfer', { transferId: transfer.id });
    expect(id).not.toBe(transfer.id);
    cancelTransfer(transfer.id); // Stale id does not cancel the retry.
    expect(getTransferById(String(id))?.status).toBe('transferring'); off();
  });
});

describe('editor download lifecycle', () => {
  it('queues behind browser transfers and cancels on window/component teardown', async () => {
    const original = fixture.invoke;
    vi.mocked(invoke).mockImplementation((command, args) => command === 'get_home_directory' ? Promise.resolve('/tmp') : original(command, args as Record<string, unknown>));
    const browser = submit(input('browser'));
    await waitFor(() => expect(fixture.pending).toHaveLength(1));
    const view = render(<FileEditorView connectionId="one" filePath="/remote/archive.bin" fileName="archive.bin" isConnected />);
    fireEvent.click(screen.getByRole('button', { name: /Download.*Open/ }));
    await waitFor(() => expect(fixture.snapshot().items.some(item => item.source === 'editor')).toBe(true));
    expect(fixture.pending).toHaveLength(1);
    view.unmount();
    await waitFor(() => expect(fixture.snapshot().items.find(item => item.source === 'editor')?.status).toBe('cancelled'));
    fixture.pending[0].resolve({ success: true, bytes_transferred: 1000 }); await browser.done;
    expect(fixture.pending).toHaveLength(1);
    expect(invoke).not.toHaveBeenCalledWith('open_in_os', expect.anything());
  });

  it('opens only a successfully completed download and ignores cancellation', async () => {
    const original = fixture.invoke;
    vi.mocked(invoke).mockImplementation((command, args) => command === 'get_home_directory' ? Promise.resolve('/tmp') : original(command, args as Record<string, unknown>));
    render(<FileEditorView connectionId="one" filePath="/remote/archive.bin" fileName="archive.bin" isConnected />);
    fireEvent.click(screen.getByRole('button', { name: /Download.*Open/ }));
    await waitFor(() => expect(fixture.pending).toHaveLength(1));
    act(() => cancelTransfer(fixture.pending[0].id));
    await act(async () => { fixture.pending[0].resolve({ success: true, bytes_transferred: 1000 }); });
    expect(invoke).not.toHaveBeenCalledWith('open_in_os', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: /Download.*Open/ }));
    await waitFor(() => expect(fixture.pending).toHaveLength(2));
    await act(async () => { fixture.pending[1].resolve({ success: true, bytes_transferred: 1000 }); });
    expect(invoke).toHaveBeenCalledWith('open_in_os', { path: '/tmp/.skd-preview-archive.bin' });
  });
});
