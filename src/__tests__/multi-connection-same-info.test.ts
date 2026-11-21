import { describe, it, expect } from 'vitest';
import type { TerminalTab } from '../lib/terminal-group-types';
import { getTabDisplayName } from '../lib/terminal-group-utils';

function makeTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 'conn-1',
    name: 'My Server',
    protocol: 'SSH',
    host: '192.168.1.1',
    username: 'user',
    connectionStatus: 'connected',
    reconnectCount: 0,
    ...overrides,
  };
}

describe('getTabDisplayName', () => {
  // Task 7.1: returns name without suffix for a single tab
  it('returns name without suffix when only one tab from the profile', () => {
    const tab = makeTab();
    expect(getTabDisplayName(tab, [tab])).toBe('My Server');
  });

  // Task 7.1: single duplicate with originalConnectionId should also get no suffix if alone
  it('returns name without suffix when single duplicate tab is alone', () => {
    const tab = makeTab({ id: 'conn-1-dup-123', originalConnectionId: 'conn-1' });
    expect(getTabDisplayName(tab, [tab])).toBe('My Server');
  });

  // Task 7.2: correct suffixes for 3 tabs from same profile
  it('returns correct suffixes for 3 tabs from same profile', () => {
    const tab1 = makeTab({ id: 'conn-1' });
    const tab2 = makeTab({ id: 'conn-1-dup-1000', originalConnectionId: 'conn-1' });
    const tab3 = makeTab({ id: 'conn-1-dup-2000', originalConnectionId: 'conn-1' });
    const allTabs = [tab1, tab2, tab3];

    expect(getTabDisplayName(tab1, allTabs)).toBe('My Server (1)');
    expect(getTabDisplayName(tab2, allTabs)).toBe('My Server (2)');
    expect(getTabDisplayName(tab3, allTabs)).toBe('My Server (3)');
  });

  it('only adds suffixes to tabs from the same profile, even when names match', () => {
    const original = makeTab({ id: 'conn-1' });
    const duplicate = makeTab({ id: 'conn-1-dup-123', originalConnectionId: 'conn-1' });
    const unrelated = makeTab({ id: 'conn-2' });
    const allTabs = [original, unrelated, duplicate];

    expect(getTabDisplayName(original, allTabs)).toBe('My Server (1)');
    expect(getTabDisplayName(duplicate, allTabs)).toBe('My Server (2)');
    expect(getTabDisplayName(unrelated, allTabs)).toBe('My Server');
  });
});
