import type { TerminalGroupState, GridNode, TerminalGroup, TerminalTab, WorkspacePage } from './terminal-group-types';

export const STORAGE_KEY = 'skd-terminal-groups';
export const STATE_VERSION = 2;
/** Layouts saved before a titlebar segment owned its own grid. */
const MIGRATABLE_VERSION = 1;

const LEGACY_ACTIVE_CONNECTIONS_KEY = 'skd-active-connections';

interface SerializedState {
  version: number;
  data: TerminalGroupState;
}

/**
 * serialize — wrap state in a versioned envelope and JSON.stringify
 */
export function serialize(state: TerminalGroupState): string {
  const envelope: SerializedState = { version: STATE_VERSION, data: state };
  return JSON.stringify(envelope);
}

/**
 * deserialize — parse JSON, validate version and structure, return state or null
 */
export function deserialize(json: string): TerminalGroupState | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isSerializedState(parsed)) return null;
    if (parsed.version === MIGRATABLE_VERSION) {
      if (!isValidLegacyState(parsed.data)) return null;
      return migrateV1(parsed.data);
    }
    if (parsed.version !== STATE_VERSION) return null;
    if (!isValidState(parsed.data)) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * saveState — persist state to localStorage, warn on failure.
 * Editor and local-shell tabs are ephemeral and excluded from persistence.
 */
function isEphemeralTab(tab: { tabType?: string; protocol?: string }): boolean {
  return tab.tabType === 'editor' || tab.protocol === 'Local';
}

export function saveState(state: TerminalGroupState): void {
  try {
    // Strip ephemeral tabs before saving — they are transient and cannot be restored
    const filtered: TerminalGroupState = {
      ...state,
      groups: Object.fromEntries(
        Object.entries(state.groups).map(([id, group]) => {
          const tabs = group.tabs.filter(t => !isEphemeralTab(t));
          return [id, {
            ...group,
            tabs,
            activeTabId: tabs.find(t => t.id === group.activeTabId) ? group.activeTabId : (tabs[0]?.id ?? null),
          }];
        }),
      ),
      tabToGroupMap: Object.fromEntries(
        Object.entries(state.tabToGroupMap).filter(([tabId]) => {
          const group = state.groups[state.tabToGroupMap[tabId]];
          const tab = group?.tabs.find(t => t.id === tabId);
          return tab !== undefined && !isEphemeralTab(tab);
        }),
      ),
    };
    localStorage.setItem(STORAGE_KEY, serialize(filtered));
  } catch (e) {
    console.warn('Failed to save terminal group state to localStorage:', e);
  }
}

/**
 * loadState — read from localStorage, deserialize, return state or null
 */
export function loadState(): TerminalGroupState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return deserialize(raw);
  } catch {
    return null;
  }
}

/**
 * migrateFromLegacy — detect and clear old format keys, log migration.
 * Preserves ConnectionData (connection profiles) untouched.
 */
export function migrateFromLegacy(): void {
  let migrated = false;

  // Check for legacy active connections key
  if (localStorage.getItem(LEGACY_ACTIVE_CONNECTIONS_KEY) !== null) {
    localStorage.removeItem(LEGACY_ACTIVE_CONNECTIONS_KEY);
    migrated = true;
  }

  // Check if existing layout data lacks a version field (unversioned / legacy format)
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
        localStorage.removeItem(STORAGE_KEY);
        migrated = true;
      }
    } catch {
      // Corrupted data — remove it
      localStorage.removeItem(STORAGE_KEY);
      migrated = true;
    }
  }

  if (migrated) {
    console.log('[terminal-groups] Migrated from legacy state: old layout and active connection data cleared.');
  }
}

// ── Validation helpers ──

function isSerializedState(value: unknown): value is SerializedState {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.version === 'number' && typeof obj.data === 'object' && obj.data !== null;
}

function isValidLegacyState(value: unknown): value is TerminalGroupState {
  if (!hasGroupRecords(value)) return false;
  return isValidGridNode(value.gridLayout);
}

