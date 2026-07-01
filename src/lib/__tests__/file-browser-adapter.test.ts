import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  createLocalAdapter,
  mapLocalEntriesToFileItems,
} from '../file-browser-adapter';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe('file-browser-adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps local FileEntry rows to FileBrowserFileItem', () => {
    const items = mapLocalEntriesToFileItems(
      [
        {
          name: 'readme.md',
          file_type: 'File',
          size: 128,
          modified: '2026-01-01T10:00:00',
          permissions: '-rw-r--r--',
        },
        {
          name: 'docs',
          file_type: 'Directory',
          size: 0,
          modified: null,
          permissions: 'drwxr-xr-x',
        },
      ],
      '/Users/test',
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: 'readme.md',
      type: 'file',
      path: '/Users/test/readme.md',
    });
    expect(items[1]).toMatchObject({
      name: 'docs',
      type: 'directory',
      path: '/Users/test/docs',
    });
  });

  it('local adapter prepends parent navigation entry', async () => {
    mockedInvoke.mockResolvedValueOnce([
      {
        name: 'readme.md',
        file_type: 'File',
        size: 128,
        modified: '2026-01-01T10:00:00',
        permissions: '-rw-r--r--',
      },
    ]);

    const adapter = createLocalAdapter();
    const files = await adapter.listDirectory('/Users/test', () => false);

    expect(files[0]?.name).toBe('..');
    expect(files[0]?.type).toBe('directory');
    expect(files[1]?.name).toBe('readme.md');
  });
});