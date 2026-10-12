import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStorageManager as storage } from '@/lib/connection-storage';

function fixture() {
  const root = storage.createFolder('All Connections');
  const work = storage.createFolder('Work', root.path);
  const production = storage.createFolder('Production', work.path);
  const databases = storage.createFolder('Databases', production.path);
  const destination = storage.createFolder('Personal', root.path);
  const existing = storage.createFolder('Existing', destination.path);
  const first = storage.saveConnection({
    name: 'First', host: 'first.example', port: 22, username: 'user', protocol: 'SSH', folder: work.path,
    hasStoredPassword: true, authMethod: 'password',
  });
  const nested = storage.saveConnection({
    name: 'Nested', host: 'nested.example', port: 22, username: 'user', protocol: 'SSH', folder: databases.path,
    hasStoredPrivateKey: true, privateKeySource: 'path', privateKeyPath: '/example/key',
  });
  const unrelated = storage.saveConnection({
    name: 'Unrelated', host: 'other.example', port: 22, username: 'user', protocol: 'SSH', folder: existing.path,
  });
  return { root, work, production, databases, destination, existing, first, nested, unrelated };
}

function snapshot() {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!)
    .sort().map((key) => [key, localStorage.getItem(key)]);
}

describe('ConnectionStorageManager.moveFolder', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('moves an entire subtree, preserves identities and credentials, and appends after target siblings', () => {
    const { work, production, databases, destination, existing, first, nested, unrelated } = fixture();
    const beforeFolders = storage.getFolders();
    const beforeConnections = storage.getConnections();
    expect(storage.moveFolder(work.id, destination.path)).toBe(true);
    const movedPath = `${destination.path}/Work`;
    expect(storage.getFolders().find((folder) => folder.id === work.id)).toEqual({
      ...work, path: movedPath, parentPath: destination.path,
    });
    expect(storage.getFolders().find((folder) => folder.id === production.id)).toEqual({
      ...production, path: `${movedPath}/Production`, parentPath: movedPath,
    });
    expect(storage.getFolders().find((folder) => folder.id === databases.id)).toEqual({
      ...databases, path: `${movedPath}/Production/Databases`, parentPath: `${movedPath}/Production`,
    });
    expect(storage.getConnection(first.id)).toEqual({ ...first, folder: movedPath });
    expect(storage.getConnection(nested.id)).toEqual({ ...nested, folder: `${movedPath}/Production/Databases` });
    expect(storage.getConnection(unrelated.id)).toEqual(unrelated);
    expect(storage.getConnections().map((connection) => connection.id)).toEqual(beforeConnections.map((connection) => connection.id));
    expect(storage.getFolders().filter((folder) => ![work.id, production.id, databases.id].includes(folder.id)))
      .toEqual(beforeFolders.filter((folder) => ![work.id, production.id, databases.id].includes(folder.id)));
    expect(storage.getSubfolders(destination.path).map((folder) => folder.id)).toEqual([existing.id, work.id]);
    expect(storage.getValidFolders()).toHaveLength(beforeFolders.length);
    const destinationNode = storage.buildConnectionTree()[0].children?.find((node) => node.id === destination.id);
    const workNode = destinationNode?.children?.find((node) => node.id === work.id);
    expect(workNode?.children?.map((node) => node.id)).toEqual([production.id, first.id]);
    expect(workNode?.children?.[0].children?.[0].children?.[0].id).toBe(nested.id);
    const stored = JSON.parse(localStorage.getItem('skd-connections')!) as Record<string, unknown>[];
    expect(stored.every((connection) => !('password' in connection) && !('privateKeyContent' in connection) && !('passphrase' in connection))).toBe(true);
  });

  it('rejects root, current parent, descendants, missing targets, and colliding names without writes', () => {
    const { root, work, production, databases, destination } = fixture();
    storage.createFolder('Work', destination.path);
    const before = snapshot();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    for (const [id, parent] of [
      [root.id, destination.path], [work.id, root.path], [work.id, work.path],
      [work.id, production.path], [work.id, databases.path], [work.id, 'Missing'],
      ['missing-id', destination.path], [work.id, destination.path],
    ]) expect(storage.moveFolder(id, parent)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it('moves a nested folder back to the root without moving its former siblings or parent', () => {
    const { root, work, production, databases, destination, first, nested } = fixture();
    expect(storage.moveFolder(production.id, root.path)).toBe(true);
    expect(storage.getFolders().find((folder) => folder.id === work.id)).toEqual(work);
    expect(storage.getConnection(first.id)).toEqual(first);
    expect(storage.getFolders().find((folder) => folder.id === databases.id)?.path).toBe('All Connections/Production/Databases');
    expect(storage.getConnection(nested.id)?.folder).toBe('All Connections/Production/Databases');
    expect(storage.getSubfolders(root.path).map((folder) => folder.id)).toEqual([work.id, destination.id, production.id]);
  });

  it.each(['skd-connection-folders', 'skd-connections'])('restores both storage keys when writing %s fails', (failingKey) => {
    const { work, destination } = fixture();
    const before = snapshot();
    const originalSet = Storage.prototype.setItem;
    let failed = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === failingKey && !failed) {
        failed = true;
        throw new DOMException('Storage full', 'QuotaExceededError');
      }
      originalSet.call(this, key, value);
    });
    expect(() => storage.moveFolder(work.id, destination.path)).toThrow('Storage full');
    expect(snapshot()).toEqual(before);
  });
});
