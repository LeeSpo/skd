import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '@/components/settings-modal';
import { defaultAppearanceSettings } from '@/lib/terminal-config';
import { DEFAULT_EDITOR_CONFIG } from '@/lib/editor-config';

function switchTab(name: string) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
  return tab;
}

async function chooseTheme(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('SettingsModal appearance', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = 'dark';
    document.documentElement.dataset.colorPalette = 'graphite';
    delete document.documentElement.dataset.nativeMaterial;
    delete document.documentElement.dataset.reduceTransparency;
    delete document.documentElement.dataset.increaseContrast;
    document.documentElement.removeAttribute('style');
    document.documentElement.dataset.themeMode = 'dark';
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

  afterEach(() => vi.unstubAllGlobals());

  it('exposes seven vertical categories with keyboard navigation and a stable dialog height', async () => {
    render(<SettingsModal open onOpenChange={vi.fn()} />);
    expect(screen.getAllByRole('tab')).toHaveLength(7);
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical');
    const appearanceTab = screen.getByRole('tab', { name: 'Appearance' });
    expect(appearanceTab.getAttribute('aria-selected')).toBe('true');
    appearanceTab.focus();
    fireEvent.keyDown(appearanceTab, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Terminal' })));
    expect(screen.getByRole('dialog').className).toContain('h-[85vh]');
    expect(screen.getByRole('button', { name: 'Save Settings' })).toBeTruthy();
  });

  it('previews and saves an interface palette without replacing the terminal theme', async () => {
    const onOpenChange = vi.fn();
    render(<SettingsModal open onOpenChange={onOpenChange} />);

    const appearanceTab = screen.getByRole('tab', { name: 'Appearance' });
    fireEvent.mouseDown(appearanceTab);
    fireEvent.click(appearanceTab);
    await waitFor(() => expect(appearanceTab.getAttribute('aria-selected')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: /Cupertino/ }));
    expect(document.documentElement.dataset.colorPalette).toBe('cupertino');

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(JSON.parse(localStorage.getItem('sshClientSettings') ?? '{}')).toMatchObject({
      theme: 'dark',
      colorPalette: 'cupertino',
    });
    expect(JSON.parse(localStorage.getItem('terminalAppearance') ?? '{}')).toMatchObject({
      theme: 'dracula',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('names terminal controls and supports changing a slider with the keyboard', () => {
    render(<SettingsModal open onOpenChange={vi.fn()} />);
    switchTab('Terminal');
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
    const appearanceTab = screen.getByRole('tab', { name: 'Appearance' });
    fireEvent.mouseDown(appearanceTab);
    fireEvent.click(appearanceTab);
    await waitFor(() => expect(appearanceTab.getAttribute('aria-selected')).toBe('true'));
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(JSON.parse(localStorage.getItem('sshClientSettings') ?? '{}').theme).toBe('dark');
  });

  it('restores the original palette when preview is cancelled', async () => {
    const onOpenChange = vi.fn();
    render(<SettingsModal open onOpenChange={onOpenChange} />);

    const appearanceTab = screen.getByRole('tab', { name: 'Appearance' });
    fireEvent.mouseDown(appearanceTab);
    fireEvent.click(appearanceTab);
    await waitFor(() => expect(appearanceTab.getAttribute('aria-selected')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: /Nordic/ }));
    expect(document.documentElement.dataset.colorPalette).toBe('nordic');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.documentElement.dataset.colorPalette).toBe('graphite');
    expect(JSON.parse(localStorage.getItem('sshClientSettings') ?? '{}')).toMatchObject({
      colorPalette: 'graphite',
    });
  });

  it('groups every color and background control in Appearance and keeps behavior in its original category', () => {
    render(<SettingsModal open onOpenChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Interface Colors' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Terminal Colors & Background' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Editor Colors' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Color Theme' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Theme' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Allow Transparency' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload Image' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Enable Notifications' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Font Family' })).toBeNull();

    switchTab('Terminal');
    expect(screen.queryByRole('combobox', { name: 'Color Theme' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Allow Transparency' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Terminal preview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Appearance settings' }));
    expect(screen.getByRole('tab', { name: 'Appearance' }).getAttribute('aria-selected')).toBe('true');

    switchTab('Editor');
    expect(screen.queryByRole('combobox', { name: 'Theme' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Word Wrap' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Appearance settings' }));
    expect(screen.getByRole('combobox', { name: 'Theme' })).toBeTruthy();

    switchTab('Advanced');
    expect(screen.getByRole('switch', { name: 'Enable Notifications' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Check for Updates' })).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Notifications' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
    expect(JSON.parse(localStorage.getItem('sshClientSettings')!).enableNotifications).toBe(false);
  });

  it('retains drafts across categories and saves independent terminal and editor themes', async () => {
    render(<SettingsModal open onOpenChange={vi.fn()} />);
    await chooseTheme('Color Theme', 'Nord');
    await chooseTheme('Theme', 'Light');
    fireEvent.click(screen.getByRole('button', { name: /Midnight/ }));
    switchTab('Terminal');
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Font Size: 14px' }), { key: 'ArrowRight' });
    switchTab('Editor');
    fireEvent.click(screen.getByRole('switch', { name: 'Word Wrap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to Appearance settings' }));
    expect(screen.getByRole('combobox', { name: 'Color Theme' }).textContent).toBe('Nord');
    expect(screen.getByRole('combobox', { name: 'Theme' }).textContent).toBe('Light');
    expect(screen.getByRole('img', { name: 'Terminal preview' }).style.fontSize).toBe('15px');
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
    expect(JSON.parse(localStorage.getItem('terminalAppearance')!)).toMatchObject({ theme: 'nord', fontSize: 15 });
    expect(JSON.parse(localStorage.getItem('skd-editor-config')!)).toMatchObject({ theme: 'light', wordWrap: false });
    expect(JSON.parse(localStorage.getItem('sshClientSettings')!)).toMatchObject({ colorPalette: 'midnight' });
  });

  it('keeps the last category on reopen and discards cancelled drafts even without saved app settings', async () => {
    localStorage.clear();
    const onOpenChange = vi.fn();
    const { rerender } = render(<SettingsModal open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    await chooseTheme('Theme', 'Light');
    switchTab('Advanced');
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Notifications' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    rerender(<SettingsModal open={false} onOpenChange={onOpenChange} />);
    rerender(<SettingsModal open onOpenChange={onOpenChange} />);
    expect(screen.getByRole('tab', { name: 'Advanced' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Enable Notifications' }).getAttribute('aria-checked')).toBe('true');
    switchTab('Appearance');
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('combobox', { name: 'Theme' }).textContent).toBe('One Dark');
    expect(localStorage.getItem('sshClientSettings')).toBeNull();
    expect(localStorage.getItem('skd-editor-config')).toBeNull();
  });

  it('previews the resolved light and palette-aware backgrounds and responds to system appearance changes', async () => {
    localStorage.setItem('terminalAppearance', JSON.stringify(defaultAppearanceSettings));
    document.documentElement.style.setProperty('--terminal-bg', '#050b16');
    render(<SettingsModal open onOpenChange={vi.fn()} />);
    const preview = screen.getByRole('img', { name: 'Terminal preview' });
    expect(preview.style.backgroundColor).toBe('rgb(5, 11, 22)');
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(preview.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(preview.style.color).toBe('rgb(30, 30, 30)');
    expect(within(preview).getByText('drwxr-xr-x').style.color).toBe('rgb(4, 81, 165)');
    fireEvent.click(screen.getByRole('radio', { name: 'Auto (System)' }));
    expect(preview.style.backgroundColor).toBe('rgb(5, 11, 22)');
    await act(async () => { document.documentElement.classList.remove('dark'); });
    await waitFor(() => expect(preview.style.backgroundColor).toBe('rgb(255, 255, 255)'));
    await act(async () => { document.documentElement.classList.add('dark'); });
    await waitFor(() => expect(preview.style.backgroundColor).toBe('rgb(5, 11, 22)'));
  });

  it('keeps an explicitly chosen terminal theme when the interface appearance changes', () => {
    render(<SettingsModal open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    const preview = screen.getByRole('img', { name: 'Terminal preview' });
    expect(preview.style.backgroundColor).toBe('rgb(40, 42, 54)');
    expect(preview.style.color).toBe('rgb(248, 248, 242)');
    fireEvent.click(screen.getByRole('button', { name: /Nordic/ }));
    expect(screen.getByRole('combobox', { name: 'Color Theme' }).textContent).toBe('Dracula');
    expect(screen.getByRole('combobox', { name: 'Theme' }).textContent).toBe('One Dark');
  });

  it.each(['reduceTransparency', 'increaseContrast'])('blocks transparency under %s without discarding the saved preference', (setting) => {
    document.documentElement.dataset[setting] = 'true';
    localStorage.setItem('terminalAppearance', JSON.stringify({ ...defaultAppearanceSettings, allowTransparency: true }));
    render(<SettingsModal open onOpenChange={vi.fn()} />);
    const toggle = screen.getByRole('switch', { name: 'Allow Transparency' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('slider', { name: /^Opacity:/ })).toBeNull();
    expect(screen.getByText(/Turn off Reduce Transparency/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
    expect(JSON.parse(localStorage.getItem('terminalAppearance')!).allowTransparency).toBe(true);
  });

  it('shows image adjustments after upload and removes them when the image is removed', async () => {
    render(<SettingsModal open onOpenChange={vi.fn()} />);
    expect(screen.queryByRole('slider', { name: /^Image Opacity:/ })).toBeNull();
    const upload = document.getElementById('background-image-upload')!;
    fireEvent.change(upload, { target: { files: [new File(['image'], 'background.png', { type: 'image/png' })] } });
    expect(await screen.findByRole('slider', { name: 'Image Opacity: 30%' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Image Blur: 0px' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Image Position' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Background image preview' })).toBeTruthy();
    switchTab('Terminal');
    switchTab('Appearance');
    expect(screen.getByRole('button', { name: 'Change Image' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('slider', { name: /^Image Opacity:/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload Image' })).toBeTruthy();
  });

  it('resets all three appearance groups as a draft and restores the saved appearance on cancel', () => {
    localStorage.setItem('skd-editor-config', JSON.stringify({ ...DEFAULT_EDITOR_CONFIG, theme: 'light' }));
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    render(<SettingsModal open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Defaults' }));
    expect(screen.getByRole('button', { name: /^System/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('combobox', { name: 'Color Theme' }).textContent).toBe('VS Code Dark');
    expect(screen.getByRole('combobox', { name: 'Theme' }).textContent).toBe('One Dark');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.documentElement.dataset.colorPalette).toBe('graphite');
    expect(JSON.parse(localStorage.getItem('terminalAppearance')!).theme).toBe('dracula');
    expect(JSON.parse(localStorage.getItem('skd-editor-config')!).theme).toBe('light');
  });


  it('updates the preview when native material availability changes', async () => {
    document.documentElement.dataset.nativeMaterial = 'true';
    localStorage.setItem('terminalAppearance', JSON.stringify({ ...defaultAppearanceSettings, theme: 'dracula', allowTransparency: true, opacity: 75 }));
    render(<SettingsModal open onOpenChange={vi.fn()} />);
    const preview = screen.getByRole('img', { name: 'Terminal preview' });
    expect(preview.style.backgroundColor).toContain('color-mix');
    expect(preview.style.backgroundColor).toContain('75%');
    await act(async () => { document.documentElement.dataset.nativeMaterial = 'false'; });
    expect(preview.style.backgroundColor).toBe('rgb(40, 42, 54)');
    await act(async () => { document.documentElement.dataset.nativeMaterial = 'true'; });
    expect(preview.style.backgroundColor).toContain('color-mix');
    await act(async () => { document.documentElement.dataset.increaseContrast = 'true'; });
    expect(preview.style.backgroundColor).toBe('rgb(40, 42, 54)');
  });

  it('preserves an unsaved appearance draft while checking for updates and restores it on later cancel', () => {
    const onOpenChange = vi.fn();
    const onCheckForUpdates = vi.fn();
    const { rerender } = render(<SettingsModal open onOpenChange={onOpenChange} onCheckForUpdates={onCheckForUpdates} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    fireEvent.click(screen.getByRole('button', { name: /Nordic/ }));
    switchTab('Advanced');
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Notifications' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check Now' }));
    expect(onCheckForUpdates).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(<SettingsModal open={false} onOpenChange={onOpenChange} onCheckForUpdates={onCheckForUpdates} />);
    rerender(<SettingsModal open onOpenChange={onOpenChange} onCheckForUpdates={onCheckForUpdates} />);
    expect(screen.getByRole('switch', { name: 'Enable Notifications' }).getAttribute('aria-checked')).toBe('false');
    switchTab('Appearance');
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: /Nordic/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.colorPalette).toBe('graphite');
    expect(JSON.parse(localStorage.getItem('sshClientSettings')!)).toMatchObject({ theme: 'dark', colorPalette: 'graphite' });
  });

});
