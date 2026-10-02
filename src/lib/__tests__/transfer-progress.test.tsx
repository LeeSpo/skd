import React, { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Channel, invoke } from '@tauri-apps/api/core';
import { aggregateTransferBytes, createProgressAdapter, transferFile, useTransferScope, type TransferProgressEvent } from '@/lib/transfer-progress';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class<T> { onmessage: (message: T) => void = () => {}; },
}));

beforeEach(() => { vi.mocked(invoke).mockReset(); });

describe('transfer progress', () => {
  it('calculates speed from byte/time differences and caps progress until completion', () => {
    let time = 0;
    const report = vi.fn();
    const adapter = createProgressAdapter(report, () => true, () => time);
    adapter.receive({ bytesTransferred: 0, totalBytes: 1000 });
    time = 100;
    adapter.receive({ bytesTransferred: 200, totalBytes: 1000 });
    expect(report).toHaveBeenLastCalledWith({ bytesTransferred: 200, totalBytes: 1000, progress: 20, speed: 2000 });
    time = 200;
    adapter.receive({ bytesTransferred: 1000, totalBytes: 1000 });
    expect(report.mock.lastCall?.[0].progress).toBe(99);
    expect(report.mock.lastCall?.[0].speed).toBe(8000);
  });

  it('reports bytes and speed when total size is unknown, including empty files', () => {
    let time = 0;
    const report = vi.fn();
    const adapter = createProgressAdapter(report, () => true, () => time);
    adapter.receive({ bytesTransferred: 0, totalBytes: 0 });
    expect(report.mock.lastCall?.[0].speed).toBe(0);
    time = 1000;
    adapter.receive({ bytesTransferred: 700, totalBytes: null });
    expect(report).toHaveBeenLastCalledWith({ bytesTransferred: 700, totalBytes: null, progress: 0, speed: 700 });
  });

  it('ignores backwards, invalidated, and post-settlement messages', () => {
    let active = true;
    const report = vi.fn();
    const adapter = createProgressAdapter(report, () => active);
    adapter.receive({ bytesTransferred: 20, totalBytes: 100 });
    adapter.receive({ bytesTransferred: 10, totalBytes: 100 });
    active = false;
    adapter.receive({ bytesTransferred: 30, totalBytes: 100 });
    active = true;
    adapter.close();
    adapter.receive({ bytesTransferred: 40, totalBytes: 100 });
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('creates a separate channel per call and closes handlers after success or failure', async () => {
    const channels: Channel<TransferProgressEvent>[] = [];
    vi.mocked(invoke).mockImplementation(async (_, args) => {
      const channel = (args as { onProgress: Channel<TransferProgressEvent> }).onProgress;
      channels.push(channel);
      channel.onmessage({ bytesTransferred: 12, totalBytes: 12 });
      if (channels.length === 2) throw new Error('Disconnected');
      return { success: true, bytes_transferred: 12 };
    });
    const report = vi.fn();
    const params = { connectionId: 'session', localPath: '/local', remotePath: '/remote' };
    expect(await transferFile('upload', params, report)).toEqual({ success: true, bytes_transferred: 12 });
    await expect(transferFile('download', params, report)).rejects.toThrow('Disconnected');
    expect(channels[0]).not.toBe(channels[1]);
    const callCount = report.mock.calls.length;
    channels.forEach(channel => channel.onmessage({ bytesTransferred: 100, totalBytes: 100 }));
    expect(report).toHaveBeenCalledTimes(callCount);
    expect(invoke).toHaveBeenCalledWith('upload_remote_file', expect.objectContaining(params));
  });

  it('adds the current file to completed bytes without accumulating successive snapshots', () => {
    expect([10, 20, 30].map(bytes => aggregateTransferBytes(100, bytes))).toEqual([110, 120, 130]);
  });

  it('invalidates captured attempts on connection changes and unmount', () => {
    const hook = renderHook(({ id }) => useTransferScope(id), { initialProps: { id: 'one' } });
    const first = hook.result.current.capture();
    expect(first()).toBe(true);
    hook.rerender({ id: 'two' });
    expect(first()).toBe(false);
    const second = hook.result.current.capture();
    expect(second()).toBe(true);
    hook.unmount();
    expect(second()).toBe(false);
  });

  it('stays active after StrictMode effect replay', () => {
    const hook = renderHook(() => useTransferScope('one'), { wrapper: ({ children }) => <StrictMode>{children}</StrictMode> });
    let active: () => boolean;
    act(() => { active = hook.result.current.capture(); });
    expect(active!()).toBe(true);
    hook.unmount();
    expect(active!()).toBe(false);
  });
});
