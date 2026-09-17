import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroupTabBar } from '@/components/terminal/group-tab-bar';
import type { TerminalTab } from '@/lib/terminal-group-types';

const { dispatch, close } = vi.hoisted(() => ({ dispatch: vi.fn(), close: vi.fn() }));
vi.mock('@/lib/terminal-group-context', () => ({ useTerminalGroups: () => ({ dispatch }) }));
vi.mock('@/lib/terminal-callbacks-context', () => ({ useTerminalCallbacks: () => ({ onRequestCloseTabs: close }) }));
vi.mock('@/components/terminal/new-tab-menu', () => ({ NewTabMenu: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const tabs: TerminalTab[] = ['connected', 'connecting', 'disconnected', 'pending'].map((status, i) => ({
  id: String(i), name: `Host ${i}`, connectionStatus: status as TerminalTab['connectionStatus'], reconnectCount: 0,
}));

describe('GroupTabBar visual pilot', () => {
  it('keeps abnormal states visible without a green dot on healthy tabs', () => {
    const { container } = render(<GroupTabBar groupId="g" tabs={tabs} activeTabId="0" />);
    expect(container.querySelector('[data-variant="connected"]')).toBeNull();
    for (const status of ['connecting', 'disconnected', 'pending']) {
      expect(container.querySelector(`[data-variant="${status}"]`)?.getAttribute('aria-label')).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Host 0' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('activates via the native button and closes without activating the tab', () => {
    render(<GroupTabBar groupId="g" tabs={tabs} activeTabId="0" />);
    fireEvent.click(screen.getByRole('button', { name: 'Host 0' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'ACTIVATE_TAB', groupId: 'g', tabId: '0' });
    dispatch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Close Host 1' }));
    expect(close).toHaveBeenCalledWith([{ groupId: 'g', tabId: '1' }]);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
