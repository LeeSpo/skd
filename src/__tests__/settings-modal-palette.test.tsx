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
    HTMLElement.prototype.scrollIntoView = vi.fn();
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
    fireEvent.click(screen.getByRole('button', { name: /Cupertino/ }));
    expect(document.documentElement.dataset.colorPalette).toBe('cupertino');

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(JSON.parse(localStorage.getItem('sshClientSettings') ?? '{}')).toMatchObject({
      theme: 'dark',
      colorPalette: 'cupertino',
    });
    expect(JSON.parse(localStorage.getItem('terminalAppearance') ?? '{}')).toMatchObject({
      theme: 'vs-code-dark',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('names terminal controls and supports changing a slider with the keyboard', () => {
    render(<SettingsModal open onOpenChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Font Family' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Cursor Blink' })).toBeTruthy();
    const slider = screen.getByRole('slider', { name: 'Font Size: 14px' });
    slider.focus();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(screen.getByRole('slider', { name: 'Font Size: 15px' }).getAttribute('aria-valuenow')).toBe('15');
  });

  it('restores the saved appearance mode as well as the palette after cancelling a preview', async () => {
    const onOpenChange = vi.fn();
    render(<SettingsModal open onOpenChange={onOpenChange} />);
    const interfaceTab = screen.getByRole('tab', { name: 'Interface' });
    fireEvent.mouseDown(interfaceTab);
    fireEvent.click(interfaceTab);
    await waitFor(() => expect(interfaceTab.getAttribute('aria-selected')).toBe('true'));
    fireEvent.click(screen.getByRole('combobox', { name: 'Application Theme' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Light', exact: true }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(JSON.parse(localStorage.getItem('sshClientSettings') ?? '{}').theme).toBe('dark');
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
