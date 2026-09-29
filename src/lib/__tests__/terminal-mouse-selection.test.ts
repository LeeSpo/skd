import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindTerminalSelectionMouseGuard } from '../terminal-selection';

beforeEach(() => {
  const realGetComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((element: Element) => {
    const style = realGetComputedStyle(element);
    return new Proxy(style, {
      get(target, prop, receiver) {
        if (prop === 'getPropertyValue') {
          return (name: string) => {
            if (name === 'padding-left' || name === 'padding-top') return '0';
            return target.getPropertyValue(name);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }) as typeof window.getComputedStyle;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

async function loadTerminal() {
  vi.resetModules();
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: 'MacIntel',
  });
  // xterm treats a runtime with process.title as Node and disables macOS selection.
  const descriptor = Object.getOwnPropertyDescriptor(process, 'title');
  if (descriptor) delete (process as { title?: string }).title;
  try {
    const mod = await import('@xterm/xterm');
    return mod.Terminal;
  } finally {
    if (descriptor) Object.defineProperty(process, 'title', descriptor);
  }
}

function installGeometry(term: import('@xterm/xterm').Terminal) {
  const cellWidth = 10;
  const cellHeight = 20;
  const core = (term as unknown as {
    _core: {
      _charSizeService: { width: number; height: number };
      _renderService: { dimensions: { css: { cell: { width: number; height: number }; canvas: { width: number; height: number } } } };
    };
  })._core;
  core._charSizeService.width = cellWidth;
  core._charSizeService.height = cellHeight;
  core._renderService.dimensions.css.cell.width = cellWidth;
  core._renderService.dimensions.css.cell.height = cellHeight;
  core._renderService.dimensions.css.canvas.width = term.cols * cellWidth;
  core._renderService.dimensions.css.canvas.height = term.rows * cellHeight;
  const screen = term.element!.querySelector('.xterm-screen') as HTMLElement;
  const rect = {
    x: 0, y: 0, left: 0, top: 0, right: term.cols * cellWidth, bottom: term.rows * cellHeight,
    width: term.cols * cellWidth, height: term.rows * cellHeight, toJSON() { return {}; },
  };
  for (const el of [term.element!, screen]) {
    el.getBoundingClientRect = () => rect as DOMRect;
  }
}

function mouse(type: string, col: number, init: MouseEventInit = {}) {
  const cellWidth = 10;
  const cellHeight = 20;
  const target = document.querySelector('.xterm-screen') as HTMLElement;
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: col * cellWidth + 2,
    clientY: 2,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
    detail: type === 'mousedown' ? 1 : 0,
    altKey: true,
    ...init,
  }));
}

describe('Option-drag copy while mouse reporting is on', () => {
  const terms: import('@xterm/xterm').Terminal[] = [];

  afterEach(() => {
    for (const term of terms) term.dispose();
    terms.length = 0;
    document.body.innerHTML = '';
  });

  async function open() {
    const Terminal = await loadTerminal();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const term = new Terminal({
      cols: 40,
      rows: 6,
      macOptionClickForcesSelection: true,
      altClickMovesCursor: false,
      allowProposedApi: true,
    });
    terms.push(term);
    const sent: string[] = [];
    term.onData((data) => sent.push(data));
    term.open(host);
    installGeometry(term);
    term.write('hello selection from the remote shell\r\n');
    await new Promise<void>((resolve) => term.write('', () => resolve()));
    // Any-event tracking + SGR, what vim/tmux send on an SSH session.
    term.write('\x1b[?1003h\x1b[?1006h');
    await new Promise<void>((resolve) => term.write('', () => resolve()));
    return { term, sent };
  }

  function drag() {
    mouse('mousedown', 1);
    mouse('mousemove', 12);
    mouse('mouseup', 12);
    mouse('mousemove', 12, { buttons: 0 });
  }

  it('keeps the selection after the button is released', async () => {
    const { term, sent } = await open();
    const removeGuard = bindTerminalSelectionMouseGuard(term.element!, () => term.hasSelection());
    const before = sent.length;

    drag();

    expect(term.hasSelection()).toBe(true);
    expect(term.getSelection()).toContain('ello');
    expect(sent.slice(before)).toEqual([]);
    removeGuard();
  });
});
