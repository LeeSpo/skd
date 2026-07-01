import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { IntegratedFileBrowser } from '../components/integrated-file-browser';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'fileBrowser.column.name': 'Name',
        'fileBrowser.column.size': 'Size',
        'fileBrowser.column.modified': 'Modified',
        'fileBrowser.searchFiles': 'Search files...',
        'fileBrowser.items': `${String(params?.count ?? 0)} item(s)`,
        'fileBrowser.toolbar.back': 'Back',
        'fileBrowser.toolbar.forward': 'Forward',
        'fileBrowser.toolbar.parentDir': 'Parent',
        'fileBrowser.toolbar.home': 'Home',
        'fileBrowser.toolbar.refresh': 'Refresh',
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../components/directory-tree', () => ({
  DirectoryTree: () => <div data-testid="directory-tree" />,
}));

vi.mock('../components/transfer-queue', () => ({
  TransferQueue: () => null,
}));

vi.mock('../components/ui/resizable', () => ({
  ResizableHandle: () => <div data-testid="resize-handle" />,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="scroll-area">{children}</div>
  ),
}));

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockImplementation(async (command: string) => {
    if (command === 'get_home_directory') {
      return '/Users/test';
    }
    if (command === 'list_local_files') {
      return [
        {
          name: 'readme.md',
          file_type: 'File',
          size: 128,
          modified: '2026-01-01T10:00:00',
          permissions: '-rw-r--r--',
        },
      ];
    }
    throw new Error(`Unexpected invoke: ${command}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('IntegratedFileBrowser local mode', () => {
  it('renders shared remote-style chrome with fixed column headers', async () => {
    render(<IntegratedFileBrowser mode="local" />);

    await waitFor(() => {
      expect(screen.getByText('readme.md')).toBeTruthy();
    });

    expect(screen.getByTestId('directory-tree')).toBeTruthy();
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Size')).toBeTruthy();
    expect(screen.getByText('Modified')).toBeTruthy();
    expect(screen.queryByText('Permissions')).toBeNull();
    expect(screen.queryByText('Owner')).toBeNull();

    const scrollArea = screen.getByTestId('scroll-area');
    expect(scrollArea.contains(screen.getByText('readme.md'))).toBe(true);
    expect(document.querySelector('thead')).toBeNull();
    expect(document.querySelector('table')).toBeNull();
    expect(document.querySelector('.panel-toolbar')).not.toBeNull();
  });
});