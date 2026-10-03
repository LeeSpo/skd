import { act, useState } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalGroupView } from '@/components/terminal/terminal-group-view';
import { TitlebarSlotProvider, useTitlebarSlotSetter } from '@/lib/titlebar-slot-context';
import type { TerminalGroupState, TerminalTab } from '@/lib/terminal-group-types';

vi.mock('@/components/pty-terminal', () => ({
  PtyTerminal: ({ connectionId }: { connectionId: string }) => <div data-mock-pty={connectionId} />,
}));
vi.mock('@/components/welcome-screen', () => ({ WelcomeScreen: () => <div data-welcome /> }));
vi.mock('@/components/terminal/new-tab-menu', () => ({ NewTabMenu: () => <button type="button">+</button> }));
vi.mock('@/lib/terminal-callbacks-context', () => ({ useTerminalCallbacks: () => ({}) }));
vi.mock('@/lib/connection-attempt-context', () => ({ useConnectionAttempts: () => ({ attempts: {} }) }));

const tab = (id: string): TerminalTab => ({
  id,
  name: `Host ${id}`,
  protocol: 'SSH',
  host: 'db.internal',
  username: 'root',
  connectionStatus: 'connected',
  reconnectCount: 0,
});

let mockState: TerminalGroupState;
vi.mock('@/lib/terminal-group-context', () => ({
  useTerminalGroups: () => ({ state: mockState, dispatch: vi.fn() }),
}));

function Harness() {
  const setSlot = useTitlebarSlotSetter();
  const [slot, setNode] = useState<HTMLDivElement | null>(null);
  return (
    <div>
      <div id="titlebar-tabs-slot" ref={(node) => { setNode(node); setSlot(node); }} />
      {slot && <TerminalGroupView groupId="g1" />}
    </div>
  );
}

afterEach(cleanup);

function SplitHarness() {
  const setSlot = useTitlebarSlotSetter();
  const [slot, setNode] = useState<HTMLDivElement | null>(null);
  return (
    <div>
      <div id="titlebar-tabs-slot" ref={(node) => { setNode(node); setSlot(node); }} />
      {slot && (
        <>
          <TerminalGroupView groupId="g1" />
          <TerminalGroupView groupId="g2" />
        </>
      )}
    </div>
  );
}

