import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroupTabBar } from '@/components/terminal/group-tab-bar';
import type { TerminalTab } from '@/lib/terminal-group-types';

const { dispatch, close, groupFocus } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  close: vi.fn(),
  groupFocus: { activeGroupId: 'g' },
}));
vi.mock('@/lib/terminal-group-context', () => ({
  useTerminalGroups: () => ({
    dispatch,
    state: {
      activeGroupId: groupFocus.activeGroupId,
      groups: {},
      gridLayout: { type: 'leaf', groupId: 'g' },
      nextGroupId: 1,
      tabToGroupMap: {},
    },
  }),
}));
vi.mock('@/lib/terminal-callbacks-context', () => ({ useTerminalCallbacks: () => ({ onRequestCloseTabs: close }) }));
vi.mock('@/components/terminal/new-tab-menu', () => ({
  NewTabMenu: ({ triggerClassName }: { triggerClassName?: string }) => (
    <button type="button" className={triggerClassName}>New tab</button>
  ),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const tabs: TerminalTab[] = ['connected', 'connecting', 'disconnected', 'pending'].map((status, i) => ({
  id: String(i), name: `Host ${i}`, connectionStatus: status as TerminalTab['connectionStatus'], reconnectCount: 0,
}));

describe('GroupTabBar visual pilot', () => {
  it('splits pane tabs into the same equal capsules as the titlebar', () => {
    const { container } = render(<GroupTabBar groupId="g" tabs={tabs} activeTabId="0" />);
    const bar = container.querySelector('[data-variant="pane"]');
    expect(bar?.className).toContain('h-9');
    expect(bar?.className).toContain('bg-workspace');
    expect(bar?.className).not.toContain('h-[30px]');
    expect(bar?.className).not.toContain('bg-panel-header');
    expect(bar?.className).not.toContain('border-b');
    expect(bar?.hasAttribute('data-tauri-drag-region')).toBe(false);
    const active = container.querySelector('[data-tab-id="0"]');
    const idle = container.querySelector('[data-tab-id="1"]');
    expect(active?.className).toContain('flex-1');
    expect(active?.className).toContain('basis-0');
    expect(active?.className).toContain('justify-center');
    expect(active?.className).toContain('rounded-[var(--radius-control)]');
    expect(active?.className).toContain('titlebar-tab-active');
    expect(active?.className).not.toContain('max-w-');
    expect(idle?.className).toContain('titlebar-tab-idle');
    expect(screen.getByRole('button', { name: 'Host 0' }).className).toContain('justify-center');
    expect(screen.getByRole('button', { name: 'New tab' }).className).toContain('rounded-[var(--radius-control)]');
  });

  it('splits titlebar tabs into equal shares of the bar', () => {
    const { container } = render(<GroupTabBar variant="titlebar" groupId="g" tabs={tabs} activeTabId="0" />);
    const bar = container.querySelector('[data-variant="titlebar"]');
    expect(bar?.className).toContain('h-full');
    expect(bar?.getAttribute('data-tauri-drag-region')).toBe('true');
    const scroller = container.querySelector('[data-tab-bar-group="g"]');
    expect(scroller?.className).toContain('flex-1');
    const active = container.querySelector('[data-tab-id="0"]');
    const idle = container.querySelector('[data-tab-id="1"]');
    expect(active?.className).toContain('titlebar-tab-active');
    expect(active?.className).toContain('flex-1');
    expect(active?.className).toContain('basis-0');
    expect(active?.className).not.toContain('max-w-');
    expect(idle?.className).toContain('flex-1');
    expect(idle?.className).toContain('basis-0');
    expect(active?.className).toContain('justify-center');
    expect(screen.getByRole('button', { name: 'Host 0' }).className).toContain('justify-center');
    expect(active?.className).toContain('rounded-[var(--radius-control)]');
    expect(active?.getAttribute('data-tauri-drag-region')).toBe('false');
    expect(idle?.className).toContain('titlebar-tab-idle');
    expect(container.querySelector('.titlebar-tab-separator')).toBeNull();
    expect(screen.getByRole('button', { name: 'New tab' }).className).toContain('rounded-[var(--radius-control)]');
    expect(screen.getByRole('button', { name: 'Close Host 1' }).getAttribute('data-tauri-drag-region')).toBe('false');
  });

  it('keeps abnormal states visible without a green dot on healthy tabs', () => {
    const { container } = render(<GroupTabBar groupId="g" tabs={tabs} activeTabId="0" />);
    expect(container.querySelector('[data-variant="connected"]')).toBeNull();
    for (const status of ['connecting', 'disconnected', 'pending']) {
      expect(container.querySelector(`[data-variant="${status}"]`)?.getAttribute('aria-label')).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Host 0' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('activates via the native button and closes without activating the tab', () => {
    groupFocus.activeGroupId = 'g';
    render(<GroupTabBar groupId="g" tabs={tabs} activeTabId="0" />);
    fireEvent.click(screen.getByRole('button', { name: 'Host 0' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'ACTIVATE_TAB', groupId: 'g', tabId: '0' });
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'ACTIVATE_GROUP', groupId: 'g' });
    dispatch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Close Host 1' }));
    expect(close).toHaveBeenCalledWith([{ groupId: 'g', tabId: '1' }]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('focuses another pane when its tab is chosen', () => {
    groupFocus.activeGroupId = 'other';
    render(<GroupTabBar variant="titlebar" groupId="g" tabs={tabs} activeTabId="0" focused={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Host 0' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'ACTIVATE_GROUP', groupId: 'g' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'ACTIVATE_TAB', groupId: 'g', tabId: '0' });
  });

  it('writes both split sessions into the active segment and leaves the other tab alone', () => {
    groupFocus.activeGroupId = 'g';
    const local: TerminalTab = { id: 'local', name: 'Local', protocol: 'Local', connectionStatus: 'connected', reconnectCount: 0 };
    const peer: TerminalTab = { id: 'peer', name: 'Other', connectionStatus: 'connected', reconnectCount: 0 };
    const row = [tabs[0], local];
    const { container } = render(
      <GroupTabBar
        variant="titlebar"
        groupId="g"
        tabs={row}
        activeTabId="0"
        splitSessions={[
          { groupId: 'g', tab: tabs[0], tabs: row },
          { groupId: 'other', tab: peer, tabs: [peer] },
        ]}
      />,
    );
    const splitSegment = container.querySelector('[data-tab-id="0"]');
    const localSegment = container.querySelector('[data-tab-id="local"]');
    expect(splitSegment?.textContent).toContain('Host 0');
    expect(splitSegment?.textContent).toContain('Other');
    expect(splitSegment?.getAttribute('style')).toContain('flex-grow: 2');
    expect(localSegment?.textContent).toContain('Local');
    expect(localSegment?.textContent).not.toContain('Other');
    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'ACTIVATE_GROUP', groupId: 'other' });
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'ACTIVATE_TAB', groupId: 'g', tabId: '0' });
  });

  it('keeps an unfocused pane visible without the raised fill or a new-tab button', () => {
    const { container } = render(
      <GroupTabBar variant="titlebar" groupId="g" tabs={tabs} activeTabId="0" focused={false} showNewTab={false} />,
    );
    const visible = container.querySelector('[data-tab-id="0"]');
    const idle = container.querySelector('[data-tab-id="1"]');
    expect(visible?.className).toContain('font-medium');
    expect(visible?.className).toContain('text-foreground');
    expect(visible?.className).not.toContain('titlebar-tab-active');
    expect(idle?.className).toContain('titlebar-tab-idle');
    expect(screen.queryByRole('button', { name: 'New tab' })).toBeNull();
  });
});
