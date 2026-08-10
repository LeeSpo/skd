import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewTabMenu } from '@/components/terminal/new-tab-menu';
import { filterConnections } from '@/lib/new-tab-menu-utils';
import type { ConnectionData } from '@/lib/connection-storage';

const connections: ConnectionData[] = [
  {
    id: 'prod',
    name: 'Production',
    host: 'prod.example.com',
    port: 22,
    username: 'deploy',
    protocol: 'SSH',
    folder: 'All Connections/Work',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastConnected: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'archive',
    name: 'Archive',
    host: 'files.example.com',
    port: 22,
    username: 'reader',
    protocol: 'SFTP',
    folder: 'All Connections/Storage',
    createdAt: '2026-01-02T00:00:00.000Z',
    lastConnected: '2026-08-01T00:00:00.000Z',
  },
];

describe('filterConnections', () => {
  it('matches connection metadata case-insensitively', () => {
    expect(filterConnections(connections, 'PROD').map(({ id }) => id)).toEqual(['prod']);
    expect(filterConnections(connections, 'reader').map(({ id }) => id)).toEqual(['archive']);
    expect(filterConnections(connections, 'sftp').map(({ id }) => id)).toEqual(['archive']);
    expect(filterConnections(connections, 'storage').map(({ id }) => id)).toEqual(['archive']);
  });
});

describe('NewTabMenu', () => {
  beforeEach(() => {
    localStorage.setItem('skd-connections', JSON.stringify(connections));
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens a picker without immediately creating a connection', async () => {
    const onNewConnection = vi.fn();
    render(<NewTabMenu groupId="group-2" onNewConnection={onNewConnection} />);

    const trigger = screen.getByRole('button', { name: 'Open New Tab' });
    fireEvent.click(trigger);

    expect(onNewConnection).not.toHaveBeenCalled();
    expect(trigger.className).toContain('bg-accent');
    const search = await screen.findByPlaceholderText('Search saved connections...');
    expect(document.activeElement).toBe(search);
    expect(screen.queryByText('Recent Connections')).not.toBeNull();
    expect(screen.queryByText('All Connections')).not.toBeNull();
  });

  it('searches saved connections and opens the result in the originating group', async () => {
    const onOpenSavedConnection = vi.fn();
    render(
      <NewTabMenu
        groupId="group-2"
        onOpenSavedConnection={onOpenSavedConnection}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open New Tab' }));
    const search = await screen.findByPlaceholderText('Search saved connections...');
    fireEvent.change(search, { target: { value: 'files.example.com' } });

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('option')).toHaveLength(1);
    fireEvent.click(within(listbox).getByRole('option'));

    expect(onOpenSavedConnection).toHaveBeenCalledWith('archive', 'group-2');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('supports keyboard selection and explicit create actions', async () => {
    const onOpenSavedConnection = vi.fn();
    const onNewConnection = vi.fn();
    const onNewLocalTerminal = vi.fn();
    render(
      <NewTabMenu
        groupId="group-3"
        onOpenSavedConnection={onOpenSavedConnection}
        onNewConnection={onNewConnection}
        onNewLocalTerminal={onNewLocalTerminal}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open New Tab' }));
    const search = await screen.findByPlaceholderText('Search saved connections...');
    fireEvent.change(search, { target: { value: 'production' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onOpenSavedConnection).toHaveBeenCalledWith('prod', 'group-3');

    fireEvent.click(screen.getByRole('button', { name: 'Open New Tab' }));
    fireEvent.click(await screen.findByRole('button', { name: 'New Connection...' }));
    expect(onNewConnection).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Open New Tab' }));
    fireEvent.click(await screen.findByRole('button', { name: 'New Local Terminal' }));
    expect(onNewLocalTerminal).toHaveBeenCalledOnce();
  });
});
