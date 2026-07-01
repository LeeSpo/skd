import { describe, expect, it } from 'vitest';
import {
  FILE_BROWSER_CHROME_TEXT,
  FILE_BROWSER_LIST_ICONS,
  FILE_BROWSER_LIST_TEXT,
} from '../file-browser-typography';

describe('file-browser-typography', () => {
  it('exports stable shared class names', () => {
    expect(FILE_BROWSER_CHROME_TEXT).toBe('file-chrome-text');
    expect(FILE_BROWSER_LIST_TEXT).toBe('file-list-text');
    expect(FILE_BROWSER_LIST_ICONS).toContain('[&_svg]');
  });
});