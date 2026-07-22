import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultAppearanceSettings,
  defaultTerminalTheme,
  defaultTerminalOptions,
  getThemeAwareTerminalTheme,
  getTerminalOptions,
  isLegacyLatinOnlyFontFamily,
  LEGACY_LATIN_ONLY_TERMINAL_FONT,
  loadAppearanceSettings,
  MACOS_MULTILINGUAL_TERMINAL_FONT,
  migrateAppearanceSettings,
  terminalThemes,
} from '../terminal-config';

describe('terminal multilingual font configuration', () => {
  beforeEach(() => {
    localStorage.removeItem('terminalAppearance');
  });

  afterEach(() => {
    localStorage.removeItem('terminalAppearance');
  });

  it('defaults to the macOS multilingual font stack', () => {
    expect(defaultAppearanceSettings.fontFamily).toBe(MACOS_MULTILINGUAL_TERMINAL_FONT);
    expect(defaultAppearanceSettings.useWebglRenderer).toBe(false);
    expect(defaultTerminalOptions.rescaleOverlappingGlyphs).toBe(true);
    expect(defaultTerminalOptions.fontFamily).toBe(MACOS_MULTILINGUAL_TERMINAL_FONT);
  });

  it('includes CJK and emoji fallbacks in the multilingual stack', () => {
    expect(MACOS_MULTILINGUAL_TERMINAL_FONT).toContain('Hiragino Kaku Gothic ProN');
    expect(MACOS_MULTILINGUAL_TERMINAL_FONT).toContain('PingFang SC');
    expect(MACOS_MULTILINGUAL_TERMINAL_FONT).toContain('Apple Color Emoji');
  });

  it('detects legacy Latin-only font stacks', () => {
    expect(isLegacyLatinOnlyFontFamily(LEGACY_LATIN_ONLY_TERMINAL_FONT)).toBe(true);
    expect(isLegacyLatinOnlyFontFamily("Menlo, Monaco, 'Courier New', monospace")).toBe(true);
    expect(isLegacyLatinOnlyFontFamily(MACOS_MULTILINGUAL_TERMINAL_FONT)).toBe(false);
  });

  it('migrates saved Latin-only font settings to the multilingual stack', () => {
    localStorage.setItem(
      'terminalAppearance',
      JSON.stringify({
        ...defaultAppearanceSettings,
        fontFamily: LEGACY_LATIN_ONLY_TERMINAL_FONT,
      }),
    );

    const loaded = loadAppearanceSettings();
    expect(loaded.fontFamily).toBe(MACOS_MULTILINGUAL_TERMINAL_FONT);
    expect(getTerminalOptions(loaded).fontFamily).toBe(MACOS_MULTILINGUAL_TERMINAL_FONT);
  });

  it('defaults useWebglRenderer when missing from saved settings', () => {
    const { useWebglRenderer: _removed, ...withoutWebgl } = defaultAppearanceSettings;
    localStorage.setItem('terminalAppearance', JSON.stringify(withoutWebgl));

    expect(loadAppearanceSettings().useWebglRenderer).toBe(false);
  });

  it('preserves explicit non-legacy font choices', () => {
    const customFont = "'JetBrains Mono', monospace";
    localStorage.setItem(
      'terminalAppearance',
      JSON.stringify({
        ...defaultAppearanceSettings,
        fontFamily: customFont,
      }),
    );

    expect(loadAppearanceSettings().fontFamily).toBe(customFont);
  });

  it('migrateAppearanceSettings upgrades legacy fonts only', () => {
    const migrated = migrateAppearanceSettings({
      ...defaultAppearanceSettings,
      fontFamily: LEGACY_LATIN_ONLY_TERMINAL_FONT,
      useWebglRenderer: true,
    });

    expect(migrated.fontFamily).toBe(MACOS_MULTILINGUAL_TERMINAL_FONT);
    expect(migrated.useWebglRenderer).toBe(true);
  });
});

describe('palette-aware terminal backgrounds', () => {
  beforeEach(() => {
    document.documentElement.className = 'dark';
    document.documentElement.dataset.colorPalette = 'midnight';
    document.documentElement.style.setProperty('--terminal-bg', '#050b16');
  });

  afterEach(() => {
    document.documentElement.className = '';
    delete document.documentElement.dataset.colorPalette;
    document.documentElement.style.removeProperty('--terminal-bg');
  });

  it('harmonizes the default theme background without changing ANSI colours', () => {
    const theme = getThemeAwareTerminalTheme({
      ...defaultAppearanceSettings,
      theme: 'vs-code-dark',
    });

    expect(theme.background).toBe('#050b16');
    expect(theme.foreground).toBe(defaultTerminalTheme.foreground);
    expect(theme.red).toBe(defaultTerminalTheme.red);
  });

  it('harmonizes the palette-recommended theme background only', () => {
    const theme = getThemeAwareTerminalTheme({
      ...defaultAppearanceSettings,
      theme: 'tokyo-night',
    });

    expect(theme.background).toBe('#050b16');
    expect(theme.blue).toBe(terminalThemes['tokyo-night'].blue);
  });

  it('preserves a custom terminal theme background', () => {
    const theme = getThemeAwareTerminalTheme({
      ...defaultAppearanceSettings,
      theme: 'dracula',
    });

    expect(theme.background).toBe(terminalThemes.dracula.background);
  });

  it('keeps the existing light-mode fallback', () => {
    document.documentElement.className = '';
    const theme = getThemeAwareTerminalTheme({
      ...defaultAppearanceSettings,
      theme: 'vs-code-dark',
    });

    expect(theme.background).toBe(terminalThemes['vs-code-light'].background);
  });
});
