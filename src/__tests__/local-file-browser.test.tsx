import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  localStorage.clear();
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
    if (command === 'list_files') {
      return '-rw-r--r-- 1 alice staff 128 2026-01-01 10:00 remote.txt';
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

  it('loads the directory reported by the active terminal when following is enabled', async () => {
    render(<IntegratedFileBrowser mode="local" terminalCwd="/tmp/project" />);

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_local_files', {
        path: '/tmp/project',
      });
    });

    expect(
      screen.getByRole('button', { name: 'fileBrowser.toolbar.followTerminal' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('keeps a manually opened folder until the terminal reports a new cwd', async () => {
    mockedInvoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'get_home_directory') return '/Users/test';
      if (command === 'list_local_files') {
        const path = (args as { path: string }).path;
        if (path === '/tmp/project') {
          return [{
            name: 'manual',
            file_type: 'Directory',
            size: 0,
            modified: '2026-01-01T10:00:00',
            permissions: 'drwxr-xr-x',
          }];
        }
        if (path === '/tmp/project/manual') {
          return [{
            name: 'inside.md',
            file_type: 'File',
            size: 64,
            modified: '2026-01-01T10:00:00',
            permissions: '-rw-r--r--',
          }];
        }
        if (path === '/var/next') {
          return [{
            name: 'next.md',
            file_type: 'File',
            size: 64,
            modified: '2026-01-01T10:00:00',
            permissions: '-rw-r--r--',
          }];
        }
        return [];
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    const view = render(
      <IntegratedFileBrowser mode="local" terminalCwd="/tmp/project" />,
    );
    const manualFolder = await screen.findByText('manual');

    fireEvent.doubleClick(manualFolder);

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_local_files', {
        path: '/tmp/project/manual',
      });
      expect(screen.getByText('inside.md')).toBeTruthy();
    });
    expect(
      screen.getByRole('button', { name: 'fileBrowser.toolbar.followTerminal' })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    view.rerender(
      <IntegratedFileBrowser mode="local" terminalCwd="/var/next" />,
    );

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_local_files', {
        path: '/var/next',
      });
      expect(screen.getByText('next.md')).toBeTruthy();
    });
  });

  it('loads the reported directory for a connected SSH terminal', async () => {
    render(
      <IntegratedFileBrowser
        mode="remote"
        connectionId="ssh-1"
        host="example.test"
        isConnected
        terminalCwd="/srv/project"
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_files', {
        connectionId: 'ssh-1',
        path: '/srv/project',
      });
    });
    expect(screen.getByText('remote.txt')).toBeTruthy();
  });

  it('does not follow until the persisted follow toggle is enabled', async () => {
    localStorage.setItem('skd-follow-terminal-cwd', 'false');
    render(<IntegratedFileBrowser mode="local" terminalCwd="/tmp/disabled-target" />);

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('get_home_directory');
    });
    expect(mockedInvoke).not.toHaveBeenCalledWith('list_local_files', {
      path: '/tmp/disabled-target',
    });

    const followButton = screen.getByRole('button', {
      name: 'fileBrowser.toolbar.followTerminal',
    });
    expect(followButton.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(followButton);

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_local_files', {
        path: '/tmp/disabled-target',
      });
    });
  });

  it('keeps the current listing when a reported directory cannot be loaded', async () => {
    mockedInvoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'get_home_directory') return '/Users/test';
      if (command === 'list_local_files') {
        const path = (args as { path: string }).path;
        if (path === '/missing') throw new Error('Directory not found');
        return [{
          name: 'readme.md',
          file_type: 'File',
          size: 128,
          modified: '2026-01-01T10:00:00',
          permissions: '-rw-r--r--',
        }];
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });
    const view = render(<IntegratedFileBrowser mode="local" />);
    await screen.findByText('readme.md');

    view.rerender(<IntegratedFileBrowser mode="local" terminalCwd="/missing" />);
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_local_files', { path: '/missing' });
    });
    expect(screen.getByText('readme.md')).toBeTruthy();
  });
});
