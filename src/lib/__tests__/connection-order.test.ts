import { beforeEach, describe, expect, it } from 'vitest';
import {
  connectionDropZone,
  moveConnectionToFolder,
  reorderConnections,
  reorderSiblingFolders,
} from '@/lib/connection-order';
import { ConnectionStorageManager } from '@/lib/connection-storage';

describe('connectionDropZone', () => {
  const row = { top: 100, height: 28, sameParent: true, targetIsCurrentParent: false };

  it('reorders a connection by the row midpoint', () => {
    expect(connectionDropZone({ ...row, dragType: 'connection', rowType: 'connection', clientY: 110 })).toBe('before');
    expect(connectionDropZone({ ...row, dragType: 'connection', rowType: 'connection', clientY: 120 })).toBe('after');
  });

  it('moves a connection into a folder, except its current parent', () => {
    expect(connectionDropZone({ ...row, dragType: 'connection', rowType: 'folder', clientY: 110 })).toBe('inside');
    expect(connectionDropZone({
      ...row,
      dragType: 'connection',
      rowType: 'folder',
      targetIsCurrentParent: true,
      clientY: 110,
    })).toBeNull();
  });

  it('reorders sibling folders at the edges and moves into the middle', () => {
    expect(connectionDropZone({ ...row, dragType: 'folder', rowType: 'folder', clientY: 104 })).toBe('before');
    expect(connectionDropZone({ ...row, dragType: 'folder', rowType: 'folder', clientY: 124 })).toBe('after');
    expect(connectionDropZone({ ...row, dragType: 'folder', rowType: 'folder', clientY: 114 })).toBe('inside');
  });

  it('moves a folder into a folder from another parent', () => {
    expect(connectionDropZone({
      ...row,
      dragType: 'folder',
      rowType: 'folder',
      sameParent: false,
      clientY: 104,
    })).toBe('inside');
  });

  it('ignores a folder dropped on a connection', () => {
    expect(connectionDropZone({ ...row, dragType: 'folder', rowType: 'connection', clientY: 110 })).toBeNull();
  });
});

describe('reorderConnections', () => {
  const connections = [
    { id: 'c', folder: 'Home' },
    { id: 'a', folder: 'Work' },
    { id: 'd', folder: 'Home' },
    { id: 'b', folder: 'Work' },
  ];

  it('places a connection before a sibling and keeps other folders in place', () => {
    expect(reorderConnections(connections, 'b', 'Work', 'a', 'before')).toEqual([
      { id: 'c', folder: 'Home' },
      { id: 'b', folder: 'Work' },
      { id: 'a', folder: 'Work' },
      { id: 'd', folder: 'Home' },
    ]);
  });

  it('returns null when the connection is already in that position', () => {
    expect(reorderConnections(connections, 'a', 'Work', 'b', 'before')).toBeNull();
    expect(reorderConnections(connections, 'a', 'Work', 'a', 'after')).toBeNull();
  });

  it('moves a connection into another folder at the drop position', () => {
    expect(reorderConnections(connections, 'a', 'Home', 'd', 'before')).toEqual([
      { id: 'c', folder: 'Home' },
      { id: 'a', folder: 'Home' },
      { id: 'd', folder: 'Home' },
      { id: 'b', folder: 'Work' },
    ]);
  });

  it('returns null when the target is not in the destination folder', () => {
    expect(reorderConnections(connections, 'a', 'Work', 'c', 'before')).toBeNull();
  });
});

describe('moveConnectionToFolder', () => {
  it('appends the connection after the destination folder entries', () => {
    const connections = [
      { id: 'a', folder: 'Work' },
      { id: 'b', folder: 'Work' },
      { id: 'c', folder: 'Home' },
    ];
    expect(moveConnectionToFolder(connections, 'c', 'Work')).toEqual([
      { id: 'a', folder: 'Work' },
      { id: 'b', folder: 'Work' },
      { id: 'c', folder: 'Work' },
    ]);
  });

  it('returns null when the connection is already in the folder or missing', () => {
    const connections = [{ id: 'a', folder: 'Work' }];
    expect(moveConnectionToFolder(connections, 'a', 'Work')).toBeNull();
    expect(moveConnectionToFolder(connections, 'missing', 'Home')).toBeNull();
  });
});

describe('reorderSiblingFolders', () => {
  const folders = [
    { id: 'root', parentPath: undefined },
    { id: 'work', parentPath: 'All Connections' },
    { id: 'personal', parentPath: 'All Connections' },
    { id: 'nested', parentPath: 'All Connections/Work' },
  ];

  it('reorders folders that share a parent', () => {
    expect(reorderSiblingFolders(folders, 'personal', 'work', 'before')?.map((folder) => folder.id)).toEqual([
      'root',
      'personal',
      'work',
      'nested',
    ]);
  });

  it('returns null for a different parent or an unchanged order', () => {
    expect(reorderSiblingFolders(folders, 'nested', 'work', 'before')).toBeNull();
    expect(reorderSiblingFolders(folders, 'work', 'personal', 'before')).toBeNull();
  });
});

describe('ConnectionStorageManager order', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists a reordered connection and appends a folder move', () => {
    const alpha = ConnectionStorageManager.saveConnection({
      name: 'Alpha', host: 'a.example', port: 22, username: 'u', protocol: 'SSH', folder: 'All Connections',
    });
    const beta = ConnectionStorageManager.saveConnection({
      name: 'Beta', host: 'b.example', port: 22, username: 'u', protocol: 'SSH', folder: 'All Connections',
    });
    const remote = ConnectionStorageManager.saveConnection({
      name: 'Remote', host: 'c.example', port: 22, username: 'u', protocol: 'SSH', folder: 'All Connections/Work',
    });

    expect(ConnectionStorageManager.reorderConnection(beta.id, 'All Connections', alpha.id, 'before')).toBe(true);
    expect(ConnectionStorageManager.getConnections().map((connection) => connection.id)).toEqual([
      beta.id,
      alpha.id,
      remote.id,
    ]);
    expect(ConnectionStorageManager.reorderConnection(beta.id, 'All Connections', alpha.id, 'before')).toBe(false);

    expect(ConnectionStorageManager.moveConnection(remote.id, 'All Connections')).toBe(true);
    expect(ConnectionStorageManager.getConnections().map((connection) => connection.id)).toEqual([
      beta.id,
      alpha.id,
      remote.id,
    ]);
    expect(ConnectionStorageManager.getConnection(remote.id)?.folder).toBe('All Connections');
  });

  it('persists sibling folder order', () => {
    const work = ConnectionStorageManager.createFolder('Work', 'All Connections');
    const personal = ConnectionStorageManager.createFolder('Personal', 'All Connections');

    expect(ConnectionStorageManager.reorderFolder(personal.id, work.id, 'before')).toBe(true);
    expect(
      ConnectionStorageManager.getFolders()
        .filter((folder) => folder.parentPath === 'All Connections')
        .map((folder) => folder.id),
    ).toEqual([personal.id, work.id]);
    expect(ConnectionStorageManager.reorderFolder(personal.id, work.id, 'before')).toBe(false);
  });
});
