import type {
  GridNode,
  SplitDirection,
  TerminalGroup,
  TerminalGroupAction,
  TerminalGroupState,
  TerminalTab,
  WorkspacePage,
} from './terminal-group-types';

// ── Grid tree helpers ──

/** Find the path (array of child indices) to a leaf with the given groupId */
export function findLeafPath(node: GridNode, groupId: string): number[] | null {
  if (node.type === 'leaf') {
    return node.groupId === groupId ? [] : null;
  }
  for (let i = 0; i < node.children.length; i++) {
    const sub = findLeafPath(node.children[i], groupId);
    if (sub !== null) return [i, ...sub];
  }
  return null;
}

/** Replace a leaf node identified by groupId with a new branch containing old + new leaf */
export function insertSplit(
  node: GridNode,
  groupId: string,
  newGroupId: string,
  direction: SplitDirection,
): GridNode {
  if (node.type === 'leaf') {
    if (node.groupId !== groupId) return node;
    const branchDir: 'horizontal' | 'vertical' =
      direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical';
    const oldLeaf: GridNode = { type: 'leaf', groupId };
    const newLeaf: GridNode = { type: 'leaf', groupId: newGroupId };
    const children =
      direction === 'right' || direction === 'down'
        ? [oldLeaf, newLeaf]
        : [newLeaf, oldLeaf];
    return { type: 'branch', direction: branchDir, children, sizes: [50, 50] };
  }
  return {
    ...node,
    children: node.children.map((c) => insertSplit(c, groupId, newGroupId, direction)),
  };
}

/** Remove a leaf with the given groupId from the tree. Returns null if the leaf was the root. */
export function removeLeaf(node: GridNode, groupId: string): GridNode | null {
  if (node.type === 'leaf') {
    return node.groupId === groupId ? null : node;
  }
  const newChildren: GridNode[] = [];
  const newSizes: number[] = [];
  for (let i = 0; i < node.children.length; i++) {
    const result = removeLeaf(node.children[i], groupId);
    if (result !== null) {
      newChildren.push(result);
      newSizes.push(node.sizes[i]);
    }
  }
  if (newChildren.length === 0) return null;
  if (newChildren.length === node.children.length) {
    // Nothing was removed at this level — but a deeper child may have changed
    const anyChanged = newChildren.some((c, i) => c !== node.children[i]);
    if (!anyChanged) return node;
  }
  return { ...node, children: newChildren, sizes: normalizeSizes(newSizes) };
}

/** Collapse single-child branch nodes */
export function simplifyTree(node: GridNode): GridNode {
  if (node.type === 'leaf') return node;
  const simplified = node.children.map(simplifyTree);
  if (simplified.length === 1) return simplified[0];
  return { ...node, children: simplified };
}

/** Navigate the tree by path and update sizes at that branch node */
export function updateSizes(node: GridNode, path: number[], sizes: number[]): GridNode {
  if (path.length === 0) {
    if (node.type === 'branch') {
      return { ...node, sizes };
    }
    return node;
  }
  if (node.type === 'leaf') return node;
  const [idx, ...rest] = path;
  if (idx < 0 || idx >= node.children.length) return node;
  const newChildren = [...node.children];
  newChildren[idx] = updateSizes(newChildren[idx], rest, sizes);
  return { ...node, children: newChildren };
}

/** Normalize sizes so they sum to 100 */
function normalizeSizes(sizes: number[]): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (sum === 0) return sizes.map(() => 100 / sizes.length);
  return sizes.map((s) => (s / sum) * 100);
}

/** Collect all leaf groupIds from the tree */
function collectLeafIds(node: GridNode): string[] {
  if (node.type === 'leaf') return [node.groupId];
  return node.children.flatMap(collectLeafIds);
}

function gridContains(node: GridNode, groupId: string): boolean {
  return collectLeafIds(node).includes(groupId);
}

/**
 * Older callers and property fixtures omit pages. One page mirroring the
 * live grid keeps "every group is a leaf of state.gridLayout" intact.
 */
