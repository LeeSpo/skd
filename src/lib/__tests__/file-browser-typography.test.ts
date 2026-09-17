import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FILE_BROWSER_CHROME_TEXT,
  FILE_BROWSER_LIST_ICONS,
  FILE_BROWSER_LIST_TEXT,
} from '../file-browser-typography';

describe('file-browser-typography', () => {
  it('uses 13px list text with an 18px line height while keeping chrome secondary', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');
    expect(css).toContain('--file-list-font-size: 0.8125rem;');
    expect(css).toContain('--file-list-line-height: 1.125rem;');
    expect(css).toContain('--file-chrome-font-size: 0.75rem;');
  });
  it('exports stable shared class names', () => {
    expect(FILE_BROWSER_CHROME_TEXT).toBe('file-chrome-text');
    expect(FILE_BROWSER_LIST_TEXT).toBe('file-list-text');
    expect(FILE_BROWSER_LIST_ICONS).toContain('[&_svg]');
  });
});