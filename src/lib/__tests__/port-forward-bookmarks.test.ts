import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPortForwardBookmarks,
  deletePortForwardBookmark,
  deletePortForwardBookmarksForConnection,
  getAutoStartPortForwardBookmarks,
  getPortForwardBookmarks,
  savePortForwardBookmark,
  updatePortForwardBookmark,
} from '@/lib/port-forward-bookmarks';
import { ConnectionStorageManager } from '@/lib/connection-storage';

const input = (connectionProfileId: string, autoStart = false) => ({
  connectionProfileId,
  name: 'Database',
  localBindHost: '127.0.0.1',
  localPort: 15432,
  remoteHost: 'localhost',
  remotePort: 5432,
  autoStart,
});

describe('port forward bookmark storage', () => {
  beforeEach(() => {
    localStorage.clear();
    let sequence = 0;
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `generated-${++sequence}`) });
  });

  it('creates, filters, updates, and deletes bookmarks', () => {
    const first = savePortForwardBookmark(input('conn-1'));
    savePortForwardBookmark(input('conn-2', true));

    expect(getPortForwardBookmarks('conn-1')).toHaveLength(1);
    expect(getAutoStartPortForwardBookmarks('conn-1')).toHaveLength(0);
    expect(getAutoStartPortForwardBookmarks('conn-2')).toHaveLength(1);

    const updated = updatePortForwardBookmark(first.id, { name: 'Updated', autoStart: true });
    expect(updated?.name).toBe('Updated');
    expect(getAutoStartPortForwardBookmarks('conn-1')).toHaveLength(1);

    expect(deletePortForwardBookmark(first.id)).toBe(true);
    expect(getPortForwardBookmarks('conn-1')).toEqual([]);
  });

  it('isolates deletion by connection and supports clearing all', () => {
    savePortForwardBookmark(input('conn-1'));
    savePortForwardBookmark(input('conn-2'));
    deletePortForwardBookmarksForConnection('conn-1');
    expect(getPortForwardBookmarks().map((item) => item.connectionProfileId)).toEqual(['conn-2']);
    clearPortForwardBookmarks();
    expect(getPortForwardBookmarks()).toEqual([]);
  });

  it('falls back safely for corrupted or invalid storage', () => {
    localStorage.setItem('skd-port-forward-bookmarks', '{broken');
    expect(getPortForwardBookmarks()).toEqual([]);
    localStorage.setItem('skd-port-forward-bookmarks', JSON.stringify([{ id: 'invalid' }]));
    expect(getPortForwardBookmarks()).toEqual([]);
  });

  it('removes bookmarks when their saved connection is deleted', () => {
    const connection = ConnectionStorageManager.saveConnection({
      name: 'SSH host',
      host: 'example.com',
      port: 22,
      username: 'user',
      protocol: 'SSH',
    });
    savePortForwardBookmark(input(connection.id));
    expect(ConnectionStorageManager.deleteConnection(connection.id)).toBe(true);
    expect(getPortForwardBookmarks(connection.id)).toEqual([]);
  });
});