describe('titlebar tab portal', () => {
  it('keeps the active group in the titlebar when split, without a pane row or remount', async () => {
    mockState = {
      groups: { g1: { id: 'g1', tabs: [tab('a')], activeTabId: 'a' } },
      activeGroupId: 'g1',
      gridLayout: { type: 'leaf', groupId: 'g1' },
      nextGroupId: 2,
      tabToGroupMap: { a: 'g1' },
    };
    const { rerender, container } = await act(async () => render(
      <TitlebarSlotProvider>
        <Harness />
      </TitlebarSlotProvider>,
    ));
    await act(async () => { await Promise.resolve(); });

    const slot = document.getElementById('titlebar-tabs-slot');
    const tabEl = slot?.querySelector('[data-tab-id="a"]');
    const surface = container.querySelector('[data-terminal-tab-surface="a"]');
    expect(tabEl).toBeTruthy();
    expect(surface).toBeTruthy();
    tabEl!.setAttribute('data-probe', 'kept');
    surface!.setAttribute('data-probe', 'kept');

    mockState = {
      ...mockState,
      groups: {
        g1: { id: 'g1', tabs: [tab('a')], activeTabId: 'a' },
        g2: { id: 'g2', tabs: [tab('b')], activeTabId: 'b' },
      },
      gridLayout: {
        type: 'branch',
        direction: 'horizontal',
        children: [{ type: 'leaf', groupId: 'g1' }, { type: 'leaf', groupId: 'g2' }],
        sizes: [50, 50],
      },
      tabToGroupMap: { a: 'g1', b: 'g2' },
    };
    rerender(
      <TitlebarSlotProvider>
        <Harness />
      </TitlebarSlotProvider>,
    );

    expect(slot?.querySelector('[data-tab-id="a"][data-probe="kept"]')).toBeTruthy();
    expect(slot?.querySelector('[data-tab-id="a"]')?.textContent).toContain('Host b');
    expect(slot?.querySelector('[data-tab-id="b"]')).toBeNull();
    expect(slot?.querySelector('[data-variant="titlebar"]')).toBeTruthy();
    expect(container.querySelector('[data-tab-bar-host="pane"]')?.hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('[data-terminal-tab-surface="a"][data-probe="kept"]')).toBeTruthy();
  });

  it('writes both split sessions into the focused segment and hides every pane strip', async () => {
    mockState = {
      groups: {
        g1: { id: 'g1', tabs: [tab('a')], activeTabId: 'a' },
        g2: { id: 'g2', tabs: [tab('b')], activeTabId: 'b' },
      },
      activeGroupId: 'g2',
      gridLayout: { type: 'branch', direction: 'horizontal', children: [{ type: 'leaf', groupId: 'g1' }, { type: 'leaf', groupId: 'g2' }], sizes: [50, 50] },
      nextGroupId: 3,
      tabToGroupMap: { a: 'g1', b: 'g2' },
    };
    const { container, rerender } = await act(async () => render(
      <TitlebarSlotProvider>
        <SplitHarness />
      </TitlebarSlotProvider>,
    ));
    await act(async () => { await Promise.resolve(); });

    const slot = document.getElementById('titlebar-tabs-slot');
    const focused = slot?.querySelector('[data-tab-id="b"]');
    expect(focused?.textContent).toContain('Host a');
    expect(focused?.textContent).toContain('Host b');
    expect(slot?.querySelector('[data-tab-id="a"]')).toBeNull();
    const paneHosts = container.querySelectorAll('[data-tab-bar-host="pane"]');
    expect(paneHosts).toHaveLength(2);
    for (const host of paneHosts) {
      expect(host.hasAttribute('hidden')).toBe(true);
    }

    mockState = { ...mockState, activeGroupId: 'g1' };
    rerender(
      <TitlebarSlotProvider>
        <SplitHarness />
      </TitlebarSlotProvider>,
    );
    const next = slot?.querySelector('[data-tab-id="a"]');
    expect(next?.textContent).toContain('Host a');
    expect(next?.textContent).toContain('Host b');
    expect(slot?.querySelector('[data-tab-id="b"]')).toBeNull();
  });

  it('keeps the existing session beside an empty focused pane', async () => {
    mockState = {
      groups: {
        g1: { id: 'g1', tabs: [tab('a')], activeTabId: 'a' },
        g2: { id: 'g2', tabs: [], activeTabId: null },
      },
      activeGroupId: 'g2',
      gridLayout: {
        type: 'branch',
        direction: 'horizontal',
        children: [{ type: 'leaf', groupId: 'g1' }, { type: 'leaf', groupId: 'g2' }],
        sizes: [50, 50],
      },
      nextGroupId: 3,
      tabToGroupMap: { a: 'g1' },
    };
    await act(async () => render(
      <TitlebarSlotProvider>
        <SplitHarness />
      </TitlebarSlotProvider>,
    ));
    await act(async () => { await Promise.resolve(); });

    const slot = document.getElementById('titlebar-tabs-slot');
    expect(slot?.querySelector('[data-split-summary]')?.textContent).toContain('Host a');
    expect(slot?.querySelector('[data-tab-id="a"]')).toBeNull();
    const newTabButtons = Array.from(slot?.querySelectorAll('button') ?? []).filter((button) => button.textContent === '+');
    expect(newTabButtons).toHaveLength(1);
  });

  it('keeps a separate page as its own segment while the split page shows both panes', async () => {
    const local = tab('local');
    local.name = 'Local';
    local.protocol = 'Local';
    const splitGrid: TerminalGroupState['gridLayout'] = {
      type: 'branch',
      direction: 'horizontal',
      children: [{ type: 'leaf', groupId: 'g1' }, { type: 'leaf', groupId: 'g2' }],
      sizes: [50, 50],
    };
    mockState = {
      groups: {
        g1: { id: 'g1', tabs: [tab('a')], activeTabId: 'a' },
        g2: { id: 'g2', tabs: [tab('b')], activeTabId: 'b' },
        g3: { id: 'g3', tabs: [local], activeTabId: 'local' },
      },
      activeGroupId: 'g1',
      gridLayout: splitGrid,
      nextGroupId: 4,
      tabToGroupMap: { a: 'g1', b: 'g2', local: 'g3' },
      pages: [
        { id: 'split', gridLayout: splitGrid, activeGroupId: 'g1' },
        { id: 'local', gridLayout: { type: 'leaf', groupId: 'g3' }, activeGroupId: 'g3' },
      ],
      activePageId: 'split',
      nextPageId: 3,
    };
    await act(async () => render(
      <TitlebarSlotProvider>
        <SplitHarness />
      </TitlebarSlotProvider>,
    ));
    await act(async () => { await Promise.resolve(); });

    const slot = document.getElementById('titlebar-tabs-slot');
    const splitSegment = slot?.querySelector('[data-page-id="split"]');
    const localSegment = slot?.querySelector('[data-page-id="local"]');
    expect(splitSegment?.textContent).toContain('Host a');
    expect(splitSegment?.textContent).toContain('Host b');
    expect(splitSegment?.querySelectorAll('[data-split-pane]')).toHaveLength(2);
    expect(localSegment?.textContent).toContain('Local');
    expect(localSegment?.textContent).not.toContain('Host b');
    expect(localSegment?.querySelector('[data-split-pane]')).toBeNull();
    expect(slot?.querySelector('[data-tab-id="b"]')).toBeNull();
  });
});
