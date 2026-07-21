import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { GridRenderer, StableTerminalGrid } from '../components/terminal/grid-renderer';
import { terminalGroupReducer } from '../lib/terminal-group-reducer';
import type { GridNode, TerminalGroupState, TerminalTab } from '../lib/terminal-group-types';

const ptyLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock('../components/pty-terminal', async () => {
  const React = await import('react');
  return {
    PtyTerminal: ({ connectionId }: { connectionId: string }) => {
      React.useEffect(() => {
        ptyLifecycle.mounts += 1;
        return () => {
          ptyLifecycle.unmounts += 1;
        };
      }, []);
      return <div data-mock-pty={connectionId} />;
    },
  };
});

// Mock the context
const mockDispatch = vi.fn();
const makeTab = (id: string): TerminalTab => ({
  id,
  name: id,
  protocol: 'SSH',
  connectionStatus: 'connected',
  reconnectCount: 0,
});

let mockState: TerminalGroupState = {
  groups: {
    g1: { id: 'g1', tabs: [], activeTabId: null },
    g2: { id: 'g2', tabs: [], activeTabId: null },
    g3: { id: 'g3', tabs: [], activeTabId: null },
  },
  activeGroupId: 'g1',
  gridLayout: { type: 'leaf', groupId: 'g1' },
  nextGroupId: 4,
  tabToGroupMap: {},
};
vi.mock('../lib/terminal-group-context', () => ({
  useTerminalGroups: () => ({
    state: mockState,
    dispatch: mockDispatch,
    activeGroup: null,
    activeTab: null,
    activeConnection: null,
  }),
}));

