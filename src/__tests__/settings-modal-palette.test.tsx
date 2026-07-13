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
