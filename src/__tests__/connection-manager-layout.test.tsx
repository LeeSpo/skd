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
    expect(treeRowState({ selected: true, variant: 'sidebar' })).toContain('bg-surface-selected');
    expect(treeRowState({ selected: true, variant: 'sidebar' })).not.toContain('hover:bg-sidebar-accent');
    expect(treeRowState({ variant: 'sidebar' })).toContain('hover:bg-sidebar-accent');
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

  it('disables browser text selection in the connection browser but preserves details and dragging', () => {
    vi.spyOn(ConnectionStorageManager, 'buildConnectionTree').mockReturnValue([
      { id: 'host', name: 'Production', type: 'connection', protocol: 'SSH', host: 'example.test' },
    ]);
    render(<ConnectionManager onConnectionSelect={() => {}} selectedConnectionId="host" />);

    const heading = screen.getByRole('heading', { name: 'Connections' });
    const browser = heading.closest('.select-none');
    expect(browser).not.toBeNull();
    const row = document.querySelector('[draggable="true"]');
    expect(row).not.toBeNull();
    expect(browser?.contains(row)).toBe(true);
    expect(screen.getByText('example.test').closest('.select-none')).toBeNull();
  });

  it('keeps connection icon slots fixed and truncates long names at each tree depth', () => {
    vi.spyOn(ConnectionStorageManager, 'buildConnectionTree').mockReturnValue([
      {
        id: 'root',
        name: 'All Connections',
        type: 'folder',
        path: 'All Connections',
        isExpanded: true,
        children: [
          {
            id: 'short',
            name: 'pie',
            type: 'connection',
            protocol: 'SSH',
          },
          {
            id: 'long',
            name: 'download.mmdots.de.with.a.very.long.connection.name',
            type: 'connection',
            protocol: 'SSH',
          },
          {
            id: 'nested-folder',
            name: 'Production',
            type: 'folder',
            path: 'All Connections/Production',
            isExpanded: true,
            children: [
              {
                id: 'nested',
                name: '130.33.98.130',
                type: 'connection',
                protocol: 'SSH',
              },
            ],
          },
        ],
      },
    ]);

    render(
      <ConnectionManager
        onConnectionSelect={() => {}}
        selectedConnectionId={null}
      />,
    );

    const shortName = screen.getByText('pie');
    const longName = screen.getByText('download.mmdots.de.with.a.very.long.connection.name');
    const nestedName = screen.getByText('130.33.98.130');
    const rootName = screen.getByText('All Connections');

    expect(Array.from(longName.classList)).toEqual(
      expect.arrayContaining(['min-w-0', 'flex-1', 'truncate']),
    );

    const shortRow = shortName.parentElement;
    const longRow = longName.parentElement;
    const nestedRow = nestedName.parentElement;
    const rootRow = rootName.parentElement;

    expect(Array.from(shortRow?.firstElementChild?.classList ?? [])).toEqual(
      expect.arrayContaining(['h-4', 'w-5', 'shrink-0']),
    );
    expect(Array.from(longRow?.firstElementChild?.classList ?? [])).toEqual(
      expect.arrayContaining(['h-4', 'w-5', 'shrink-0']),
    );
    expect(shortRow?.querySelector('svg')?.parentElement?.classList.contains('shrink-0')).toBe(true);
    expect(shortRow?.querySelector('svg')?.classList.contains('text-muted-foreground')).toBe(true);
    expect(longRow?.querySelector('svg')?.parentElement?.classList.contains('shrink-0')).toBe(true);
    expect(Array.from(rootRow?.querySelector('button')?.classList ?? [])).toEqual(
      expect.arrayContaining(['h-5', 'w-5', 'shrink-0']),
    );

    expect(rootRow?.style.paddingLeft).toBe('4px');
    expect(shortRow?.style.paddingLeft).toBe('16px');
    expect(nestedRow?.style.paddingLeft).toBe('28px');
  });
});
