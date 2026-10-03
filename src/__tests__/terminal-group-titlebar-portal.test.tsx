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

describe('titlebar tab portal', () => {
  it('moves the same tab bar between the titlebar and the pane without remounting the terminal', async () => {
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
    };
    rerender(
      <TitlebarSlotProvider>
        <Harness />
      </TitlebarSlotProvider>,
    );

    expect(slot?.querySelector('[data-tab-id="a"]')).toBeNull();
    const moved = container.querySelector('[data-tab-bar-host="pane"] [data-probe="kept"]');
    expect(moved).toBeTruthy();
    expect(container.querySelector('[data-terminal-tab-surface="a"][data-probe="kept"]')).toBeTruthy();
    expect(container.querySelector('[data-variant="pane"]')).toBeTruthy();
  });
});
