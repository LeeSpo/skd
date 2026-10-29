import { useLayoutEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceTabBar } from '@/components/terminal/workspace-tab-bar';
import { StableTerminalGrid } from '@/components/terminal/grid-renderer';
import { TerminalGroupProvider, useTerminalGroups } from '@/lib/terminal-group-context';
import { TerminalCallbacksProvider } from '@/lib/terminal-callbacks-context';
import { TitlebarSlotProvider, useTitlebarSlotSetter } from '@/lib/titlebar-slot-context';
import { createDefaultState, terminalGroupReducer } from '@/lib/terminal-group-reducer';
import type { TerminalGroupState, TerminalTab } from '@/lib/terminal-group-types';
import {
  clearTabDrag,
  getActiveDrag,
  getContentDropHover,
  registerContentDropTarget,
  unregisterContentDropTarget,
} from '@/lib/tab-drag-state';

const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn(), close: vi.fn() }));
vi.mock('@/components/pty-terminal', async () => {
  const React = await import('react');
  return {
    PtyTerminal: ({ connectionId }: { connectionId: string }) => {
      React.useEffect(() => {
        lifecycle.mount(connectionId);
        return () => { lifecycle.unmount(connectionId); };
      }, []);
      return <div data-mock-pty={connectionId} />;
    },
  };
});
vi.mock('@/components/terminal/new-tab-menu', () => ({
  NewTabMenu: () => <button type="button">New tab</button>,
}));
vi.mock('@/components/welcome-screen', () => ({ WelcomeScreen: () => null }));

const tab = (id: string): TerminalTab => ({ id, name: id, protocol: 'SSH', connectionStatus: 'connected', reconnectCount: 0 });
let currentState: TerminalGroupState;
let frames: Map<number, FrameRequestCallback>;

function workspace(split = false, empty = false) {
  let state = terminalGroupReducer(createDefaultState(), { type: 'ADD_TAB', groupId: '1', tab: tab('a') });
  if (split) {
    state = terminalGroupReducer(state, { type: 'SPLIT_GROUP', groupId: '1', direction: 'right', newTab: empty ? undefined : tab('peer') });
  }
  // Move back to the occupied pane so a new session opens another page.
  state = terminalGroupReducer(state, { type: 'ACTIVATE_GROUP', groupId: '1' });
  for (const id of ['b', 'c']) {
    state = terminalGroupReducer(state, { type: 'ADD_TAB', groupId: state.activeGroupId, tab: tab(id) });
  }
  return terminalGroupReducer(state, { type: 'ACTIVATE_PAGE', pageId: '1' });
}

function Harness({ initialState, grid }: { initialState: TerminalGroupState; grid: boolean }) {
  const { state, dispatch } = useTerminalGroups();
  const setSlot = useTitlebarSlotSetter();
  useLayoutEffect(() => { dispatch({ type: 'RESTORE_LAYOUT', state: initialState }); }, [dispatch, initialState]);
  useLayoutEffect(() => { currentState = state; }, [state]);
  return (
    <>
      <div data-testid="titlebar" ref={setSlot} />
      {grid ? <StableTerminalGrid /> : <WorkspaceTabBar />}
    </>
  );
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) };
}

