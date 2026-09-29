import type { Terminal } from '@xterm/xterm';

type SelectableTerminal = Pick<Terminal, 'buffer' | 'clearSelection' | 'selectLines'>;

/**
 * DECSET 1003 reports every buttonless move. With SGR encoding, xterm treats
 * that report as user input and clears the selection, so an Option-drag
 * disappears as soon as the button comes up. Keep the selection until a real
 * click or keypress.
 */
export function shouldSuppressSelectionClearingMouseMove(
  event: { buttons: number; altKey: boolean },
  hasSelection: boolean,
): boolean {
  if (event.buttons !== 0) return false;
  return event.altKey || hasSelection;
}

export function bindTerminalSelectionMouseGuard(
  element: HTMLElement,
  hasSelection: () => boolean,
): () => void {
  const onMouseMove = (event: MouseEvent) => {
    if (!shouldSuppressSelectionClearingMouseMove(event, hasSelection())) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  element.addEventListener('mousemove', onMouseMove, true);
  return () => element.removeEventListener('mousemove', onMouseMove, true);
}

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