export function ensurePages(state: TerminalGroupState): TerminalGroupState {
  if (state.pages && state.pages.length > 0 && state.activePageId) {
    if (typeof state.nextPageId === 'number') return state;
    const maxId = state.pages.reduce((max, page) => {
      const numeric = Number(page.id);
      return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
    }, 1);
    return { ...state, nextPageId: maxId + 1 };
  }
  const page: WorkspacePage = {
    id: '1',
    gridLayout: state.gridLayout,
    activeGroupId: state.activeGroupId,
  };
  return {
    ...state,
    pages: [page],
    activePageId: page.id,
    nextPageId: 2,
  };
}

/** Write the live grid back onto the active page. No-op when it already matches. */
export function rememberActivePage(state: TerminalGroupState): TerminalGroupState {
  if (!state.pages?.length || !state.activePageId) return state;
  const current = state.pages.find((page) => page.id === state.activePageId);
  if (!current) return state;
  if (current.gridLayout === state.gridLayout && current.activeGroupId === state.activeGroupId) {
    return state;
  }
  return {
    ...state,
    pages: state.pages.map((page) =>
      page.id === state.activePageId
        ? { ...page, gridLayout: state.gridLayout, activeGroupId: state.activeGroupId }
        : page,
    ),
  };
}

/** Pages as the titlebar should read them: the active page uses the live grid. */
export function livePages(state: TerminalGroupState): WorkspacePage[] {
  const ensured = ensurePages(state);
  return ensured.pages.map((page) =>
    page.id === ensured.activePageId
      ? { ...page, gridLayout: ensured.gridLayout, activeGroupId: ensured.activeGroupId }
      : page,
  );
}

// ── Default state ──

export function createDefaultState(): TerminalGroupState {
  const groupId = '1';
  const pageId = '1';
  const gridLayout: GridNode = { type: 'leaf', groupId };
  return {
    groups: {
      [groupId]: { id: groupId, tabs: [], activeTabId: null },
    },
    activeGroupId: groupId,
    gridLayout,
    nextGroupId: 2,
    tabToGroupMap: {},
    pages: [{ id: pageId, gridLayout, activeGroupId: groupId }],
    activePageId: pageId,
    nextPageId: 2,
  };
}

// ── Adjacent tab activation helper ──

/** After removing a tab at `removedIndex`, pick the next active tab (prefer right, fallback left) */
function pickAdjacentTab(tabs: TerminalTab[], removedIndex: number): string | null {
  if (tabs.length === 0) return null;
  // prefer right (same index, which is now the next element), fallback left
  if (removedIndex < tabs.length) return tabs[removedIndex].id;
  return tabs[tabs.length - 1].id;
}

// ── Remove empty group helper ──

function maybeRemoveEmptyGroup(state: TerminalGroupState, groupId: string): TerminalGroupState {
  const group = state.groups[groupId];
  if (!group || group.tabs.length > 0) return state;
  // Don't remove the last group
  if (Object.keys(state.groups).length <= 1) return state;
  return removeGroupFromState(state, groupId);
}

function dropGroupRecords(state: TerminalGroupState, groupId: string): Pick<TerminalGroupState, 'groups' | 'tabToGroupMap'> {
  const group = state.groups[groupId];
  const groups = { ...state.groups };
  delete groups[groupId];
  const tabToGroupMap = { ...state.tabToGroupMap };
  if (group) {
    for (const tab of group.tabs) delete tabToGroupMap[tab.id];
  }
  return { groups, tabToGroupMap };
}

/** Grid that actually owns this group. The active page's copy is the live tree. */
function gridOwningGroup(state: TerminalGroupState, groupId: string): { page: WorkspacePage; grid: GridNode } | null {
  const active = state.pages.find((page) => page.id === state.activePageId);
  if (active && gridContains(state.gridLayout, groupId)) {
    return { page: active, grid: state.gridLayout };
  }
  const page = state.pages.find((candidate) =>
    candidate.id !== state.activePageId && gridContains(candidate.gridLayout, groupId),
  );
  return page ? { page, grid: page.gridLayout } : null;
}

