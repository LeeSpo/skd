import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionManager } from '../components/connection-manager';
import { ConnectionStorageManager } from '../lib/connection-storage';

describe('ConnectionManager tree layout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
      expect.arrayContaining(['h-4', 'w-4', 'shrink-0']),
    );
    expect(Array.from(longRow?.firstElementChild?.classList ?? [])).toEqual(
      expect.arrayContaining(['h-4', 'w-4', 'shrink-0']),
    );
    expect(shortRow?.querySelector('svg')?.parentElement?.classList.contains('shrink-0')).toBe(true);
    expect(longRow?.querySelector('svg')?.parentElement?.classList.contains('shrink-0')).toBe(true);
    expect(Array.from(rootRow?.querySelector('button')?.classList ?? [])).toEqual(
      expect.arrayContaining(['h-4', 'w-4', 'shrink-0']),
    );

    expect(rootRow?.style.paddingLeft).toBe('8px');
    expect(shortRow?.style.paddingLeft).toBe('24px');
    expect(nestedRow?.style.paddingLeft).toBe('40px');
  });
});
