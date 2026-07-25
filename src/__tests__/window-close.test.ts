import { describe, expect, it } from 'vitest';
import { resolveMainWindowCloseAction } from '../lib/window-close';

describe('resolveMainWindowCloseAction', () => {
  it('closes the active tab in the focused group', () => {
    expect(resolveMainWindowCloseAction({
      id: 'group-2',
      activeTabId: 'tab-b',
    })).toEqual({
      type: 'close-tab',
      groupId: 'group-2',
      tabId: 'tab-b',
    });
  });

  it('quits when the main workspace has no active tab', () => {
    expect(resolveMainWindowCloseAction({
      id: 'group-1',
      activeTabId: null,
    })).toEqual({ type: 'quit-app' });
  });

  it('quits when there is no active group', () => {
    expect(resolveMainWindowCloseAction(null)).toEqual({ type: 'quit-app' });
  });
});
