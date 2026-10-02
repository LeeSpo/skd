import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  serialize,
  deserialize,
  saveState,
  loadState,
  migrateFromLegacy,
  createDefaultState,
  STORAGE_KEY,
  STATE_VERSION,
} from '../lib/terminal-group-serializer';
import type { TerminalGroupState, TerminalTab } from '../lib/terminal-group-types';

// ── Helpers ──

function makeTab(id: string): TerminalTab {
  return {
    id,
    name: id,
    connectionStatus: 'connected',
    reconnectCount: 0,
  };
}

function makeState(): TerminalGroupState {
  return {
    groups: {
      '1': { id: '1', tabs: [makeTab('t1')], activeTabId: 't1' },
    },
    activeGroupId: '1',
    tabToGroupMap: { t1: '1' },
    gridLayout: { type: 'leaf', groupId: '1' },
    nextGroupId: 2,
  };
}

// ── Tests ──

describe('serialize / deserialize', () => {
  it('round-trips a valid state', () => {
    const state = makeState();
    const json = serialize(state);
    const result = deserialize(json);
    expect(result).toEqual(state);
  });

  it('wraps state with version number', () => {
    const state = makeState();
    const json = serialize(state);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(STATE_VERSION);
    expect(parsed.data).toEqual(state);
  });

  it('returns null for invalid JSON', () => {
    expect(deserialize('not json')).toBeNull();
  });

  it('returns null for wrong version', () => {
    const json = JSON.stringify({ version: 999, data: makeState() });
    expect(deserialize(json)).toBeNull();
  });

  it('returns null for missing version', () => {
    const json = JSON.stringify({ data: makeState() });
    expect(deserialize(json)).toBeNull();
  });

  it('returns null for missing data', () => {
    const json = JSON.stringify({ version: STATE_VERSION });
    expect(deserialize(json)).toBeNull();
  });

  it('returns null for invalid state structure (missing groups)', () => {
    const json = JSON.stringify({
      version: STATE_VERSION,
      data: { activeGroupId: '1', nextGroupId: 2, gridLayout: { type: 'leaf', groupId: '1' } },
    });
    expect(deserialize(json)).toBeNull();
  });

  it('returns null for invalid gridLayout', () => {
    const json = JSON.stringify({
      version: STATE_VERSION,
      data: {
        groups: { '1': { id: '1', tabs: [], activeTabId: null } },
        activeGroupId: '1',
        nextGroupId: 2,
        gridLayout: { type: 'unknown' },
      },
    });
    expect(deserialize(json)).toBeNull();
  });

  it('round-trips a state with branch grid layout', () => {
    const state: TerminalGroupState = {
      groups: {
        '1': { id: '1', tabs: [makeTab('t1')], activeTabId: 't1' },
        '2': { id: '2', tabs: [makeTab('t2')], activeTabId: 't2' },
      },
      activeGroupId: '1',
      gridLayout: {
        type: 'branch',
        direction: 'horizontal',
        children: [
          { type: 'leaf', groupId: '1' },
          { type: 'leaf', groupId: '2' },
        ],
        sizes: [50, 50],
      },
      nextGroupId: 3,
    };
    expect(deserialize(serialize(state))).toEqual(state);
  });

  it('round-trips default state', () => {
    const state = createDefaultState();
    expect(deserialize(serialize(state))).toEqual(state);
  });
});

describe('saveState / loadState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and loads state via localStorage', () => {
    const state = makeState();
    saveState(state);
    const loaded = loadState();
    expect(loaded).toEqual(state);
  });

  it('returns null when nothing is stored', () => {
    expect(loadState()).toBeNull();
  });

  it('returns null when stored data is corrupted', () => {
    localStorage.setItem(STORAGE_KEY, 'corrupted{{{');
    expect(loadState()).toBeNull();
  });

  it('warns on localStorage write failure', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError');
    };

    saveState(makeState());
    expect(warnSpy).toHaveBeenCalledOnce();

    Storage.prototype.setItem = original;
    warnSpy.mockRestore();
  });
});

describe('migrateFromLegacy', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('removes legacy active connections key', () => {
    localStorage.setItem('skd-active-connections', '[]');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    migrateFromLegacy();

    expect(localStorage.getItem('skd-active-connections')).toBeNull();
    expect(logSpy).toHaveBeenCalledOnce();
    logSpy.mockRestore();
  });

  it('removes unversioned layout data from STORAGE_KEY', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs: ['a', 'b'] }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    migrateFromLegacy();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(logSpy).toHaveBeenCalledOnce();
    logSpy.mockRestore();
  });

  it('removes corrupted data from STORAGE_KEY', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    migrateFromLegacy();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(logSpy).toHaveBeenCalledOnce();
    logSpy.mockRestore();
  });

  it('preserves versioned data in STORAGE_KEY', () => {
    const validData = serialize(makeState());
    localStorage.setItem(STORAGE_KEY, validData);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    migrateFromLegacy();

    expect(localStorage.getItem(STORAGE_KEY)).toBe(validData);
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('preserves ConnectionData keys untouched', () => {
    localStorage.setItem('skd-active-connections', '[]');
    localStorage.setItem('skd-connections', '{"profiles":[]}');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    migrateFromLegacy();

    expect(localStorage.getItem('skd-connections')).toBe('{"profiles":[]}');
    logSpy.mockRestore();
  });
});