function renderWorkspace(initialState = workspace(), { width = 300, grid = false } = {}) {
  const view = render(
    <TerminalGroupProvider>
      <TerminalCallbacksProvider value={{ onRequestCloseTabs: lifecycle.close }}>
        <TitlebarSlotProvider><Harness initialState={initialState} grid={grid} /></TitlebarSlotProvider>
      </TerminalCallbacksProvider>
    </TerminalGroupProvider>,
  );
  const bar = view.container.querySelector<HTMLElement>('[data-workspace-tab-bar]')!;
  bar.getBoundingClientRect = () => rect(0, 0, width, 40);
  Object.defineProperty(bar, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(bar, 'scrollWidth', { configurable: true, value: 300 });
  for (const element of bar.querySelectorAll<HTMLElement>('[data-page-id]')) {
    element.getBoundingClientRect = () => rect(pageIds(bar).indexOf(element.dataset.pageId!) * 100 - bar.scrollLeft, 6, 100, 28);
  }
  return { ...view, bar };
}

function pageIds(bar: HTMLElement) {
  return Array.from(bar.querySelectorAll<HTMLElement>('[data-page-id]'), (element) => element.dataset.pageId!);
}

function page(bar: HTMLElement, id: string) {
  return bar.querySelector<HTMLElement>(`[data-page-id="${id}"]`)!;
}

function startDrag(source: Element, x = 50) {
  fireEvent.pointerDown(source, { button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: 20 });
}
function move(x: number, y = 20, pointerId = 1) {
  fireEvent.pointerMove(document, { pointerId, clientX: x, clientY: y });
}
function release(x: number, y = 20, pointerId = 1) {
  fireEvent.pointerUp(document, { pointerId, clientX: x, clientY: y });
}
function tick() {
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => { callbacks.forEach((callback) => callback(16)); });
}
function contentTarget() {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => rect(0, 50, 300, 200);
  registerContentDropTarget('1', element);
}

beforeEach(() => {
  clearTabDrag();
  vi.clearAllMocks();
  frames = new Map();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (frameId: number) => { frames.delete(frameId); });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  unregisterContentDropTarget('1');
  clearTabDrag();
  vi.unstubAllGlobals();
  document.body.style.userSelect = '';
});

