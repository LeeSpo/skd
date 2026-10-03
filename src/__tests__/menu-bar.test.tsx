import type React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WindowToolbar } from '@/components/window-toolbar';
import { TitlebarSlotProvider } from '@/lib/titlebar-slot-context';

afterEach(cleanup);

function renderToolbar(props: React.ComponentProps<typeof WindowToolbar> = {}) {
  return render(
    <TitlebarSlotProvider>
      <WindowToolbar {...props} />
    </TitlebarSlotProvider>,
  );
}

describe('WindowToolbar', () => {
  it('keeps common actions as direct toolbar buttons', () => {
    const actions = {
      onToggleLeftSidebar: vi.fn(), onToggleBottomPanel: vi.fn(), onToggleRightSidebar: vi.fn(),
      onToggleZenMode: vi.fn(), onOpenPortForward: vi.fn(), onOpenSettings: vi.fn(),
    };
    renderToolbar({ ...actions, portForwardEnabled: true });
    for (const name of ['Toggle Connection Manager', 'Toggle Bottom Panel', 'Toggle Monitor Panel', 'Toggle Zen Mode', 'Port Forwarding…', 'Options']) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    expect(screen.queryByRole('button', { name: 'More Actions' })).toBeNull();
    Object.values(actions).forEach(action => expect(action).toHaveBeenCalledOnce());
  });

  it('reflects panel state and leaves the visible sidebar toggle to the sidebar titlebar', () => {
    const { rerender } = renderToolbar({ leftSidebarVisible: true, bottomPanelVisible: false, zenMode: true });
    expect(screen.queryByRole('button', { name: 'Toggle Connection Manager' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Toggle Bottom Panel' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Toggle Zen Mode' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Options' })).toBeTruthy();
    rerender(
      <TitlebarSlotProvider>
        <WindowToolbar leftSidebarVisible={false} bottomPanelVisible />
      </TitlebarSlotProvider>,
    );
    expect(screen.getByRole('button', { name: 'Toggle Connection Manager' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Toggle Bottom Panel' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('preserves conditional controls and disables unavailable port forwarding', () => {
    const onOpenPortForward = vi.fn();
    renderToolbar({ showExtraPanelToggles: false, onOpenPortForward });
    expect(screen.queryByRole('button', { name: 'Toggle Bottom Panel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Toggle Monitor Panel' })).toBeNull();
    const portForward = screen.getByRole('button', { name: 'Port Forwarding…' });
    expect(portForward.hasAttribute('disabled')).toBe(true);
    fireEvent.click(portForward);
    expect(onOpenPortForward).not.toHaveBeenCalled();
  });

  it('shows the session title in the drag region and keeps controls from dragging the window', () => {
    renderToolbar({
      showSessionTitle: true,
      workspaceTitle: 'prod-api',
      workspaceSubtitle: 'root@db · SSH',
      leftSidebarVisible: false,
    });
    expect(screen.getByText('prod-api')).toBeTruthy();
    expect(screen.getByText('root@db · SSH')).toBeTruthy();
    const slot = document.getElementById('titlebar-tabs-slot');
    expect(slot?.getAttribute('data-tauri-drag-region')).not.toBe('false');
    expect(screen.getByRole('button', { name: 'Toggle Connection Manager' }).getAttribute('data-tauri-drag-region')).toBe('false');
    expect(screen.getByRole('button', { name: 'Options' }).getAttribute('data-tauri-drag-region')).toBe('false');
  });
});
