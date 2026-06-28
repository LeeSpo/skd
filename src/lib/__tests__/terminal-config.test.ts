import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultAppearanceSettings,
  defaultTerminalOptions,
  getTerminalOptions,
  isLegacyLatinOnlyFontFamily,
  LEGACY_LATIN_ONLY_TERMINAL_FONT,
  loadAppearanceSettings,
  MACOS_MULTILINGUAL_TERMINAL_FONT,
  migrateAppearanceSettings,
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