function removeGroupFromState(state: TerminalGroupState, groupId: string): TerminalGroupState {
  const { groups, tabToGroupMap } = dropGroupRecords(state, groupId);
  const owner = gridOwningGroup(state, groupId);

  if (!owner) {
    const activeGroupId = state.activeGroupId === groupId
      ? (Object.keys(groups)[0] ?? state.activeGroupId)
      : state.activeGroupId;
    return { ...state, groups, tabToGroupMap, activeGroupId };
  }

  const removed = removeLeaf(owner.grid, groupId);
  const newGrid = removed ? simplifyTree(removed) : null;

  if (newGrid === null) {
    const remainingPages = state.pages.filter((page) => page.id !== owner.page.id);
    if (remainingPages.length === 0) {
      const remaining = Object.keys(groups)[0];
      const fallback: GridNode = { type: 'leaf', groupId: remaining };
      return {
        ...state,
        groups,
        tabToGroupMap,
        gridLayout: fallback,
        activeGroupId: remaining,
        pages: [{ id: owner.page.id, gridLayout: fallback, activeGroupId: remaining }],
        activePageId: owner.page.id,
      };
    }
    if (state.activePageId !== owner.page.id) {
      return { ...state, groups, tabToGroupMap, pages: remainingPages };
    }
    const index = state.pages.findIndex((page) => page.id === owner.page.id);
    const neighbor = remainingPages[Math.min(index, remainingPages.length - 1)];
    const activeGroupId = groups[neighbor.activeGroupId]
      ? neighbor.activeGroupId
      : collectLeafIds(neighbor.gridLayout)[0];
    return {
      ...state,
      groups,
      tabToGroupMap,
      pages: remainingPages,
      activePageId: neighbor.id,
      gridLayout: neighbor.gridLayout,
      activeGroupId,
    };
  }

  const leaves = collectLeafIds(newGrid);
  const pageActive = owner.page.activeGroupId === groupId ? leaves[0] : owner.page.activeGroupId;
  if (owner.page.id === state.activePageId) {
    return {
      ...state,
      groups,
      tabToGroupMap,
      gridLayout: newGrid,
      activeGroupId: state.activeGroupId === groupId ? pageActive : state.activeGroupId,
    };
  }
  return {
    ...state,
    groups,
    tabToGroupMap,
    pages: state.pages.map((page) =>
      page.id === owner.page.id ? { ...page, gridLayout: newGrid, activeGroupId: pageActive } : page,
    ),
  };
}

function appendTab(state: TerminalGroupState, groupId: string, tab: TerminalTab): TerminalGroupState {
  const group = state.groups[groupId];
  if (!group) return state;
  return {
    ...state,
    groups: {
      ...state.groups,
      [groupId]: { ...group, tabs: [...group.tabs, tab], activeTabId: tab.id },
    },
    tabToGroupMap: { ...state.tabToGroupMap, [tab.id]: groupId },
  };
}

function openTabOnNewPage(state: TerminalGroupState, tab: TerminalTab): TerminalGroupState {
  const saved = rememberActivePage(state);
  const newGroupId = String(state.nextGroupId);
  const newPageId = String(state.nextPageId);
  const newGroup: TerminalGroup = { id: newGroupId, tabs: [tab], activeTabId: tab.id };
  const gridLayout: GridNode = { type: 'leaf', groupId: newGroupId };
  return {
    ...saved,
    groups: { ...saved.groups, [newGroupId]: newGroup },
    gridLayout,
    activeGroupId: newGroupId,
    nextGroupId: state.nextGroupId + 1,
    nextPageId: state.nextPageId + 1,
    activePageId: newPageId,
    pages: [...saved.pages, { id: newPageId, gridLayout, activeGroupId: newGroupId }],
    tabToGroupMap: { ...state.tabToGroupMap, [tab.id]: newGroupId },
  };
}

// ── Main reducer ──

export function terminalGroupReducer(
  raw: TerminalGroupState,
  action: TerminalGroupAction,
): TerminalGroupState {
  if (action.type === 'RESET_LAYOUT') return createDefaultState();
  if (action.type === 'RESTORE_LAYOUT') return action.state;
  const state = ensurePages(raw);
  return rememberActivePage(applyTerminalGroupAction(state, action));
}