describe('GridRenderer', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    ptyLifecycle.mounts = 0;
    ptyLifecycle.unmounts = 0;
    mockState = {
      groups: {
        g1: { id: 'g1', tabs: [], activeTabId: null },
        g2: { id: 'g2', tabs: [], activeTabId: null },
        g3: { id: 'g3', tabs: [], activeTabId: null },
      },
      activeGroupId: 'g1',
      gridLayout: { type: 'leaf', groupId: 'g1' },
      nextGroupId: 4,
      tabToGroupMap: {},
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a leaf node as TerminalGroupView', () => {
    const node: GridNode = { type: 'leaf', groupId: 'g1' };
    const { container } = render(<GridRenderer node={node} path={[]} />);
    expect(container.querySelector('[data-group-id="g1"]')).not.toBeNull();
  });

  it('renders a branch node with multiple panels', () => {
    const node: GridNode = {
      type: 'branch',
      direction: 'horizontal',
      children: [
        { type: 'leaf', groupId: 'g1' },
        { type: 'leaf', groupId: 'g2' },
      ],
      sizes: [50, 50],
    };
    const { container } = render(<GridRenderer node={node} path={[]} />);
    expect(container.querySelector('[data-group-id="g1"]')).not.toBeNull();
    expect(container.querySelector('[data-group-id="g2"]')).not.toBeNull();
  });

  it('renders nested branch nodes recursively', () => {
    const node: GridNode = {
      type: 'branch',
      direction: 'horizontal',
      children: [
        { type: 'leaf', groupId: 'g1' },
        {
          type: 'branch',
          direction: 'vertical',
          children: [
            { type: 'leaf', groupId: 'g2' },
            { type: 'leaf', groupId: 'g3' },
          ],
          sizes: [50, 50],
        },
      ],
      sizes: [50, 50],
    };
    const { container } = render(<GridRenderer node={node} path={[]} />);
    expect(container.querySelector('[data-group-id="g1"]')).not.toBeNull();
    expect(container.querySelector('[data-group-id="g2"]')).not.toBeNull();
    expect(container.querySelector('[data-group-id="g3"]')).not.toBeNull();
  });

  it('dispatches UPDATE_GRID_SIZES with equal sizes on handle double-click', () => {
    const node: GridNode = {
      type: 'branch',
      direction: 'horizontal',
      children: [
        { type: 'leaf', groupId: 'g1' },
        { type: 'leaf', groupId: 'g2' },
        { type: 'leaf', groupId: 'g3' },
      ],
      sizes: [20, 30, 50],
    };
    render(<GridRenderer node={node} path={[1]} />);

    const handles = document.querySelectorAll('[data-slot="resizable-handle"]');
    expect(handles.length).toBe(2);

    fireEvent.doubleClick(handles[0]);

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_GRID_SIZES',
      path: [1],
      sizes: [100 / 3, 100 / 3, 100 / 3],
    });
  });

  it('keeps the existing terminal group mounted when its pane is split', () => {
    const resizeObserver = {
      observe: vi.fn(),
      disconnect: vi.fn(),
    };
    class ResizeObserverMock {
      observe = resizeObserver.observe;
      disconnect = resizeObserver.disconnect;
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);

    mockState = {
      ...mockState,
      groups: { g1: mockState.groups.g1 },
      gridLayout: { type: 'leaf', groupId: 'g1' },
    };
    const view = render(<StableTerminalGrid />);
    const originalGroupElement = view.container.querySelector('[data-group-id="g1"]');
    expect(originalGroupElement).not.toBeNull();

    mockState = terminalGroupReducer(mockState, {
      type: 'SPLIT_GROUP',
      groupId: 'g1',
      direction: 'right',
    });
    view.rerender(<StableTerminalGrid />);

    expect(view.container.querySelector('[data-group-id="g1"]')).toBe(originalGroupElement);
    expect(view.container.querySelector('[data-group-id="4"]')).not.toBeNull();

    mockState = terminalGroupReducer(mockState, {
      type: 'SPLIT_GROUP',
      groupId: 'g1',
      direction: 'down',
    });
    view.rerender(<StableTerminalGrid />);

    expect(view.container.querySelector('[data-group-id="g1"]')).toBe(originalGroupElement);
    expect(view.container.querySelector('[data-group-id="5"]')).not.toBeNull();
  });

  it('keeps one PTY mounted across repeated edge splits and a center move', async () => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);

    const tabs = [makeTab('t1'), makeTab('t2'), makeTab('t3')];
    mockState = {
      groups: {
        '1': { id: '1', tabs, activeTabId: 't1' },
      },
      activeGroupId: '1',
      gridLayout: { type: 'leaf', groupId: '1' },
      nextGroupId: 2,
      tabToGroupMap: { t1: '1', t2: '1', t3: '1' },
    };

    const view = render(<StableTerminalGrid />);
    await waitFor(() => expect(view.container.querySelector('[data-mock-pty="t1"]')).not.toBeNull());
    const originalPty = view.container.querySelector('[data-mock-pty="t1"]');
    expect(ptyLifecycle.mounts).toBe(3);
    expect(ptyLifecycle.unmounts).toBe(0);

    mockState = terminalGroupReducer(mockState, {
      type: 'MOVE_TAB_TO_NEW_GROUP',
      groupId: '1',
      tabId: 't1',
      direction: 'right',
    });
    view.rerender(<StableTerminalGrid />);

    expect(view.container.querySelector('[data-mock-pty="t1"]')).toBe(originalPty);
    expect(ptyLifecycle.mounts).toBe(3);
    expect(ptyLifecycle.unmounts).toBe(0);

    mockState = terminalGroupReducer(mockState, {
      type: 'MOVE_TAB_TO_NEW_GROUP',
      groupId: '2',
      tabId: 't1',
      direction: 'down',
    });
    view.rerender(<StableTerminalGrid />);

    expect(view.container.querySelector('[data-mock-pty="t1"]')).toBe(originalPty);
    expect(ptyLifecycle.mounts).toBe(3);
    expect(ptyLifecycle.unmounts).toBe(0);

    mockState = terminalGroupReducer(mockState, {
      type: 'MOVE_TAB',
      sourceGroupId: '3',
      targetGroupId: '1',
      tabId: 't1',
    });
    view.rerender(<StableTerminalGrid />);

    expect(view.container.querySelector('[data-mock-pty="t1"]')).toBe(originalPty);
    expect(ptyLifecycle.mounts).toBe(3);
    expect(ptyLifecycle.unmounts).toBe(0);
  });

  it('still remounts a PTY for an explicit reconnect', async () => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);

    const tab = makeTab('t1');
    mockState = {
      groups: { '1': { id: '1', tabs: [tab], activeTabId: tab.id } },
      activeGroupId: '1',
      gridLayout: { type: 'leaf', groupId: '1' },
      nextGroupId: 2,
      tabToGroupMap: { t1: '1' },
    };
    const view = render(<StableTerminalGrid />);
    await waitFor(() => expect(ptyLifecycle.mounts).toBe(1));

    mockState = terminalGroupReducer(mockState, { type: 'RECONNECT_TAB', tabId: 't1' });
    view.rerender(<StableTerminalGrid />);

    expect(ptyLifecycle.mounts).toBe(2);
    expect(ptyLifecycle.unmounts).toBe(1);
  });
});