function isValidState(value: unknown): value is TerminalGroupState {
  if (!isValidLegacyState(value)) return false;
  if (typeof value.activePageId !== 'string') return false;
  if (typeof value.nextPageId !== 'number') return false;
  if (!Array.isArray(value.pages) || value.pages.length === 0) return false;
  return value.pages.every(isValidPage);
}

function hasGroupRecords(value: unknown): value is TerminalGroupState {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;

  if (typeof obj.groups !== 'object' || obj.groups === null) return false;
  if (typeof obj.activeGroupId !== 'string') return false;
  if (typeof obj.nextGroupId !== 'number') return false;

  // tabToGroupMap is optional for backward compatibility — initializeState rebuilds it
  if (obj.tabToGroupMap !== undefined && typeof obj.tabToGroupMap !== 'object') return false;

  const groups = obj.groups as Record<string, unknown>;
  for (const key of Object.keys(groups)) {
    const group = groups[key] as Record<string, unknown>;
    if (typeof group !== 'object' || group === null) return false;
    if (typeof group.id !== 'string') return false;
    if (!Array.isArray(group.tabs)) return false;
    if (group.activeTabId !== null && typeof group.activeTabId !== 'string') return false;
  }

  return true;
}

function isValidPage(value: unknown): value is WorkspacePage {
  if (typeof value !== 'object' || value === null) return false;
  const page = value as Record<string, unknown>;
  return typeof page.id === 'string'
    && typeof page.activeGroupId === 'string'
    && isValidGridNode(page.gridLayout);
}

/**
 * v1 stored one window-wide grid. A single pane with several tabs becomes one
 * full-screen page per tab. A split tree stays one page, and any extra tab
 * stacked inside a pane becomes its own page.
 */
export function migrateV1(data: TerminalGroupState): TerminalGroupState {
  const groups: Record<string, TerminalGroup> = {};
  for (const [id, group] of Object.entries(data.groups)) {
    groups[id] = { ...group, tabs: [...group.tabs] };
  }

  let nextGroupId = data.nextGroupId;
  const extras: TerminalTab[] = [];
  for (const group of Object.values(groups)) {
    if (group.tabs.length <= 1) continue;
    const keep = group.tabs.find((tab) => tab.id === group.activeTabId) ?? group.tabs[0];
    for (const tab of group.tabs) {
      if (tab.id !== keep.id) extras.push(tab);
    }
    group.tabs = [keep];
    group.activeTabId = keep.id;
  }

  const tabToGroupMap: Record<string, string> = { ...(data.tabToGroupMap ?? {}) };
  for (const [id, group] of Object.entries(groups)) {
    for (const tab of group.tabs) tabToGroupMap[tab.id] = id;
  }

  const pages: WorkspacePage[] = [{
    id: '1',
    gridLayout: data.gridLayout,
    activeGroupId: data.activeGroupId,
  }];
  let nextPageId = 2;
  for (const tab of extras) {
    const groupId = String(nextGroupId);
    nextGroupId += 1;
    const pageId = String(nextPageId);
    nextPageId += 1;
    groups[groupId] = { id: groupId, tabs: [tab], activeTabId: tab.id };
    tabToGroupMap[tab.id] = groupId;
    pages.push({
      id: pageId,
      gridLayout: { type: 'leaf', groupId },
      activeGroupId: groupId,
    });
  }

  return {
    groups,
    activeGroupId: data.activeGroupId,
    gridLayout: data.gridLayout,
    nextGroupId,
    tabToGroupMap,
    pages,
    activePageId: '1',
    nextPageId,
  };
}

function isValidGridNode(value: unknown): value is GridNode {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;

  if (obj.type === 'leaf') {
    return typeof obj.groupId === 'string';
  }

  if (obj.type === 'branch') {
    if (obj.direction !== 'horizontal' && obj.direction !== 'vertical') return false;
    if (!Array.isArray(obj.children)) return false;
    if (!Array.isArray(obj.sizes)) return false;
    if (obj.children.length !== obj.sizes.length) return false;
    return obj.children.every(isValidGridNode);
  }

  return false;
}

// Re-export createDefaultState for convenience
export { createDefaultState } from './terminal-group-reducer';