function applyTerminalGroupAction(
  state: TerminalGroupState,
  action: TerminalGroupAction,
): TerminalGroupState {
  switch (action.type) {
    case 'SPLIT_GROUP': {
      const { groupId, direction, newTab } = action;
      if (!state.groups[groupId]) return state;
      if (!gridContains(state.gridLayout, groupId)) return state;

      const newGroupId = String(state.nextGroupId);
      const tab = newTab ?? undefined;
      const newGroup: TerminalGroup = {
        id: newGroupId,
        tabs: tab ? [tab] : [],
        activeTabId: tab ? tab.id : null,
      };

      return {
        ...state,
        groups: { ...state.groups, [newGroupId]: newGroup },
        gridLayout: insertSplit(state.gridLayout, groupId, newGroupId, direction),
        nextGroupId: state.nextGroupId + 1,
        activeGroupId: newGroupId,
        tabToGroupMap: tab ? { ...state.tabToGroupMap, [tab.id]: newGroupId } : state.tabToGroupMap,
      };
    }

    case 'REMOVE_GROUP': {
      const { groupId } = action;
      if (!state.groups[groupId]) return state;
      if (Object.keys(state.groups).length <= 1) {
        // Preserve last group — clear its tabs and clean up map
        const group = state.groups[groupId];
        const newTabToGroupMap = { ...state.tabToGroupMap };
        for (const tab of group.tabs) {
          delete newTabToGroupMap[tab.id];
        }
        return {
          ...state,
          groups: {
            [groupId]: { ...group, tabs: [], activeTabId: null },
          },
          tabToGroupMap: newTabToGroupMap,
        };
      }
      return removeGroupFromState(state, groupId);
    }

    case 'ACTIVATE_GROUP': {
      if (!state.groups[action.groupId]) return state;
      const owner = gridOwningGroup(state, action.groupId);
      if (owner && owner.page.id !== state.activePageId) {
        const saved = rememberActivePage(state);
        return {
          ...saved,
          activePageId: owner.page.id,
          gridLayout: owner.grid,
          activeGroupId: action.groupId,
        };
      }
      if (state.activeGroupId === action.groupId) return state;
      return { ...state, activeGroupId: action.groupId };
    }

    case 'ACTIVATE_PAGE': {
      const page = state.pages.find((candidate) => candidate.id === action.pageId);
      if (!page || page.id === state.activePageId) return state;
      const saved = rememberActivePage(state);
      const activeGroupId = saved.groups[page.activeGroupId]
        ? page.activeGroupId
        : (collectLeafIds(page.gridLayout)[0] ?? saved.activeGroupId);
      return {
        ...saved,
        activePageId: page.id,
        gridLayout: page.gridLayout,
        activeGroupId,
      };
    }

    case 'ADD_TAB': {
      const focused = state.groups[state.activeGroupId];
      if (!focused) return state;
      // An empty focused pane is the place a session belongs: startup, or the
      // blank half of a split. A pane that already has a session opens a page.
      if (focused.tabs.length === 0) return appendTab(state, focused.id, action.tab);
      return openTabOnNewPage(state, action.tab);
    }

    case 'REMOVE_TAB': {
      const { groupId, tabId } = action;
      const group = state.groups[groupId];
      if (!group) return state;
      const tabIndex = group.tabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return state;

      const newTabs = group.tabs.filter((t) => t.id !== tabId);
      let newActiveTabId = group.activeTabId;
      if (group.activeTabId === tabId) {
        newActiveTabId = pickAdjacentTab(newTabs, tabIndex);
      }

      const newTabToGroupMap = { ...state.tabToGroupMap };
      delete newTabToGroupMap[tabId];

      const newState = {
        ...state,
        groups: {
          ...state.groups,
          [groupId]: { ...group, tabs: newTabs, activeTabId: newActiveTabId },
        },
        tabToGroupMap: newTabToGroupMap,
      };
      return maybeRemoveEmptyGroup(newState, groupId);
    }

    case 'ACTIVATE_TAB': {
      const group = state.groups[action.groupId];
      if (!group) return state;
      if (!group.tabs.some((t) => t.id === action.tabId)) return state;
      return {
        ...state,
        groups: {
          ...state.groups,
          [action.groupId]: { ...group, activeTabId: action.tabId },
        },
      };
    }

    case 'MOVE_TAB': {
      const { sourceGroupId, targetGroupId, tabId, targetIndex } = action;
      const sourceGroup = state.groups[sourceGroupId];
      const targetGroup = state.groups[targetGroupId];
      if (!sourceGroup || !targetGroup) return state;

      const tab = sourceGroup.tabs.find((t) => t.id === tabId);
      if (!tab) return state;

      // Remove from source
      const newSourceTabs = sourceGroup.tabs.filter((t) => t.id !== tabId);
      const removedIndex = sourceGroup.tabs.findIndex((t) => t.id === tabId);
      let newSourceActiveTabId = sourceGroup.activeTabId;
      if (sourceGroup.activeTabId === tabId) {
        newSourceActiveTabId = pickAdjacentTab(newSourceTabs, removedIndex);
      }

      // Add to target
      let newTargetTabs: TerminalTab[];
      if (sourceGroupId === targetGroupId) {
        // Same group — this is effectively a reorder
        newTargetTabs = [...newSourceTabs];
        const idx = targetIndex !== undefined ? Math.min(targetIndex, newTargetTabs.length) : newTargetTabs.length;
        newTargetTabs.splice(idx, 0, tab);
        return {
          ...state,
          groups: {
            ...state.groups,
            [sourceGroupId]: {
              ...sourceGroup,
              tabs: newTargetTabs,
              activeTabId: tab.id,
            },
          },
        };
      }

      // Different groups - update map
      newTargetTabs = [...targetGroup.tabs];
      const idx = targetIndex !== undefined ? Math.min(targetIndex, newTargetTabs.length) : newTargetTabs.length;
      newTargetTabs.splice(idx, 0, tab);

      let newState: TerminalGroupState = {
        ...state,
        groups: {
          ...state.groups,
          [sourceGroupId]: {
            ...sourceGroup,
            tabs: newSourceTabs,
            activeTabId: newSourceActiveTabId,
          },
          [targetGroupId]: {
            ...targetGroup,
            tabs: newTargetTabs,
            activeTabId: tab.id,
          },
        },
        tabToGroupMap: { ...state.tabToGroupMap, [tabId]: targetGroupId },
      };

      newState = maybeRemoveEmptyGroup(newState, sourceGroupId);
      return newState;
    }

    case 'REORDER_TAB': {
      const { groupId, fromIndex, toIndex } = action;
      const group = state.groups[groupId];
      if (!group) return state;
      if (fromIndex < 0 || fromIndex >= group.tabs.length) return state;
      if (toIndex < 0 || toIndex >= group.tabs.length) return state;
      if (fromIndex === toIndex) return state;

      const newTabs = [...group.tabs];
      const [moved] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, moved);

      return {
        ...state,
        groups: {
          ...state.groups,
          [groupId]: { ...group, tabs: newTabs },
        },
      };
    }

    case 'CLOSE_OTHER_TABS': {
      const { groupId, tabId } = action;
      const group = state.groups[groupId];
      if (!group) return state;
      const tab = group.tabs.find((t) => t.id === tabId);
      if (!tab) return state;
      const newTabToGroupMap = { ...state.tabToGroupMap };
      for (const t of group.tabs) {
        if (t.id !== tabId) delete newTabToGroupMap[t.id];
      }
      return {
        ...state,
        groups: {
          ...state.groups,
          [groupId]: { ...group, tabs: [tab], activeTabId: tab.id },
        },
        tabToGroupMap: newTabToGroupMap,
      };
    }

    case 'CLOSE_TABS_TO_RIGHT': {
      const { groupId, tabId } = action;
      const group = state.groups[groupId];
      if (!group) return state;
      const idx = group.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return state;
      const newTabs = group.tabs.slice(0, idx + 1);
      const removedTabs = group.tabs.slice(idx + 1);
      const newTabToGroupMap = { ...state.tabToGroupMap };
      for (const t of removedTabs) delete newTabToGroupMap[t.id];
      const newActiveTabId =
        group.activeTabId && newTabs.some((t) => t.id === group.activeTabId)
          ? group.activeTabId
          : newTabs[newTabs.length - 1]?.id ?? null;
      return {
        ...state,
        groups: {
          ...state.groups,
          [groupId]: { ...group, tabs: newTabs, activeTabId: newActiveTabId },
        },
        tabToGroupMap: newTabToGroupMap,
      };
    }

    case 'CLOSE_TABS_TO_LEFT': {
      const { groupId, tabId } = action;
      const group = state.groups[groupId];
      if (!group) return state;
      const idx = group.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return state;
      const newTabs = group.tabs.slice(idx);
      const removedTabs = group.tabs.slice(0, idx);
      const newTabToGroupMap = { ...state.tabToGroupMap };
      for (const t of removedTabs) delete newTabToGroupMap[t.id];
      const newActiveTabId =
        group.activeTabId && newTabs.some((t) => t.id === group.activeTabId)
          ? group.activeTabId
          : newTabs[0]?.id ?? null;
      return {
        ...state,
        groups: {
          ...state.groups,
          [groupId]: { ...group, tabs: newTabs, activeTabId: newActiveTabId },
        },
        tabToGroupMap: newTabToGroupMap,
      };
    }

    case 'MOVE_TAB_TO_NEW_GROUP': {
      const { groupId, tabId, direction, targetGroupId } = action;
      const sourceGroupId = groupId;
      const splitAt = targetGroupId ?? groupId;

      const sourceGroup = state.groups[sourceGroupId];
      if (!sourceGroup) return state;
      if (!state.groups[splitAt]) return state;
      if (!gridContains(state.gridLayout, splitAt)) return state;

      const tab = sourceGroup.tabs.find((t) => t.id === tabId);
      if (!tab) return state;

      // Remove tab from source group
      const newSourceTabs = sourceGroup.tabs.filter((t) => t.id !== tabId);
      const removedIndex = sourceGroup.tabs.findIndex((t) => t.id === tabId);
      let newSourceActiveTabId = sourceGroup.activeTabId;
      if (sourceGroup.activeTabId === tabId) {
        newSourceActiveTabId = pickAdjacentTab(newSourceTabs, removedIndex);
      }

      const newGroupId = String(state.nextGroupId);
      const newGroup: TerminalGroup = {
        id: newGroupId,
        tabs: [tab],
        activeTabId: tab.id,
      };

      // Split relative to target (may differ from source when dragging across panes).
      let newState: TerminalGroupState = {
        ...state,
        groups: {
          ...state.groups,
          [sourceGroupId]: {
            ...sourceGroup,
            tabs: newSourceTabs,
            activeTabId: newSourceActiveTabId,
          },
          [newGroupId]: newGroup,
        },
        gridLayout: insertSplit(state.gridLayout, splitAt, newGroupId, direction),
        nextGroupId: state.nextGroupId + 1,
        activeGroupId: newGroupId,
        tabToGroupMap: { ...state.tabToGroupMap, [tabId]: newGroupId },
      };

      newState = maybeRemoveEmptyGroup(newState, sourceGroupId);
      return newState;
    }

    case 'UPDATE_TAB_STATUS': {
      const { tabId, status } = action;
      const groupId = state.tabToGroupMap[tabId];
      if (!groupId) return state;

      const group = state.groups[groupId];
      if (!group) return state;

      const tabIndex = group.tabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return state;

      const newTabs = [...group.tabs];
      newTabs[tabIndex] = { ...newTabs[tabIndex], connectionStatus: status };

      return {
        ...state,
        groups: {
          ...state.groups,
          [groupId]: { ...group, tabs: newTabs },
        },
      };
    }

    case 'RECONNECT_TAB': {
      const { tabId } = action;
      const groupId = state.tabToGroupMap[tabId];
      if (!groupId) return state;

      const group = state.groups[groupId];
      if (!group) return state;

      const tabIndex = group.tabs.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return state;

      const newTabs = [...group.tabs];
      newTabs[tabIndex] = {
        ...newTabs[tabIndex],
        reconnectCount: (newTabs[tabIndex].reconnectCount ?? 0) + 1,
        connectionStatus: 'connecting',
      };

      return {
        ...state,
        groups: {
          ...state.groups,
          [groupId]: { ...group, tabs: newTabs },
        },
      };
    }

    case 'UPDATE_GRID_SIZES': {
      return {
        ...state,
        gridLayout: updateSizes(state.gridLayout, action.path, action.sizes),
      };
    }

    case 'RESET_LAYOUT':
    case 'RESTORE_LAYOUT':
      return state;

    default:
      return state;
  }
}
