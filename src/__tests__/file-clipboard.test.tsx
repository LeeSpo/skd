import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { FilePanel } from '@/components/file-panel';
import { IntegratedFileBrowser } from '@/components/integrated-file-browser';
import type { FileEntry } from '@/lib/file-entry-types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/use-webview-file-drop', () => ({ useWebviewFileDrop: () => ({ isDragOver: false }) }));
vi.mock('@/components/directory-tree', () => ({ DirectoryTree: () => null }));
vi.mock('@/components/transfer-queue', () => ({ TransferQueue: () => null }));
vi.mock('@/components/ui/resizable', () => ({
  ResizableHandle: () => null,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const file: FileEntry = {
  name: '报告 🦀.txt',
  file_type: 'File',
  size: 128,
  modified: '2026-01-01T10:00:00',
  permissions: '-rw-r--r--',
};
const browserWrite = vi.fn();
const variants = [
  { view: 'panel', mode: 'local', path: '/files/报告 🦀.txt', success: 'Path copied' },
  { view: 'panel', mode: 'remote', path: '/files/报告 🦀.txt', success: 'Path copied' },
  { view: 'browser', mode: 'local', path: '/Users/test/报告 🦀.txt', success: 'Path copied to clipboard' },
  { view: 'browser', mode: 'remote', path: '/home/报告 🦀.txt', success: 'Path copied to clipboard' },
] as const;
let session = 0;

function nativeCommand(command: string) {
  if (command === 'get_home_directory') return '/Users/test';
  if (command === 'list_local_files') return [file];
  if (command === 'list_files') return `-rw-r--r-- 1 alice staff 128 2026-01-01 10:00 ${file.name}`;
}

async function copyPath(variant: typeof variants[number]) {
  if (variant.view === 'panel') {
    render(<FilePanel mode={variant.mode} label={variant.mode} isActive initialPath="/files"
      onLoadDirectory={async () => [file]} onFocus={() => {}} />);
  } else if (variant.mode === 'local') {
    render(<IntegratedFileBrowser mode="local" />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('list_local_files', { path: '/Users/test' }));
  } else {
    render(<IntegratedFileBrowser mode="remote" connectionId={`file-clipboard-${++session}`} isConnected onClose={() => {}} />);
  }
  fireEvent.contextMenu(await screen.findByText(file.name));
  fireEvent.click(await screen.findByRole('menuitem', { name: /^Copy [Pp]ath$/ }));
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockImplementation(async (command) => nativeCommand(command));
  browserWrite.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: browserWrite },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(variants)('$view ($mode) copy path', (variant) => {
  it('uses the native clipboard and reports success only after the write completes', async () => {
    let finish!: () => void;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'write_clipboard_text') return new Promise<void>((resolve) => { finish = resolve; });
      return nativeCommand(command);
    });

    await copyPath(variant);

    expect(invoke).toHaveBeenCalledWith('write_clipboard_text', { text: variant.path });
    expect(browserWrite).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(variant.success);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reports rejected writes instead of claiming the path was copied', async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'write_clipboard_text') throw new Error('Clipboard unavailable');
      return nativeCommand(command);
    });

    await copyPath(variant);

    await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith('Failed to copy path to clipboard'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(browserWrite).not.toHaveBeenCalled();
  });
});

it('keeps browser-only path copying available without invoking the native bridge', async () => {
  vi.mocked(isTauri).mockReturnValue(false);

  await copyPath(variants[0]);

  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Path copied'));
  expect(browserWrite).toHaveBeenCalledExactlyOnceWith(variants[0].path);
  expect(invoke).not.toHaveBeenCalledWith('write_clipboard_text', expect.anything());
});

it('reports browser clipboard permission errors without claiming success', async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  browserWrite.mockRejectedValue(new DOMException('User activation is required', 'NotAllowedError'));

  await copyPath(variants[2]);

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to copy path to clipboard'));
  expect(toast.success).not.toHaveBeenCalled();
});
