import { describe, expect, it } from 'vitest';
import {
  busySessionIds,
  shouldConfirmClose,
  tabsRemovedByBulkClose,
} from '../session-close';

const tabs = [
  { id: 'a' },
  { id: 'b' },
  { id: 'c' },
  { id: 'd' },
];

describe('tabsRemovedByBulkClose', () => {
  it('selects every tab except the pivot for close-others', () => {
    expect(tabsRemovedByBulkClose(tabs, 'others', 'b')).toEqual(['a', 'c', 'd']);
  });

  it('selects tabs to the left or right of the pivot', () => {
    expect(tabsRemovedByBulkClose(tabs, 'left', 'c')).toEqual(['a', 'b']);
    expect(tabsRemovedByBulkClose(tabs, 'right', 'b')).toEqual(['c', 'd']);
  });

  it('returns an empty list when the pivot is missing or nothing would close', () => {
    expect(tabsRemovedByBulkClose(tabs, 'others', 'missing')).toEqual([]);
    expect(tabsRemovedByBulkClose(tabs, 'left', 'a')).toEqual([]);
    expect(tabsRemovedByBulkClose(tabs, 'right', 'd')).toEqual([]);
  });
});

describe('busySessionIds', () => {
  const running = new Set(['term-run', 'fb-run', 'edit-run', 'disc-run', 'conn-run']);
  const isRunning = (id: string) => running.has(id);

  it('includes only connected terminal sessions whose command is running', () => {
    expect(busySessionIds([
      { id: 'term-run', connectionStatus: 'connected' },
      { id: 'term-idle', connectionStatus: 'connected' },
      { id: 'unknown', connectionStatus: 'connected' },
    ], isRunning)).toEqual(['term-run']);
  });

  it('excludes file-browser and editor tabs even when the store says running', () => {
    expect(busySessionIds([
      { id: 'fb-run', tabType: 'file-browser', connectionStatus: 'connected' },
      { id: 'edit-run', tabType: 'editor', connectionStatus: 'connected' },
    ], isRunning)).toEqual([]);
  });

  it('excludes disconnected and connecting tabs even when the store says running', () => {
    expect(busySessionIds([
      { id: 'disc-run', connectionStatus: 'disconnected' },
      { id: 'conn-run', connectionStatus: 'connecting' },
    ], isRunning)).toEqual([]);
  });
});

describe('shouldConfirmClose', () => {
  it('confirms only when at least one session is busy', () => {
    expect(shouldConfirmClose([])).toBe(false);
    expect(shouldConfirmClose(['term-run'])).toBe(true);
  });
});
