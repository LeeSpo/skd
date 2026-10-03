import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuBar } from '@/components/menu-bar';

afterEach(cleanup);

function openMoreActions() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'More Actions' }), { key: 'Enter' });
}

describe('MenuBar', () => {
  it('keeps panel toggles direct and moves infrequent actions into the keyboard-accessible menu', () => {
    const actions = {
      onToggleLeftSidebar: vi.fn(), onToggleBottomPanel: vi.fn(), onToggleRightSidebar: vi.fn(),
      onToggleZenMode: vi.fn(), onOpenPortForward: vi.fn(), onOpenSettings: vi.fn(),
    };
    render(<MenuBar {...actions} portForwardEnabled />);
    for (const name of ['Toggle Connection Manager', 'Toggle Bottom Panel', 'Toggle Monitor Panel']) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    openMoreActions();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Toggle Zen Mode' }));
    openMoreActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Port Forwarding…' }));
    openMoreActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Options' }));
    Object.values(actions).forEach(action => expect(action).toHaveBeenCalledOnce());
  });

  it('reflects panel state and leaves the visible sidebar toggle to the sidebar titlebar', () => {
    const { rerender } = render(<MenuBar leftSidebarVisible bottomPanelVisible={false} zenMode />);
    expect(screen.queryByRole('button', { name: 'Toggle Connection Manager' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Toggle Bottom Panel' }).getAttribute('aria-pressed')).toBe('false');
    openMoreActions();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Toggle Zen Mode' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    rerender(<MenuBar leftSidebarVisible={false} bottomPanelVisible />);
    expect(screen.getByRole('button', { name: 'Toggle Connection Manager' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Toggle Bottom Panel' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('preserves conditional controls and disables unavailable port forwarding', () => {
    const onOpenPortForward = vi.fn();
    render(<MenuBar showExtraPanelToggles={false} onOpenPortForward={onOpenPortForward} />);
    expect(screen.queryByRole('button', { name: 'Toggle Bottom Panel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Toggle Monitor Panel' })).toBeNull();
    openMoreActions();
    const portForward = screen.getByRole('menuitem', { name: 'Port Forwarding…' });
    expect(portForward.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(portForward);
    expect(onOpenPortForward).not.toHaveBeenCalled();
  });

  it('keeps layout presets reachable through the menu with the keyboard', async () => {
    const onApplyPreset = vi.fn();
    render(<MenuBar onApplyPreset={onApplyPreset} />);
    openMoreActions();
    const layouts = screen.getByRole('menuitem', { name: 'Layout Presets' });
    layouts.focus();
    fireEvent.keyDown(layouts, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Minimal – Terminal Only' }));
    expect(onApplyPreset).toHaveBeenCalledWith('Minimal');
  });
});
