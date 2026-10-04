import { useSyncExternalStore } from 'react';

export type ToggleableFileColumn = 'size' | 'modified' | 'permissions' | 'owner';
const TOGGLEABLE_COLUMNS: ToggleableFileColumn[] = ['size', 'modified', 'permissions', 'owner'];
const STORAGE_KEY = 'skd-file-browser-visible-columns';
const CHANGE_EVENT = 'skd-file-browser-columns-changed';

const DEFAULT_VISIBILITY: Record<ToggleableFileColumn, boolean> = {
  size: true,
  modified: true,
  permissions: false,
  owner: false,
};

function snapshot(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function readColumns(value: string | null): Record<ToggleableFileColumn, boolean> {
  const visibility = { ...DEFAULT_VISIBILITY };
  if (!value) return visibility;

  try {
    const parsed: unknown = JSON.parse(value);
    // Older builds stored only the optional remote columns that were turned on.
    if (Array.isArray(parsed)) {
      visibility.permissions = parsed.includes('permissions');
      visibility.owner = parsed.includes('owner');
      return visibility;
    }
    if (!parsed || typeof parsed !== 'object') return visibility;

    const record = parsed as Record<string, unknown>;
    for (const column of TOGGLEABLE_COLUMNS) {
      if (typeof record[column] === 'boolean') visibility[column] = record[column];
    }
  } catch {
    return visibility;
  }
  return visibility;
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useFileBrowserColumns() {
  const stored = useSyncExternalStore(subscribe, snapshot, () => null);
  const columns = readColumns(stored);
  const setColumnVisible = (column: ToggleableFileColumn, visible: boolean) => {
    const next = { ...readColumns(snapshot()), [column]: visible };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage can be unavailable in a restricted webview.
      return;
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  return { isColumnVisible: (column: ToggleableFileColumn) => columns[column], setColumnVisible };
}
