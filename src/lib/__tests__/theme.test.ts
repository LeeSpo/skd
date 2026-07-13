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

  it('defaults missing and invalid saved values to Graphite', () => {
    expect(getSavedColorPalette()).toBe(DEFAULT_COLOR_PALETTE);
    expect(normalizeColorPalette('unknown')).toBe('graphite');

    localStorage.setItem('sshClientSettings', JSON.stringify({ colorPalette: 'unknown' }));
    expect(getSavedColorPalette()).toBe('graphite');
  });

  it('applies palette and theme state to the root element', () => {
    applyTheme('dark', 'midnight');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.colorPalette).toBe('midnight');

    applyTheme('light', 'nordic');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.dataset.colorPalette).toBe('nordic');
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
      graphite: 'one-dark',
      midnight: 'tokyo-night',
      nordic: 'nord',
    });
  });
});
