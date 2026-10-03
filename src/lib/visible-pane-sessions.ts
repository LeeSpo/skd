import type { GridNode, TerminalGroupState, TerminalTab } from './terminal-group-types';

/** One pane's visible session, in grid order. */
export interface PaneSession {
  groupId: string;
  tab: TerminalTab;
  tabs: TerminalTab[];
}

function leafIds(node: GridNode): string[] {
  if (node.type === 'leaf') return [node.groupId];
  return node.children.flatMap(leafIds);
}

/** Active session of every pane, left to right, including panes stacked vertically. */
export function visiblePaneSessions(
  state: Pick<TerminalGroupState, 'groups' | 'gridLayout'>,
): PaneSession[] {
  return leafIds(state.gridLayout).flatMap((groupId) => {
    const group = state.groups[groupId];
    if (!group?.activeTabId) return [];
    const tab = group.tabs.find((item) => item.id === group.activeTabId);
    if (!tab) return [];
    return [{ groupId, tab, tabs: group.tabs }];
  });
}
