import { useSyncExternalStore } from 'react';

export type AdvancedFileColumn = 'permissions' | 'owner';
const STORAGE_KEY = 'skd-file-browser-visible-columns';
const CHANGE_EVENT = 'skd-file-browser-columns-changed';

function snapshot(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function readColumns(value: string | null): AdvancedFileColumn[] {
  try {
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.filter((column): column is AdvancedFileColumn => column === 'permissions' || column === 'owner')
      : [];
  } catch {
    return [];
  }
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
  const setColumnVisible = (column: AdvancedFileColumn, visible: boolean) => {
    const next = new Set(readColumns(snapshot()));
    if (visible) next.add(column);
    else next.delete(column);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // Storage can be unavailable in a restricted webview.
      return;
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  return { isColumnVisible: (column: AdvancedFileColumn) => columns.includes(column), setColumnVisible };
}