describe('WorkspaceTabBar drag ordering', () => {
  it.each([
    ['1', 50, 290, ['2', '3', '1'], '299px'],
    ['3', 250, 10, ['3', '1', '2'], '1px'],
    ['1', 50, 210, ['2', '1', '3'], '200px'],
  ] as const)('reorders page %s with an insertion marker', (id, start, end, expected, markerLeft) => {
    const { bar } = renderWorkspace();
    const before = currentState;
    const originalSegments = new Map(pageIds(bar).map((pageId) => [pageId, page(bar, pageId)]));
    startDrag(page(bar, id), start);
    move(end);
    expect(bar.querySelector<HTMLElement>('[data-workspace-tab-insertion]')?.style.left).toBe(markerLeft);
    expect(pageIds(bar)).toEqual(['1', '2', '3']);
    expect(getContentDropHover()).toBeNull();
    release(end);
    expect(pageIds(bar)).toEqual(expected);
    expect(currentState.activePageId).toBe(before.activePageId);
    expect(currentState.groups).toBe(before.groups);
    expect(currentState.gridLayout).toBe(before.gridLayout);
    for (const pageId of expected) expect(page(bar, pageId)).toBe(originalSegments.get(pageId));
    expect(bar.querySelector('[data-workspace-tab-insertion]')).toBeNull();
    expect(getActiveDrag()).toBeNull();
    expect(frames.size).toBe(0);
    // The pointer-generated click must not activate a different page or pane.
    fireEvent.click(page(bar, id), { detail: 1 });
    expect(currentState.activePageId).toBe(before.activePageId);
  });

  it.each(['a', 'peer'])('moves the whole split when dragging %s, preserving focused pane', (name) => {
    const { bar } = renderWorkspace(workspace(true));
    const before = currentState;
    const splitPage = before.pages[0];
    const source = screen.getByRole('button', { name, exact: true });
    startDrag(source);
    move(290);
    release(290);
    fireEvent.click(source, { detail: 1 });
    expect(pageIds(bar)).toEqual(['2', '3', '1']);
    expect(currentState.pages[2]).toBe(splitPage);
    expect(currentState.activeGroupId).toBe(before.activeGroupId);
    expect(currentState.groups).toBe(before.groups);
    expect(page(bar, '1').querySelectorAll('[data-split-pane]')).toHaveLength(2);
  });

  it('reorders a summary whose focused split pane is empty', () => {
    let initial = workspace(true, true);
    initial = terminalGroupReducer(initial, { type: 'ACTIVATE_GROUP', groupId: '2' });
    const { bar } = renderWorkspace(initial);
    const summary = bar.querySelector<HTMLElement>('[data-split-summary]')!;
    expect(summary.getAttribute('data-tauri-drag-region')).toBe('false');
    startDrag(screen.getByRole('button', { name: 'a', exact: true }));
    move(290);
    release(290);
    expect(pageIds(bar)).toEqual(['2', '3', '1']);
    expect(currentState.activeGroupId).toBe('2');
    expect(currentState.gridLayout).toBe(initial.gridLayout);
  });

  it('keeps clicks, small movements and close controls working normally', () => {
    const { bar } = renderWorkspace();
    const source = screen.getByRole('button', { name: 'b', exact: true });
    startDrag(source, 150);
    move(152);
    release(152);
    fireEvent.click(source, { detail: 1 });
    expect(pageIds(bar)).toEqual(['1', '2', '3']);
    expect(currentState.activePageId).toBe('2');
    const close = screen.getByRole('button', { name: 'Close a' });
    startDrag(close);
    move(290);
    release(290);
    fireEvent.click(close, { detail: 1 });
    expect(lifecycle.close).toHaveBeenCalledExactlyOnceWith([{ groupId: '1', tabId: 'a' }]);
    expect(currentState.activePageId).toBe('2');
    expect(getActiveDrag()).toBeNull();
  });

  it('ignores right buttons and unrelated pointers', () => {
    const { bar } = renderWorkspace();
    fireEvent.pointerDown(page(bar, '1'), { button: 2, pointerId: 1, clientX: 50, clientY: 20 });
    move(290);
    release(290);
    expect(pageIds(bar)).toEqual(['1', '2', '3']);
    startDrag(page(bar, '1'));
    move(290, 20, 2);
    release(290, 20, 2);
    expect(getActiveDrag()).toBeNull();
    move(290);
    release(290);
    expect(pageIds(bar)).toEqual(['2', '3', '1']);
  });

  it.each(['pointercancel', 'blur', 'Escape', 'unmount'])('cancels %s without splitting at the last hovered edge', (reason) => {
    const { bar, unmount } = renderWorkspace();
    const before = currentState;
    document.body.style.userSelect = 'text';
    contentTarget();
    startDrag(page(bar, '2'), 150);
    move(290, 150);
    expect(getContentDropHover()).toEqual({ groupId: '1', zone: 'right' });
    if (reason === 'pointercancel') fireEvent.pointerCancel(document, { pointerId: 1 });
    else if (reason === 'blur') fireEvent.blur(window);
    else if (reason === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    else unmount();
    release(290, 150);
    expect(currentState).toBe(before);
    expect(getActiveDrag()).toBeNull();
    expect(getContentDropHover()).toBeNull();
    expect(document.body.style.userSelect).toBe('text');
    expect(frames.size).toBe(0);
  });

  it('cancels a reorder preview and its auto-scroll on Escape', () => {
    const { bar } = renderWorkspace(workspace(), { width: 220 });
    startDrag(page(bar, '1'));
    move(215);
    expect(bar.querySelector('[data-workspace-tab-insertion]')).not.toBeNull();
    expect(frames.size).toBeGreaterThan(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(bar.querySelector('[data-workspace-tab-insertion]')).toBeNull();
    expect(frames.size).toBe(0);
    release(215);
    expect(pageIds(bar)).toEqual(['1', '2', '3']);
  });

  it.each([150, 400])('ignores a center or outside release after hovering an edge (x: %s)', (x) => {
    const { bar } = renderWorkspace();
    const before = currentState;
    contentTarget();
    startDrag(page(bar, '2'), 150);
    move(290, 150);
    release(x, 150);
    expect(currentState).toBe(before);
    expect(getContentDropHover()).toBeNull();
  });

  it('switches between split preview and reorder, using the release location', () => {
    const { bar } = renderWorkspace();
    const before = currentState;
    contentTarget();
    startDrag(page(bar, '2'), 150);
    move(290, 150);
    expect(getContentDropHover()?.zone).toBe('right');
    expect(bar.querySelector('[data-workspace-tab-insertion]')).toBeNull();
    move(10);
    expect(getContentDropHover()).toBeNull();
    expect(bar.querySelector('[data-workspace-tab-insertion]')).not.toBeNull();
    release(10);
    expect(pageIds(bar)).toEqual(['2', '1', '3']);
    expect(currentState.groups).toBe(before.groups);
  });

  it('keeps content-edge drops creating splits instead of reordering', () => {
    const { bar } = renderWorkspace();
    contentTarget();
    startDrag(page(bar, '2'), 150);
    move(10);
    release(290, 150);
    expect(currentState.gridLayout.type).toBe('branch');
    expect(currentState.pages.map((entry) => entry.id)).toEqual(['1', '3']);
    expect(currentState.groups[currentState.tabToGroupMap.b].tabs[0].id).toBe('b');
    expect(currentState.activePageId).toBe('1');
    expect(getActiveDrag()).toBeNull();
  });

  it.each(['left', 'right'])('auto-scrolls %s and keeps the marker in scroll-content coordinates', (direction) => {
    const { bar } = renderWorkspace(workspace(), { width: 220 });
    const right = direction === 'right';
    bar.scrollLeft = right ? 0 : 80;
    startDrag(page(bar, right ? '1' : '3'), right ? 50 : 170);
    move(right ? 215 : 5);
    for (let index = 0; index < 10; index++) tick();
    expect(bar.scrollLeft).toBe(right ? 80 : 0);
    expect(bar.querySelector<HTMLElement>('[data-workspace-tab-insertion]')?.style.left).toBe(right ? '299px' : '1px');
    release(right ? 215 : 5);
    expect(pageIds(bar)).toEqual(right ? ['2', '3', '1'] : ['3', '1', '2']);
    expect(frames.size).toBe(0);
  });

  it('refreshes the marker when the bar is manually scrolled mid-drag', () => {
    const { bar } = renderWorkspace(workspace(), { width: 220 });
    startDrag(page(bar, '1'));
    move(140);
    expect(bar.querySelector<HTMLElement>('[data-workspace-tab-insertion]')?.style.left).toBe('100px');
    bar.scrollLeft = 80;
    fireEvent.scroll(bar);
    expect(bar.querySelector<HTMLElement>('[data-workspace-tab-insertion]')?.style.left).toBe('200px');
    release(140);
    expect(pageIds(bar)).toEqual(['2', '1', '3']);
  });

  it.each(['1', '3'])('preserves titlebar portal, surfaces and PTY mounts while page %s is active', async (activePageId) => {
    const initialState = terminalGroupReducer(workspace(true), { type: 'ACTIVATE_PAGE', pageId: activePageId });
    const { bar, container } = renderWorkspace(initialState, { grid: true });
    await waitFor(() => expect(lifecycle.mount).toHaveBeenCalledTimes(4));
    const slot = screen.getByTestId('titlebar');
    const portalHost = slot.querySelector('[data-tab-portal-host]');
    const surfaces = new Map(['a', 'peer', 'b', 'c'].map((id) => [id, container.querySelector(`[data-mock-pty="${id}"]`)]));
    const splitLayout = currentState.gridLayout;
    for (const [id, start, end] of [['1', 50, 290], ['2', 50, 290], ['1', 150, 10]] as const) {
      startDrag(page(bar, id), start);
      move(end);
      release(end);
    }
    expect(slot.querySelector('[data-tab-portal-host]')).toBe(portalHost);
    expect(slot.querySelector('[data-workspace-tab-bar]')).toBe(bar);
    expect(currentState.gridLayout).toBe(splitLayout);
    expect(currentState.activePageId).toBe(activePageId);
    expect(container.querySelectorAll('[data-terminal-group-slot]')).toHaveLength(activePageId === '1' ? 2 : 1);
    for (const [id, surface] of surfaces) {
      expect(surface).not.toBeNull();
      expect(container.querySelector(`[data-mock-pty="${id}"]`)).toBe(surface);
    }
    expect(lifecycle.mount).toHaveBeenCalledTimes(4);
    expect(lifecycle.unmount).not.toHaveBeenCalled();
    expect(lifecycle.close).not.toHaveBeenCalled();
  });
});
