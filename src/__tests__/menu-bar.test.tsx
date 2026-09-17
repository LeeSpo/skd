import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuBar } from '@/components/menu-bar';

afterEach(cleanup);

describe('MenuBar', () => {
  it('retains every action and gives icon buttons accessible names', () => {
    const actions = {
      onToggleLeftSidebar: vi.fn(),
      onToggleBottomPanel: vi.fn(),
      onToggleRightSidebar: vi.fn(),
      onToggleZenMode: vi.fn(),
      onOpenPortForward: vi.fn(),
      onOpenSettings: vi.fn(),
    };
    render(<MenuBar {...actions} portForwardEnabled />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(7);
    buttons.forEach(button => expect(button.getAttribute('aria-label')).toBeTruthy());

    const names = [
      'Toggle Connection Manager', 'Toggle Bottom Panel', 'Toggle Monitor Panel',
      'Toggle Zen Mode', 'Port Forwarding…', 'Options',
    ];
    names.forEach(name => fireEvent.click(screen.getByRole('button', { name })));
    Object.values(actions).forEach(action => expect(action).toHaveBeenCalledOnce());
  });

  it('reflects panel state without changing toggle names', () => {
    const { rerender } = render(<MenuBar leftSidebarVisible bottomPanelVisible={false} zenMode />);
    expect(screen.getByRole('button', { name: 'Toggle Connection Manager' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Toggle Bottom Panel' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Toggle Zen Mode' }).getAttribute('aria-pressed')).toBe('true');
    rerender(<MenuBar leftSidebarVisible={false} bottomPanelVisible />);
    expect(screen.getByRole('button', { name: 'Toggle Connection Manager' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Toggle Bottom Panel' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('preserves conditional panel controls and disabled port forwarding', () => {
    const onOpenPortForward = vi.fn();
    render(<MenuBar showExtraPanelToggles={false} onOpenPortForward={onOpenPortForward} />);
    expect(screen.queryByRole('button', { name: 'Toggle Bottom Panel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Toggle Monitor Panel' })).toBeNull();
    const portForward = screen.getByRole('button', { name: 'Port Forwarding…' });
    expect((portForward as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(portForward);
    expect(onOpenPortForward).not.toHaveBeenCalled();
  });

  it('keeps layout presets reachable by keyboard', () => {
    const onApplyPreset = vi.fn();
    render(<MenuBar onApplyPreset={onApplyPreset} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Layout Presets' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Minimal – Terminal Only' }));
    expect(onApplyPreset).toHaveBeenCalledWith('Minimal');
  });
});
