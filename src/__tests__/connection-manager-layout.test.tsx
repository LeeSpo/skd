import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionManager } from '../components/connection-manager';
import { ConnectionStorageManager } from '../lib/connection-storage';
import { treeRowState } from '../lib/panel-layout-styles';

describe('ConnectionManager tree layout', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('distinguishes persistent sidebar selection from pointer hover', () => {
    expect(treeRowState({ selected: true, variant: 'sidebar' })).toContain('sidebar-row-selected');
    expect(treeRowState({ selected: true, variant: 'sidebar' })).not.toContain('hover:bg-surface-hover');
    expect(treeRowState({ variant: 'sidebar' })).toContain('sidebar-row');
    expect(treeRowState({ variant: 'sidebar' })).not.toContain('sidebar-row-selected');
    expect(treeRowState({ variant: 'sidebar' })).toContain('rounded-md');
  });

  it('exposes folder disclosure and activates it once without bubbling', () => {
    vi.spyOn(ConnectionStorageManager, 'buildConnectionTree').mockReturnValue([
      { id: 'folder', name: 'Production', type: 'folder', isExpanded: false, children: [] },
    ]);
    const onSelect = vi.fn();
    render(<ConnectionManager onConnectionSelect={onSelect} selectedConnectionId={null} />);
    const disclosure = screen.getByRole('button', { name: 'Production', expanded: false });
    expect(disclosure.tabIndex).toBe(0);
    disclosure.focus();
    expect(document.activeElement).toBe(disclosure);
    fireEvent.click(disclosure);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Production', expanded: true })).toBe(disclosure);
    fireEvent.click(disclosure);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps actions accessible and only offers details for a selected connection', () => {
    vi.spyOn(ConnectionStorageManager, 'buildConnectionTree').mockReturnValue([
      { id: 'host', name: 'Production', type: 'connection', protocol: 'SSH', host: 'example.test' },
    ]);
    const onNewConnection = vi.fn();
    const { container, rerender } = render(
      <ConnectionManager onConnectionSelect={() => {}} selectedConnectionId={null} onNewConnection={onNewConnection} />,
    );
    expect(container.querySelector('details')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New Connection' }));
    expect(onNewConnection).toHaveBeenCalledOnce();
    rerender(<ConnectionManager onConnectionSelect={() => {}} selectedConnectionId="host" />);
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toContain('Connection Details');
    expect(details?.textContent).toContain('example.test');
  });

  it('finds hosts and usernames inside collapsed folders without losing disclosure state', () => {
    vi.spyOn(ConnectionStorageManager, 'buildConnectionTree').mockReturnValue([
      { id: 'folder', name: 'Production', type: 'folder', path: 'Production', isExpanded: false, children: [
        { id: 'api', name: 'API', type: 'connection', host: 'api.example.test', username: 'deploy' },
        { id: 'db', name: 'Database', type: 'connection', host: 'db.example.test', username: 'admin' },
      ] },
    ]);
    render(<ConnectionManager onConnectionSelect={vi.fn()} selectedConnectionId={null} />);
    const search = screen.getByRole('textbox', { name: 'Search connections' });
    fireEvent.change(search, { target: { value: 'API.EXAMPLE' } });
    expect(screen.getByRole('button', { name: 'API' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Database' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Production', expanded: true })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'admin' } });
    expect(screen.getByRole('button', { name: 'Database' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'API' })).toBeNull();
    fireEvent.change(search, { target: { value: 'missing' } });
    expect(screen.getByRole('status').textContent).toContain('No matching connections');
    fireEvent.keyDown(search, { key: 'Escape', isComposing: true });
    expect((search as HTMLInputElement).value).toBe('missing');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect((search as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Production', expanded: false })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'API' })).toBeNull();
  });

  it('selects a connection with Space and connects with Enter, while respecting composition', () => {
    const host = { id: 'api', name: 'API', type: 'connection' as const, host: 'example.test' };
    vi.spyOn(ConnectionStorageManager, 'buildConnectionTree').mockReturnValue([host]);
    const select = vi.fn();
    const connect = vi.fn();
    render(<ConnectionManager onConnectionSelect={select} onConnectionConnect={connect} selectedConnectionId={null} />);
    const row = screen.getByRole('button', { name: 'API' });
    row.focus();
    expect(document.activeElement).toBe(row);
    fireEvent.keyDown(row, { key: ' ' });
    expect(select).toHaveBeenCalledExactlyOnceWith(host);
    fireEvent.keyDown(row, { key: 'Enter', isComposing: true });
    expect(connect).not.toHaveBeenCalled();
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(connect).toHaveBeenCalledExactlyOnceWith(host);
  });

  it('disables browser text selection in the connection browser but preserves details and dragging', () => {
    vi.spyOn(ConnectionStorageManager, 'buildConnectionTree').mockReturnValue([
      { id: 'host', name: 'Production', type: 'connection', protocol: 'SSH', host: 'example.test' },
    ]);
    render(<ConnectionManager onConnectionSelect={() => {}} selectedConnectionId="host" />);

    const heading = screen.getByRole('heading', { name: 'Connections' });
    const browser = heading.closest('.select-none');
    expect(browser).not.toBeNull();
    const row = document.querySelector('[data-draggable="true"]');
    expect(row).not.toBeNull();
    expect(browser?.contains(row)).toBe(true);
    expect(screen.getByText('example.test').closest('.select-none')).toBeNull();
  });
});
