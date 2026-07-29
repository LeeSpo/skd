import type { Terminal } from '@xterm/xterm';

type SelectableTerminal = Pick<Terminal, 'buffer' | 'clearSelection' | 'selectLines'>;

/**
 * Select the meaningful contents of the active terminal buffer without
 * including the empty rows xterm keeps around to fill the viewport.
 */
export function selectTerminalContent(term: SelectableTerminal): void {
  const buffer = term.buffer.active;
  let firstContentRow = -1;
  let lastContentRow = -1;

  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row);
    if (!line || line.translateToString(true).length === 0) {
      continue;
    }

    if (firstContentRow === -1) {
      firstContentRow = row;
    }
    lastContentRow = row;
  }

  if (firstContentRow === -1) {
    term.clearSelection();
    return;
  }

  term.selectLines(firstContentRow, lastContentRow);
}
