import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyColorPalette,
  applyTheme,
  DEFAULT_COLOR_PALETTE,
  getSavedColorPalette,
  initializeTheme,
  normalizeColorPalette,
  PALETTE_TERMINAL_THEMES,
} from '../utils';

describe('workspace color palettes', () => {
  const changeListeners: Array<(event: MediaQueryListEvent) => void> = [];

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    delete document.documentElement.dataset.colorPalette;
    delete document.documentElement.dataset.themeMode;
    changeListeners.length = 0;
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
        changeListeners.push(listener);
      },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults missing and invalid saved values to System', () => {
    expect(getSavedColorPalette()).toBe(DEFAULT_COLOR_PALETTE);
    expect(normalizeColorPalette('unknown')).toBe('system');
    expect(normalizeColorPalette('cupertino')).toBe('cupertino');

    localStorage.setItem('sshClientSettings', JSON.stringify({ colorPalette: 'unknown' }));
    expect(getSavedColorPalette()).toBe('system');
  });

  it('applies palette and theme state to the root element', () => {
    applyTheme('dark', 'midnight');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.colorPalette).toBe('midnight');

    applyTheme('light', 'cupertino');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.dataset.colorPalette).toBe('cupertino');
  });

  it('restores saved palette before rendering and follows system mode changes', () => {
    localStorage.setItem(
      'sshClientSettings',
      JSON.stringify({ theme: 'auto', colorPalette: 'nordic' }),
    );

    initializeTheme();
    expect(document.documentElement.dataset.colorPalette).toBe('nordic');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    changeListeners[0]?.({ matches: true } as MediaQueryListEvent);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('keeps palette application independent and defines terminal matches', () => {
    applyColorPalette('graphite');
    expect(document.documentElement.dataset.colorPalette).toBe('graphite');
    expect(PALETTE_TERMINAL_THEMES).toEqual({
      system: 'vs-code-dark',
      graphite: 'one-dark',
      midnight: 'tokyo-night',
      nordic: 'nord',
      cupertino: 'vs-code-dark',
    });
  });

  it('follows the previewed appearance mode without overwriting the saved mode', () => {
    localStorage.setItem('sshClientSettings', JSON.stringify({ theme: 'dark' }));
    initializeTheme();
    applyTheme('auto');
    changeListeners[0]?.({ matches: true } as MediaQueryListEvent);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    changeListeners[0]?.({ matches: false } as MediaQueryListEvent);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    applyTheme('dark');
    changeListeners[0]?.({ matches: false } as MediaQueryListEvent);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(JSON.parse(localStorage.getItem('sshClientSettings')!)).toEqual({ theme: 'dark' });
  });
});
