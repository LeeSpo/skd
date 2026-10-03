import { describe, expect, it } from 'vitest';
import { visiblePaneSessions } from '../visible-pane-sessions';
import type { TerminalGroupState, TerminalTab } from '../terminal-group-types';

const tab = (id: string): TerminalTab => ({
  id,
  name: id,
  connectionStatus: 'connected',
  reconnectCount: 0,
});

function state(partial: Pick<TerminalGroupState, 'groups' | 'gridLayout'>): TerminalGroupState {
  return {
    activeGroupId: 'g1',
    nextGroupId: 3,
    tabToGroupMap: {},
    activePageId: '1',
    nextPageId: 2,
    pages: [{ id: '1', gridLayout: partial.gridLayout, activeGroupId: 'g1' }],
    ...partial,
  };
}

describe('visiblePaneSessions', () => {
  it('returns the one visible session', () => {
    const sessions = visiblePaneSessions(state({
      groups: { g1: { id: 'g1', tabs: [tab('ssh')], activeTabId: 'ssh' } },
      gridLayout: { type: 'leaf', groupId: 'g1' },
    }));
    expect(sessions.map((session) => session.tab.id)).toEqual(['ssh']);
  });

  it('lists both sides of a split and skips an empty pane', () => {
    const sessions = visiblePaneSessions(state({
      groups: {
        g1: { id: 'g1', tabs: [tab('ssh'), tab('local')], activeTabId: 'ssh' },
        g2: { id: 'g2', tabs: [], activeTabId: null },
      },
      gridLayout: {
        type: 'branch',
        direction: 'horizontal',
        sizes: [50, 50],
        children: [
          { type: 'leaf', groupId: 'g1' },
          { type: 'leaf', groupId: 'g2' },
        ],
      },
    }));
    expect(sessions.map((session) => session.tab.id)).toEqual(['ssh']);
  });

  it('keeps vertical panes in leaf order', () => {
    const sessions = visiblePaneSessions(state({
      groups: {
        top: { id: 'top', tabs: [tab('ssh')], activeTabId: 'ssh' },
        bottom: { id: 'bottom', tabs: [tab('local')], activeTabId: 'local' },
      },
      gridLayout: {
        type: 'branch',
        direction: 'vertical',
        sizes: [60, 40],
        children: [
          { type: 'leaf', groupId: 'top' },
          { type: 'leaf', groupId: 'bottom' },
        ],
      },
    }));
    expect(sessions.map((session) => session.groupId)).toEqual(['top', 'bottom']);
  });
});
