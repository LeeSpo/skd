import { describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { selectTerminalContent, shouldSuppressSelectionClearingMouseMove } from '../terminal-selection';

function createTerminal(lines: string[]) {
  const selectLines = vi.fn();
  const clearSelection = vi.fn();
  const term = {
    buffer: {
      active: {
        length: lines.length,
        getLine: (row: number) => ({
          translateToString: () => lines[row]?.trimEnd() ?? '',
        }),
      },
    },
    selectLines,
    clearSelection,
  } as unknown as Pick<Terminal, 'buffer' | 'clearSelection' | 'selectLines'>;

  return { term, selectLines, clearSelection };
}

describe('selectTerminalContent', () => {
  it('excludes empty viewport rows after the terminal content', () => {
    const { term, selectLines } = createTerminal([
      '$ pwd',
      '/Users/example',
      '$ npm test',
      '',
      '',
    ]);

    selectTerminalContent(term);

    expect(selectLines).toHaveBeenCalledWith(0, 2);
  });

  it('keeps meaningful blank lines between output lines', () => {
    const { term, selectLines } = createTerminal([
      '',
      '$ printf output',
      '',
      'output',
      '',
    ]);

    selectTerminalContent(term);

    expect(selectLines).toHaveBeenCalledWith(1, 3);
  });

  it('clears the selection when the buffer contains no content', () => {
    const { term, selectLines, clearSelection } = createTerminal(['', '   ', '']);

    selectTerminalContent(term);

    expect(clearSelection).toHaveBeenCalledOnce();
    expect(selectLines).not.toHaveBeenCalled();
  });
});

describe('shouldSuppressSelectionClearingMouseMove', () => {
  it('lets a drag update the selection', () => {
    expect(shouldSuppressSelectionClearingMouseMove({ buttons: 1, altKey: true }, true)).toBe(false);
  });

  it('swallows the buttonless move that follows an Option-drag', () => {
    expect(shouldSuppressSelectionClearingMouseMove({ buttons: 0, altKey: true }, true)).toBe(true);
    expect(shouldSuppressSelectionClearingMouseMove({ buttons: 0, altKey: false }, true)).toBe(true);
  });

  it('still reports hover moves when nothing is selected and Option is up', () => {
    expect(shouldSuppressSelectionClearingMouseMove({ buttons: 0, altKey: false }, false)).toBe(false);
  });
});
