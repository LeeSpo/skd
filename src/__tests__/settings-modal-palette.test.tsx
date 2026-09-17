import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '@/components/settings-modal';
import { defaultAppearanceSettings } from '@/lib/terminal-config';

describe('SettingsModal workspace palettes', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = 'dark';
    document.documentElement.dataset.colorPalette = 'graphite';
    localStorage.setItem(
      'sshClientSettings',
      JSON.stringify({ theme: 'dark', colorPalette: 'graphite' }),
    );
    localStorage.setItem(
      'terminalAppearance',
      JSON.stringify({ ...defaultAppearanceSettings, theme: 'dracula' }),
    );
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal('ResizeObserver', class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  it('exposes seven vertical categories with keyboard navigation and a stable dialog height', async () => {
    render(<SettingsModal open onOpenChange={vi.fn()} />);
    expect(screen.getAllByRole('tab')).toHaveLength(7);
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical');
    const terminalTab = screen.getByRole('tab', { name: 'Terminal' });
    terminalTab.focus();
    fireEvent.keyDown(terminalTab, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Editor' })));
    expect(screen.getByRole('dialog').className).toContain('h-[85vh]');
    expect(screen.getByRole('button', { name: 'Save Settings' })).toBeTruthy();
  });

  it('previews and saves a palette with its suggested terminal theme', async () => {
    const onOpenChange = vi.fn();
    render(<SettingsModal open onOpenChange={onOpenChange} />);

    const interfaceTab = screen.getByRole('tab', { name: 'Interface' });
    fireEvent.mouseDown(interfaceTab);
    fireEvent.click(interfaceTab);
    await waitFor(() => expect(interfaceTab.getAttribute('aria-selected')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: /Midnight/ }));
    expect(document.documentElement.dataset.colorPalette).toBe('midnight');

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(JSON.parse(localStorage.getItem('sshClientSettings') ?? '{}')).toMatchObject({
      theme: 'dark',
      colorPalette: 'midnight',
    });
    expect(JSON.parse(localStorage.getItem('terminalAppearance') ?? '{}')).toMatchObject({
      theme: 'tokyo-night',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('restores the original palette when preview is cancelled', async () => {
    const onOpenChange = vi.fn();
    render(<SettingsModal open onOpenChange={onOpenChange} />);

    const interfaceTab = screen.getByRole('tab', { name: 'Interface' });
    fireEvent.mouseDown(interfaceTab);
    fireEvent.click(interfaceTab);
    await waitFor(() => expect(interfaceTab.getAttribute('aria-selected')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: /Nordic/ }));
    expect(document.documentElement.dataset.colorPalette).toBe('nordic');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.documentElement.dataset.colorPalette).toBe('graphite');
    expect(JSON.parse(localStorage.getItem('sshClientSettings') ?? '{}')).toMatchObject({
      colorPalette: 'graphite',
    });
  });
});
