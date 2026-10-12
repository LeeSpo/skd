export type SidebarNodeType = 'connection' | 'folder';
export type ConnectionDropPlacement = 'before' | 'after' | 'inside';

export interface ConnectionDropZoneInput {
  dragType: SidebarNodeType;
  rowType: SidebarNodeType;
  sameParent: boolean;
  /** The hovered folder is already the dragged row's parent. */
  targetIsCurrentParent: boolean;
  top: number;
  height: number;
  clientY: number;
}

/**
 * Connection rows reorder by the pointer's half.
 * Folder rows use the top and bottom bands to reorder siblings, and the middle to move inside.
 */
export function connectionDropZone(input: ConnectionDropZoneInput): ConnectionDropPlacement | null {
  if (input.targetIsCurrentParent) return null;

  if (input.rowType === 'connection') {
    if (input.dragType !== 'connection') return null;
    const mid = input.top + input.height / 2;
    return input.clientY < mid ? 'before' : 'after';
  }

  if (input.dragType === 'connection') return 'inside';
  if (!input.sameParent) return 'inside';

  const edge = Math.max(8, input.height * 0.28);
  const offset = input.clientY - input.top;
  if (offset <= edge) return 'before';
  if (offset >= input.height - edge) return 'after';
  return 'inside';
}

interface FolderKeyed {
  id: string;
  folder?: string;
}

interface ParentKeyed {
  id: string;
  parentPath?: string;
}

export function reorderConnections<T extends FolderKeyed>(
  connections: readonly T[],
  connectionId: string,
  targetFolder: string,
  targetId: string,
  placement: 'before' | 'after',
): T[] | null {
  if (connectionId === targetId) return null;
  const movingIndex = connections.findIndex((item) => item.id === connectionId);
  const target = connections.find((item) => item.id === targetId);
  if (movingIndex === -1 || !target) return null;

  const moving = { ...connections[movingIndex], folder: targetFolder };
  const without = connections.filter((item) => item.id !== connectionId);
  const folderItems = without.filter((item) => item.folder === targetFolder);
  const targetIndex = folderItems.findIndex((item) => item.id === targetId);
  if (targetIndex === -1) return null;
  folderItems.splice(placement === 'before' ? targetIndex : targetIndex + 1, 0, moving);

  const rebuilt = spliceGroup(without, folderItems, (item) => item.folder === targetFolder);
  const sourceFolder = connections[movingIndex].folder;
  if (sourceFolder === targetFolder) {
    const beforeIds = connections.filter((item) => item.folder === targetFolder);
    const afterIds = rebuilt.filter((item) => item.folder === targetFolder);
    if (sameIds(beforeIds, afterIds)) return null;
  }
  return rebuilt;
}

export function moveConnectionToFolder<T extends FolderKeyed>(
  connections: readonly T[],
  connectionId: string,
  folder: string,
): T[] | null {
  const movingIndex = connections.findIndex((item) => item.id === connectionId);
  if (movingIndex === -1) return null;
  if (connections[movingIndex].folder === folder) return null;

  const moving = { ...connections[movingIndex], folder };
  const without = connections.filter((item) => item.id !== connectionId);
  const folderItems = without.filter((item) => item.folder === folder);
  folderItems.push(moving);
  return spliceGroup(without, folderItems, (item) => item.folder === folder);
}

export function reorderSiblingFolders<T extends ParentKeyed>(
  folders: readonly T[],
  folderId: string,
  targetId: string,
  placement: 'before' | 'after',
): T[] | null {
  if (folderId === targetId) return null;
  const movingIndex = folders.findIndex((item) => item.id === folderId);
  const target = folders.find((item) => item.id === targetId);
  if (movingIndex === -1 || !target) return null;
  if ((folders[movingIndex].parentPath ?? '') !== (target.parentPath ?? '')) return null;

  const parent = folders[movingIndex].parentPath ?? '';
  const moving = { ...folders[movingIndex] };
  const without = folders.filter((item) => item.id !== folderId);
  const siblings = without.filter((item) => (item.parentPath ?? '') === parent);
  const targetIndex = siblings.findIndex((item) => item.id === targetId);
  if (targetIndex === -1) return null;
  siblings.splice(placement === 'before' ? targetIndex : targetIndex + 1, 0, moving);

  const rebuilt = spliceGroup(without, siblings, (item) => (item.parentPath ?? '') === parent);
  const beforeIds = folders.filter((item) => (item.parentPath ?? '') === parent);
  const afterIds = rebuilt.filter((item) => (item.parentPath ?? '') === parent);
  return sameIds(beforeIds, afterIds) ? null : rebuilt;
}

function spliceGroup<T>(items: readonly T[], group: readonly T[], inGroup: (item: T) => boolean): T[] {
  const rebuilt: T[] = [];
  let inserted = false;
  for (const item of items) {
    if (inGroup(item)) {
      if (!inserted) {
        rebuilt.push(...group);
        inserted = true;
      }
      continue;
    }
    rebuilt.push(item);
  }
  if (!inserted) rebuilt.push(...group);
  return rebuilt;
}

function sameIds(left: readonly { id: string }[], right: readonly { id: string }[]): boolean {
  return left.length === right.length && left.every((item, index) => item.id === right[index]?.id);
}
