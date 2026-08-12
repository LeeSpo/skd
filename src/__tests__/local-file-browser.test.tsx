import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { IntegratedFileBrowser } from '../components/integrated-file-browser';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
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
  DirectoryTree: ({ dropTargetPath }: { dropTargetPath?: string | null }) => (
    <div data-testid="directory-tree">
      <div
        data-testid="tree-drop-target"
        data-directory-path="/target"
        data-drop-target={dropTargetPath === '/target' ? 'true' : undefined}
      />
    </div>
  ),
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
  it('keeps the first file selected when Command-clicking a second file', async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === 'get_home_directory') return '/Users/test';
      if (command === 'list_local_files') {
        return [
          { name: 'first.txt', file_type: 'File', size: 1, modified: '2026-01-01T10:00:00', permissions: '-rw-r--r--' },
          { name: 'second.txt', file_type: 'File', size: 1, modified: '2026-01-01T10:00:00', permissions: '-rw-r--r--' },
        ];
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<IntegratedFileBrowser mode="local" />);

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_local_files', { path: '/Users/test' });
    });
    fireEvent.click(screen.getByText('first.txt'));
    fireEvent.click(screen.getByText('second.txt'), { metaKey: true });

    await waitFor(() => {
      expect(screen.getByText('first.txt').closest('[role="row"]')?.getAttribute('aria-selected')).toBe('true');
      expect(screen.getByText('second.txt').closest('[role="row"]')?.getAttribute('aria-selected')).toBe('true');
    });
  });

  it('selects and merges ranges with Shift and Command-Shift clicks', async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === 'get_home_directory') return '/Users/test';
      if (command === 'list_local_files') {
        return ['alpha.txt', 'bravo.txt', 'charlie.txt', 'delta.txt'].map((name) => ({
          name,
          file_type: 'File',
          size: 1,
          modified: '2026-01-01T10:00:00',
          permissions: '-rw-r--r--',
        }));
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<IntegratedFileBrowser mode="local" />);
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_local_files', { path: '/Users/test' });
    });

    fireEvent.click(screen.getByText('bravo.txt'));
    fireEvent.click(screen.getByText('delta.txt'), { shiftKey: true });
    expect(screen.getAllByRole('row').filter((row) => row.getAttribute('aria-selected') === 'true')).toHaveLength(3);

    fireEvent.click(screen.getByText('alpha.txt'), { metaKey: true, shiftKey: true });
    expect(screen.getAllByRole('row').filter((row) => row.getAttribute('aria-selected') === 'true')).toHaveLength(4);
  });

  it('selects only visible items with Command-A and clears from empty space or Escape', async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === 'get_home_directory') return '/Users/test';
      if (command === 'list_local_files') {
        return ['alpha.txt', 'bravo.txt'].map((name) => ({
          name,
          file_type: 'File',
          size: 1,
          modified: '2026-01-01T10:00:00',
          permissions: '-rw-r--r--',
        }));
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<IntegratedFileBrowser mode="local" />);
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_local_files', { path: '/Users/test' });
    });

    fireEvent.change(screen.getByPlaceholderText('Search files...'), { target: { value: 'alpha' } });
    fireEvent.keyDown(document, { key: 'a', metaKey: true });
    expect(screen.getByText('alpha.txt').closest('[role="row"]')?.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText('bravo.txt')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search files...'), { target: { value: '' } });
    expect(screen.getByText('bravo.txt').closest('[role="row"]')?.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByText('..').closest('[role="row"]')?.hasAttribute('aria-selected')).toBe(false);

    fireEvent.click(screen.getByRole('grid'));
    expect(screen.getByText('alpha.txt').closest('[role="row"]')?.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(screen.getByText('alpha.txt'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('alpha.txt').closest('[role="row"]')?.getAttribute('aria-selected')).toBe('false');
  });

  it('confirms a multi-item delete once and keeps failed items selected', async () => {
    mockedInvoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'get_home_directory') return '/Users/test';
      if (command === 'list_local_files') {
        return ['alpha.txt', 'bravo.txt'].map((name) => ({
          name,
          file_type: 'File',
          size: 1,
          modified: '2026-01-01T10:00:00',
          permissions: '-rw-r--r--',
        }));
      }
      if (command === 'delete_local_item') {
        if ((args as { path: string }).path.endsWith('/alpha.txt')) throw new Error('locked');
        return undefined;
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<IntegratedFileBrowser mode="local" />);
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_local_files', { path: '/Users/test' });
    });
    fireEvent.click(screen.getByText('alpha.txt'));
    fireEvent.click(screen.getByText('bravo.txt'), { metaKey: true });
    fireEvent.keyDown(document, { key: 'Delete' });

    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('delete_local_item', {
        path: '/Users/test/alpha.txt',
        isDirectory: false,
      });
      expect(mockedInvoke).toHaveBeenCalledWith('delete_local_item', {
        path: '/Users/test/bravo.txt',
        isDirectory: false,
      });
      expect(screen.getByText('alpha.txt').closest('[role="row"]')?.getAttribute('aria-selected')).toBe('true');
      expect(screen.getByText('bravo.txt').closest('[role="row"]')?.getAttribute('aria-selected')).toBe('false');
    });
  });

  it('preserves a multi-selection when right-clicking a selected row', async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === 'get_home_directory') return '/Users/test';
      if (command === 'list_local_files') {
        return ['alpha.txt', 'bravo.txt'].map((name) => ({
          name,
          file_type: 'File',
          size: 1,
          modified: '2026-01-01T10:00:00',
          permissions: '-rw-r--r--',
        }));
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<IntegratedFileBrowser mode="local" />);
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_local_files', { path: '/Users/test' });
    });
    fireEvent.click(screen.getByText('alpha.txt'));
    fireEvent.click(screen.getByText('bravo.txt'), { metaKey: true });
    fireEvent.contextMenu(screen.getByText('alpha.txt'));

    expect(screen.getByText('alpha.txt').closest('[role="row"]')?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('bravo.txt').closest('[role="row"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('omits leftover separators when right-clicking a local multi-selection', async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === 'get_home_directory') return '/Users/test';
      if (command === 'list_local_files') {
        return ['alpha.txt', 'bravo.txt'].map((name) => ({
          name,
          file_type: 'File',
          size: 1,
          modified: '2026-01-01T10:00:00',
          permissions: '-rw-r--r--',
        }));
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<IntegratedFileBrowser mode="local" />);
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_local_files', { path: '/Users/test' });
    });
    fireEvent.click(screen.getByText('alpha.txt'));
    fireEvent.click(screen.getByText('bravo.txt'), { metaKey: true });
    fireEvent.contextMenu(screen.getByText('alpha.txt'));

    const menu = await screen.findByRole('menu');
    expect(menu.textContent).toContain('fileBrowser.contextMenu.delete');
    expect(menu.textContent).not.toContain('fileBrowser.contextMenu.rename');
    expect(menu.textContent).not.toContain('fileBrowser.contextMenu.copyPath');
    expect(menu.textContent).not.toContain('filePanel.contextMenu.openInOS');
    expect(menu.querySelectorAll('[data-slot="context-menu-separator"]')).toHaveLength(0);
  });

  it('keeps single-file menu sections separated without stacking empty rules', async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === 'get_home_directory') return '/Users/test';
      if (command === 'list_local_files') {
        return ['alpha.txt'].map((name) => ({
          name,
          file_type: 'File',
          size: 1,
          modified: '2026-01-01T10:00:00',
          permissions: '-rw-r--r--',
        }));
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<IntegratedFileBrowser mode="local" />);
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_local_files', { path: '/Users/test' });
    });
    fireEvent.contextMenu(screen.getByText('alpha.txt'));

    const menu = await screen.findByRole('menu');
    expect(menu.textContent).toContain('filePanel.contextMenu.openInOS');
    expect(menu.textContent).toContain('fileBrowser.contextMenu.rename');
    expect(menu.textContent).toContain('fileBrowser.contextMenu.copyPath');
    expect(menu.textContent).toContain('fileBrowser.contextMenu.fileInfo');
    expect(menu.textContent).toContain('fileBrowser.contextMenu.delete');

    const separators = [...menu.querySelectorAll('[data-slot="context-menu-separator"]')];
    expect(separators.length).toBeGreaterThan(0);
    for (const separator of separators) {
      const previous = separator.previousElementSibling;
      expect(previous?.getAttribute('data-slot')).not.toBe('context-menu-separator');
    }
  });

  it('moves the selected files when they are dragged onto a directory tree row', async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === 'get_home_directory') return '/Users/test';
      if (command === 'list_local_files') {
        return ['alpha.txt', 'bravo.txt'].map((name) => ({
          name,
          file_type: 'File',
          size: 1,
          modified: '2026-01-01T10:00:00',
          permissions: '-rw-r--r--',
        }));
      }
      if (command === 'move_file_items') return { conflicts: [], results: [
        { name: 'alpha.txt', success: true },
        { name: 'bravo.txt', success: true },
      ] };
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<IntegratedFileBrowser mode="local" />);
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_local_files', { path: '/Users/test' });
    });
    fireEvent.click(screen.getByText('alpha.txt'));
    fireEvent.click(screen.getByText('bravo.txt'), { metaKey: true });
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => screen.getByTestId('tree-drop-target')),
    });

    const row = screen.getByText('alpha.txt').closest('[role="row"]') as HTMLElement;
    fireEvent.pointerDown(row, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 20, clientY: 20 });
    expect(screen.getByTestId('tree-drop-target').getAttribute('data-drop-target')).toBe('true');
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 20, clientY: 20 });

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('move_file_items', {
        request: {
          mode: 'local',
          connectionId: null,
          targetDirectory: '/target',
          items: [
            { name: 'alpha.txt', path: '/Users/test/alpha.txt', isDirectory: false },
            { name: 'bravo.txt', path: '/Users/test/bravo.txt', isDirectory: false },
          ],
          overwrite: false,
        },
      });
    });
  });

  it('starts one native Finder drag containing the full local selection', async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === 'get_home_directory') return '/Users/test';
      if (command === 'list_local_files') {
        return [
          { name: 'alpha.txt', file_type: 'File' },
          { name: 'folder', file_type: 'Directory' },
        ].map((entry) => ({
          ...entry,
          size: 1,
          modified: '2026-01-01T10:00:00',
          permissions: entry.file_type === 'Directory' ? 'drwxr-xr-x' : '-rw-r--r--',
        }));
      }
      if (command === 'start_native_file_drag') {
        return { startedCount: 2, skippedDirectories: [] };
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<IntegratedFileBrowser mode="local" />);
    await screen.findByText('alpha.txt');
    fireEvent.click(screen.getByText('alpha.txt'));
    fireEvent.click(screen.getByText('folder'), { metaKey: true });

    const row = screen.getByText('alpha.txt').closest('[role="row"]') as HTMLElement;
    fireEvent.pointerDown(row, { button: 0, pointerId: 7, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(document, { pointerId: 7, clientX: 30, clientY: 30 });
    fireEvent.pointerOut(document, { pointerId: 7, relatedTarget: null });

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('start_native_file_drag', {
        items: [
          {
            mode: 'local',
            connectionId: null,
            name: 'alpha.txt',
            path: '/Users/test/alpha.txt',
            isDirectory: false,
          },
          {
            mode: 'local',
            connectionId: null,
            name: 'folder',
            path: '/Users/test/folder',
            isDirectory: true,
          },
        ],
      });
    });
  });

  it('preflights a tree move and retries the whole selection after one overwrite confirmation', async () => {
    let moveAttempt = 0;
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === 'get_home_directory') return '/Users/test';
      if (command === 'list_local_files') {
        return [{
          name: 'alpha.txt',
          file_type: 'File',
          size: 1,
          modified: '2026-01-01T10:00:00',
          permissions: '-rw-r--r--',
        }];
      }
      if (command === 'move_file_items') {
        moveAttempt += 1;
        return moveAttempt === 1
          ? { conflicts: ['alpha.txt'], results: [] }
          : { conflicts: [], results: [{ name: 'alpha.txt', success: true }] };
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(<IntegratedFileBrowser mode="local" />);
    const file = await screen.findByText('alpha.txt');
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => screen.getByTestId('tree-drop-target')),
    });
    fireEvent.pointerDown(file.closest('[role="row"]') as HTMLElement, {
      button: 0,
      pointerId: 9,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(document, { pointerId: 9, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(document, { pointerId: 9, clientX: 20, clientY: 20 });

    await screen.findByText('fileBrowser.moveConflictTitle');
    fireEvent.click(screen.getByText('fileBrowser.overwriteAndMove'));

    await waitFor(() => {
      const moveCalls = mockedInvoke.mock.calls.filter(([command]) => command === 'move_file_items');
      expect(moveCalls).toHaveLength(2);
      expect(moveCalls[0]?.[1]).toMatchObject({ request: { overwrite: false } });
      expect(moveCalls[1]?.[1]).toMatchObject({ request: { overwrite: true } });
    });
  });

  it('exports remote files as promises while skipping selected remote directories', async () => {
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === 'list_files') {
        return [
          'drwxr-xr-x 1 user users 0 2026-01-01 10:00 folder',
          '-rw-r--r-- 1 user users 1 2026-01-01 10:00 alpha.txt',
        ].join('\n');
      }
      if (command === 'start_native_file_drag') {
        return { startedCount: 1, skippedDirectories: [] };
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    render(
      <IntegratedFileBrowser
        mode="remote"
        connectionId="ssh-1"
        isConnected
        onClose={() => {}}
      />,
    );
    await screen.findByText('alpha.txt');
    fireEvent.click(screen.getByText('folder'));
    fireEvent.click(screen.getByText('alpha.txt'), { metaKey: true });

    const row = screen.getByText('alpha.txt').closest('[role="row"]') as HTMLElement;
    fireEvent.pointerDown(row, { button: 0, pointerId: 11, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(document, { pointerId: 11, clientX: 30, clientY: 30 });
    fireEvent.pointerOut(document, { pointerId: 11, relatedTarget: null });

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('start_native_file_drag', {
        items: [{
          mode: 'remote',
          connectionId: 'ssh-1',
          name: 'alpha.txt',
          path: '/home/alpha.txt',
          isDirectory: false,
        }],
      });
    });
  });

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

    fireEvent.click(manualFolder);
    expect(screen.getByText('fileBrowser.selected')).toBeTruthy();
    fireEvent.doubleClick(manualFolder);

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith('list_local_files', {
        path: '/tmp/project/manual',
      });
      expect(screen.getByText('inside.md')).toBeTruthy();
      expect(screen.queryByText('fileBrowser.selected')).toBeNull();
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
