import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EDITOR_CONFIG,
  DEFAULT_EDITOR_FONT,
  isBracketMatchingEnabled,
  loadEditorConfig,
  normalizeEditorFont,
} from '../editor-config';

describe('editor config', () => {
  it('defaults to an installed monospace stack', () => {
    expect(DEFAULT_EDITOR_CONFIG.fontFamily).toBe(DEFAULT_EDITOR_FONT);
    expect(DEFAULT_EDITOR_FONT).toBe('Menlo, Monaco, monospace');
  });

  it('follows only the bracket-matching switch', () => {
    expect(isBracketMatchingEnabled({ bracketMatching: false })).toBe(false);
    expect(isBracketMatchingEnabled({ bracketMatching: true })).toBe(true);
  });

  it('replaces an uninstalled saved font', () => {
    localStorage.setItem('skd-editor-config', JSON.stringify({
      ...DEFAULT_EDITOR_CONFIG,
      fontFamily: "'JetBrains Mono', monospace",
      bracketMatching: false,
    }));

    expect(normalizeEditorFont("'JetBrains Mono', monospace")).toBe(DEFAULT_EDITOR_FONT);
    expect(loadEditorConfig()).toMatchObject({
      fontFamily: DEFAULT_EDITOR_FONT,
      bracketMatching: false,
    });
    localStorage.removeItem('skd-editor-config');
  });
});
