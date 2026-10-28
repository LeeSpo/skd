import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { PtyTerminal } from '../components/pty-terminal';
import { TerminalInputProvider } from '../lib/terminal-input-context';
import { loadAppearanceSettings } from '../lib/terminal-config';

const mocks = vi.hoisted(() => {
  const terminals: Array<any> = [];
  const fitAddons: Array<any> = [];
  const webSockets: Array<any> = [];

  class MockTerminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    unicode = { activeVersion: '11' };
    buffer = {
      normal: { length: 24 },
      active: {
        length: 0,
        getLine: vi.fn(),
      },
    };
    private resizeListeners = new Set<(size: { cols: number; rows: number }) => void>();

    loadAddon = vi.fn();
    open = vi.fn();
    focus = vi.fn();
    refresh = vi.fn();
    writeln = vi.fn();
    write = vi.fn((_data: string, callback?: () => void) => callback?.());
    onSelectionChange = vi.fn(() => ({ dispose: vi.fn() }));
    onLineFeed = vi.fn(() => ({ dispose: vi.fn() }));
    attachCustomKeyEventHandler = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn((listener: (size: { cols: number; rows: number }) => void) => {
      this.resizeListeners.add(listener);
      return { dispose: vi.fn(() => this.resizeListeners.delete(listener)) };
    });
    resize = vi.fn((cols: number, rows: number) => {
      if (cols === this.cols && rows === this.rows) return;
      this.cols = cols;
      this.rows = rows;
      for (const listener of this.resizeListeners) listener({ cols, rows });
    });
    hasSelection = vi.fn(() => false);
    getSelection = vi.fn(() => '');
    selectAll = vi.fn();
    selectLines = vi.fn();
    clearSelection = vi.fn();
    clear = vi.fn();
    reset = vi.fn();
    dispose = vi.fn();
  }

  class MockFitAddon {
    fit = vi.fn();
    dispose = vi.fn();

    constructor() {
      fitAddons.push(this);
    }
  }

  class MockWebSocket {
    static OPEN = 1;
    readyState = MockWebSocket.OPEN;
    send = vi.fn();
    close = vi.fn(() => {
      this.readyState = 3;
    });
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(public url: string) {
      webSockets.push(this);
    }
  }

  const Terminal = vi.fn(function Terminal() {
    const terminal = new MockTerminal();
    terminals.push(terminal);
    return terminal;
  });

  return { terminals, fitAddons, webSockets, Terminal, MockFitAddon, MockWebSocket };
});

vi.mock('@xterm/xterm', () => ({
  Terminal: mocks.Terminal,
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: mocks.MockFitAddon,
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(function WebLinksAddon() {
    return { dispose: vi.fn() };
  }),
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(function WebglAddon() {
    return { dispose: vi.fn(), onContextLoss: vi.fn() };
  }),
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: vi.fn(function SearchAddon() {
    return {
      findNext: vi.fn(),
      findPrevious: vi.fn(),
    };
  }),
}));

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: vi.fn(function Unicode11Addon() {
    return { dispose: vi.fn() };
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => (command === 'get_websocket_endpoint' ? { port: 9001, token: 'test-token' } : undefined)),
}));

vi.mock('../lib/terminal-config', () => ({
  TERMINAL_APPEARANCE_CHANGED_EVENT: 'skd-terminal-appearance-changed',
  defaultTerminalTheme: {
    background: '#000000',
  },
  terminalThemes: {
    'vs-code-dark': {
      background: '#000000',
    },
  },
  loadAppearanceSettings: vi.fn(() => ({
    allowTransparency: false,
    backgroundImage: '',
    opacity: 100,
    theme: 'vs-code-dark',
    useWebglRenderer: false,
  })),
  getThemeAwareTerminalOptions: vi.fn(() => ({
    cursorBlink: true,
    cursorStyle: 'block',
    fontFamily: 'monospace',
    fontSize: 14,
    scrollback: 10000,
    theme: {},
  })),
  getThemeAwareTerminalTheme: vi.fn(() => ({ background: '#1e1e1e' })),
  terminalBackgroundSize: vi.fn(() => 'cover'),
  terminalContainerBackground: vi.fn((opts: { opaqueBackground: string }) => opts.opaqueBackground),
}));

vi.mock('../components/terminal/terminal-context-menu', () => ({
  TerminalContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/terminal/terminal-search-bar', () => ({
  TerminalSearchBar: () => null,
}));

vi.mock('../lib/restoration-manager', () => ({
  signalReady: vi.fn(),
}));

vi.mock('../lib/terminal-callbacks-context', () => ({
  useTerminalCallbacks: () => ({}),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

function renderTerminal(
  isActive: boolean,
  onConnectionStatusChange?: React.ComponentProps<typeof PtyTerminal>['onConnectionStatusChange'],
  props: Partial<React.ComponentProps<typeof PtyTerminal>> = {},
) {
  return render(
    <TerminalInputProvider>
      <PtyTerminal
        connectionId="connection-1"
        connectionName="SSH Server"
        host="127.0.0.1"
        username="root"
        isActive={isActive}
        onConnectionStatusChange={onConnectionStatusChange}
        {...props}
      />
    </TerminalInputProvider>,
  );
}

async function flushTimers() {
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
}

function getCustomKeyHandler() {
  const handler = mocks.terminals[0].attachCustomKeyEventHandler.mock.calls[0]?.[0];
  expect(handler).toBeDefined();
  return handler as (event: KeyboardEvent) => boolean;
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('PtyTerminal activation', () => {
  const defaultAppearance = loadAppearanceSettings();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(loadAppearanceSettings).mockReturnValue(defaultAppearance);
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command) => (
      command === 'get_websocket_endpoint' ? { port: 9001, token: 'test-token' } : undefined
    ));
    mocks.terminals.length = 0;
    mocks.fitAddons.length = 0;
    mocks.webSockets.length = 0;

    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: 600,
    });

    vi.stubGlobal('WebSocket', mocks.MockWebSocket);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        return window.setTimeout(() => callback(performance.now()), 0);
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => window.clearTimeout(id)));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('PTY output streaming', () => {
    function outputEvent(text: string, binary = true): MessageEvent {
      const payload = new TextEncoder().encode(text);
      if (!binary) {
        return new MessageEvent('message', {
          data: JSON.stringify({ type: 'Output', data: Array.from(payload) }),
        });
      }

      const id = new TextEncoder().encode('connection-1');
      const frame = new Uint8Array(3 + id.length + payload.length);
      frame[0] = 0x01;
      frame[1] = id.length >> 8;
      frame[2] = id.length & 0xff;
      frame.set(id, 3);
      frame.set(payload, 3 + id.length);
      return new MessageEvent('message', { data: frame.buffer });
    }

    async function mountOutputTerminal() {
      const view = renderTerminal(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(60); });
      return { ...view, terminal: mocks.terminals[0], socket: mocks.webSockets[0] };
    }

    it.each([true, false])('preserves terminal state after more than 32 MiB of output (binary: %s)', async (binary) => {
      const { terminal, socket } = await mountOutputTerminal();
      const chunk = '\x1b[0m'.repeat(64 * 1024);
      const event = outputEvent(chunk, binary);
      act(() => {
        for (let i = 0; i < 129; i++) socket.onmessage(event);
        socket.onmessage(outputEvent('generation complete', binary));
      });

      expect(terminal.reset).not.toHaveBeenCalled();
      expect(terminal.clear).toHaveBeenCalledOnce();
      expect(terminal.writeln).not.toHaveBeenCalled();
      expect(terminal.write).toHaveBeenCalledTimes(130);
      expect(terminal.write.mock.calls.slice(0, 129).every(([text]: [string]) => text === chunk)).toBe(true);
      expect(terminal.write.mock.lastCall?.[0]).toBe('generation complete');
    });

    it('keeps one write in flight and drains queued output in order across 32 MiB', async () => {
      const { terminal, socket } = await mountOutputTerminal();
      const chunk = '\x1b[0m'.repeat(256 * 1024);
      const event = outputEvent(chunk);
      act(() => {
        for (let i = 0; i < 31; i++) socket.onmessage(event);
      });
      terminal.write.mockClear();
      const completions: Array<() => void> = [];
      terminal.write.mockImplementation((_text: string, callback: () => void) => completions.push(callback));

      act(() => {
        socket.onmessage(event);
        socket.onmessage(outputEvent('queued first'));
        socket.onmessage(outputEvent('queued second'));
      });
      expect(terminal.write.mock.calls.map(([text]: [string]) => text)).toEqual([chunk]);

      act(() => { completions.shift()!(); });
      expect(terminal.write.mock.calls.map(([text]: [string]) => text)).toEqual([chunk, 'queued first']);
      act(() => {
        socket.onmessage(outputEvent('queued third'));
        completions.shift()!();
      });
      expect(terminal.write.mock.calls.map(([text]: [string]) => text)).toEqual([chunk, 'queued first', 'queued second']);
      act(() => { completions.shift()!(); });
      expect(terminal.write.mock.calls.map(([text]: [string]) => text)).toEqual([
        chunk, 'queued first', 'queued second', 'queued third',
      ]);
      act(() => { completions.shift()!(); });
      expect(completions).toHaveLength(0);
      expect(terminal.clear).toHaveBeenCalledOnce();
      expect(terminal.reset).not.toHaveBeenCalled();
    });

    it('discards queued output when unmounted with a write still pending', async () => {
      const { terminal, socket, unmount } = await mountOutputTerminal();
      let completeWrite!: () => void;
      terminal.write.mockImplementation((_text: string, callback: () => void) => { completeWrite = callback; });
      act(() => {
        socket.onmessage(outputEvent('in flight'));
        socket.onmessage(outputEvent('must not reach the disposed terminal'));
      });
      unmount();
      act(() => { completeWrite(); });
      expect(terminal.write.mock.calls.map(([text]: [string]) => text)).toEqual(['in flight']);
    });
  });

  describe('resize scheduling', () => {
    const frames = new Map<number, FrameRequestCallback>();
    const observedElements: Element[] = [];
    let nextFrameId: number;
    let resizeCallback: ResizeObserverCallback;
    let disconnect: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      frames.clear();
      observedElements.length = 0;
      nextFrameId = 0;
      disconnect = vi.fn();
      vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
        const id = nextFrameId++;
        frames.set(id, callback);
        return id;
      }));
      vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
      vi.stubGlobal('ResizeObserver', class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe = vi.fn((element: Element) => observedElements.push(element));
        disconnect = disconnect;
      });
    });

    function flushFrame() {
      const callbacks = Array.from(frames.values());
      frames.clear();
      act(() => callbacks.forEach((callback) => callback(performance.now())));
    }

    function setSize(width: number, height = 600) {
      const container = observedElements[0];
      Object.defineProperties(container, {
        offsetWidth: { configurable: true, value: width },
        offsetHeight: { configurable: true, value: height },
      });
    }

    function notifyObserver(width = 800, height = 600) {
      const entries = observedElements.map((target) => ({
        target,
        contentRect: { width, height },
      } as ResizeObserverEntry));
      act(() => resizeCallback(entries, {} as ResizeObserver));
    }

    function notifyWindow() {
      act(() => window.dispatchEvent(new Event('resize')));
    }

    async function mountTerminal(isActive = true) {
      const view = renderTerminal(isActive);
      await act(async () => { await vi.advanceTimersByTimeAsync(60); });
      const terminal = mocks.terminals[0];
      const fit = mocks.fitAddons[0].fit;
      fit.mockClear();
      return { ...view, terminal, fit, fitAddon: mocks.fitAddons[0], socket: mocks.webSockets[0] };
    }

    it('updates rows immediately and debounces columns for 100 ms at 200 normal buffer lines', async () => {
      const { terminal, fit, fitAddon, socket } = await mountTerminal();
      terminal.buffer.normal.length = 200;
      fitAddon.proposeDimensions = vi.fn(() => ({ cols: 100, rows: 30 }));
      setSize(1000, 750);
      notifyObserver(1000, 750);

      expect(fit).not.toHaveBeenCalled();
      expect(terminal.resize.mock.calls).toEqual([[80, 30]]);
      await act(async () => { await vi.advanceTimersByTimeAsync(99); });
      expect(terminal.cols).toBe(80);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(terminal.resize.mock.calls).toEqual([[80, 30], [100, 30]]);
      expect(socket.send.mock.calls.map(([message]: [string]) => JSON.parse(message))).toEqual([
        { type: 'Resize', connection_id: 'connection-1', cols: 80, rows: 30 },
        { type: 'Resize', connection_id: 'connection-1', cols: 100, rows: 30 },
      ]);
    });

    it.each([
      undefined,
      { cols: Number.NaN, rows: 30 },
      { cols: 100, rows: Number.NaN },
    ])('ignores unavailable or invalid proposed dimensions with a large buffer (%j)', async (dimensions) => {
      const { terminal, fitAddon } = await mountTerminal();
      terminal.buffer.normal.length = 200;
      fitAddon.proposeDimensions = vi.fn(() => dimensions);
      notifyObserver();
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(terminal.resize).not.toHaveBeenCalled();
    });

    it('only applies the latest debounced columns while keeping subsequent row changes immediate', async () => {
      const { terminal, fitAddon, socket } = await mountTerminal();
      terminal.buffer.normal.length = 250;
      let dimensions = { cols: 100, rows: 24 };
      fitAddon.proposeDimensions = vi.fn(() => dimensions);
      notifyObserver();
      expect(terminal.resize).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(60); });
      dimensions = { cols: 120, rows: 32 };
      notifyObserver();
      expect(terminal.resize.mock.calls).toEqual([[80, 32]]);
      await act(async () => { await vi.advanceTimersByTimeAsync(99); });
      expect(terminal.cols).toBe(80);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(terminal.resize.mock.calls).toEqual([[80, 32], [120, 32]]);
      expect(socket.send).toHaveBeenCalledTimes(2);
    });

    it('uses the normal buffer threshold and immediately fits below 200 lines, cancelling pending columns', async () => {
      const { terminal, fit, fitAddon } = await mountTerminal();
      terminal.buffer.normal.length = 200;
      terminal.buffer.active.length = 24;
      let dimensions = { cols: 100, rows: 30 };
      fitAddon.proposeDimensions = vi.fn(() => dimensions);
      fit.mockImplementation(() => terminal.resize(dimensions.cols, dimensions.rows));
      notifyObserver();
      expect(terminal.cols).toBe(80);

      terminal.buffer.normal.length = 199;
      terminal.buffer.active.length = 1000;
      dimensions = { cols: 110, rows: 35 };
      notifyObserver();
      expect(fit).toHaveBeenCalledOnce();
      expect(terminal.resize.mock.calls).toEqual([[80, 30], [110, 35]]);
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(terminal.cols).toBe(110);
      expect(terminal.resize).toHaveBeenCalledTimes(2);
    });

    it('cancels pending columns when the user returns to the current column count', async () => {
      const { terminal, fitAddon } = await mountTerminal();
      terminal.buffer.normal.length = 200;
      let dimensions = { cols: 100, rows: 30 };
      fitAddon.proposeDimensions = vi.fn(() => dimensions);
      notifyObserver();
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      dimensions = { cols: 80, rows: 35 };
      notifyObserver();
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(terminal.resize.mock.calls).toEqual([[80, 30], [80, 35]]);
    });

    it.each(['activation', 'appearance'])('forces the latest dimensions on %s and cancels pending columns', async (reason) => {
      const { terminal, fit, fitAddon, rerender } = await mountTerminal(false);
      terminal.buffer.normal.length = 200;
      let dimensions = { cols: 100, rows: 30 };
      fitAddon.proposeDimensions = vi.fn(() => dimensions);
      fit.mockImplementation(() => terminal.resize(dimensions.cols, dimensions.rows));
      notifyObserver();

      dimensions = { cols: 110, rows: 35 };
      if (reason === 'activation') {
        rerender(
          <TerminalInputProvider>
            <PtyTerminal connectionId="connection-1" connectionName="SSH Server" host="127.0.0.1" username="root" isActive />
          </TerminalInputProvider>,
        );
        flushFrame();
      } else {
        act(() => window.dispatchEvent(new Event('skd-terminal-appearance-changed')));
      }
      expect(fit).toHaveBeenCalledOnce();
      expect(terminal.resize.mock.calls).toEqual([[80, 30], [110, 35]]);
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(terminal.cols).toBe(110);
      expect(terminal.resize).toHaveBeenCalledTimes(2);
    });

    it.each([[0, 600], [800, 0]])('does not apply deferred columns to a hidden %i x %i container', async (width, height) => {
      const { terminal, fitAddon } = await mountTerminal();
      terminal.buffer.normal.length = 200;
      fitAddon.proposeDimensions = vi.fn(() => ({ cols: 100, rows: 30 }));
      notifyObserver();
      setSize(width, height);
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(terminal.resize.mock.calls).toEqual([[80, 30]]);
    });

    it('clears the horizontal resize timer when the terminal unmounts', async () => {
      const { terminal, fitAddon, unmount } = await mountTerminal();
      terminal.buffer.normal.length = 200;
      fitAddon.proposeDimensions = vi.fn(() => ({ cols: 100, rows: 30 }));
      notifyObserver();
      unmount();
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(terminal.resize.mock.calls).toEqual([[80, 30]]);
    });

    it.each(['window', 'observer', 'both'])('fits each frame during continuous %s resizing', async (source) => {
      const { fit, terminal, socket } = await mountTerminal();

      for (let frame = 0; frame < 60; frame++) {
        const width = 800 + frame * 4;
        setSize(width);
        if (source !== 'observer') notifyWindow();
        if (source !== 'window') notifyObserver(width);
        // Observer delivery is already before paint; fitting must not wait for another frame.
        expect(fit).toHaveBeenCalledTimes(source === 'window' ? frame : frame + 1);
        await act(async () => { await vi.advanceTimersByTimeAsync(16); });
        flushFrame();
        expect(fit).toHaveBeenCalledTimes(frame + 1);
      }

      expect(mocks.terminals).toHaveLength(1);
      expect(mocks.webSockets).toHaveLength(1);
      expect(terminal.dispose).not.toHaveBeenCalled();
      expect(socket.close).not.toHaveBeenCalled();
    });

    it('fits the latest observed size before paint and cancels the queued window fit', async () => {
      const { fit } = await mountTerminal();
      const measuredSizes: number[][] = [];
      fit.mockImplementation(() => {
        const container = observedElements[0] as HTMLElement;
        measuredSizes.push([container.offsetWidth, container.offsetHeight]);
      });

      setSize(900);
      notifyWindow();
      notifyWindow();
      setSize(1200, 720);
      notifyWindow();
      expect(fit).not.toHaveBeenCalled();
      // The browser coalesces both observed containers into one delivery.
      notifyObserver(1200, 720);
      expect(measuredSizes).toEqual([[1200, 720]]);
      flushFrame();
      expect(fit).toHaveBeenCalledOnce();
    });

    it('performs one settling fit 300 ms after the latest event without delaying live fits', async () => {
      const { fit } = await mountTerminal();
      notifyWindow();
      flushFrame();
      expect(fit).toHaveBeenCalledOnce();

      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      notifyObserver(1100);
      flushFrame();
      expect(fit).toHaveBeenCalledTimes(2);

      await act(async () => { await vi.advanceTimersByTimeAsync(299); });
      flushFrame();
      expect(fit).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(fit).toHaveBeenCalledTimes(2);
      flushFrame();
      expect(fit).toHaveBeenCalledTimes(3);

      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      flushFrame();
      expect(fit).toHaveBeenCalledTimes(3);
    });

    it.each([[0, 600], [800, 0]])('skips a %i x %i container and fits when it becomes visible', async (width, height) => {
      const { fit } = await mountTerminal();
      setSize(width, height);
      notifyWindow();
      flushFrame();
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      flushFrame();
      expect(fit).not.toHaveBeenCalled();

      setSize(800, 600);
      notifyObserver();
      flushFrame();
      expect(fit).toHaveBeenCalledOnce();
    });

    it('preserves the observer minimum size filter', async () => {
      const { fit } = await mountTerminal();
      notifyObserver(100, 600);
      notifyObserver(800, 100);
      flushFrame();
      expect(fit).not.toHaveBeenCalled();

      notifyObserver(101, 101);
      flushFrame();
      expect(fit).toHaveBeenCalledOnce();
    });

    it.each([false, true])('cancels pending resize work on unmount (live frame completed: %s)', async (completeFrame) => {
      const { unmount, fit } = await mountTerminal();
      notifyWindow();
      if (completeFrame) flushFrame();
      const fitCount = fit.mock.calls.length;

      unmount();
      expect(frames.size).toBe(0);
      expect(disconnect).toHaveBeenCalledOnce();
      if (!completeFrame) expect(cancelAnimationFrame).toHaveBeenCalledWith(0);
      notifyWindow();
      notifyObserver();
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      flushFrame();
      expect(fit).toHaveBeenCalledTimes(fitCount);
    });

    it('only sends PTY resize notifications when the fitted row or column count changes', async () => {
      const { fit, terminal, socket } = await mountTerminal();
      const onResize = terminal.onResize.mock.calls[0][0] as (size: { cols: number; rows: number }) => void;
      fit.mockImplementation(() => {
        const container = observedElements[0] as HTMLElement;
        terminal.cols = Math.floor(container.offsetWidth / 10);
        terminal.rows = Math.floor(container.offsetHeight / 25);
        onResize({ cols: terminal.cols, rows: terminal.rows });
      });

      for (const [width, height] of [[1000, 600], [1001, 600], [1000, 625]]) {
        setSize(width, height);
        notifyWindow();
        flushFrame();
      }
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      flushFrame();

      expect(fit).toHaveBeenCalledTimes(4);
      expect(socket.send.mock.calls.map(([message]: [string]) => JSON.parse(message))).toEqual([
        { type: 'Resize', connection_id: 'connection-1', cols: 100, rows: 24 },
        { type: 'Resize', connection_id: 'connection-1', cols: 100, rows: 25 },
      ]);
    });
  });

  it('opens the authenticated endpoint and obtains fresh credentials on reconnect', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ port: 9004, token: 'first-token' })
      .mockResolvedValueOnce({ port: 9005, token: 'second-token' });
    renderTerminal(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    expect(mocks.webSockets[0].url).toBe('ws://127.0.0.1:9004/?token=first-token');
    act(() => { mocks.webSockets[0].onclose?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(mocks.webSockets[1].url).toBe('ws://127.0.0.1:9005/?token=second-token');
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('does not open a bare socket on endpoint failure and retries with fresh IPC', async () => {
    vi.mocked(invoke)
      .mockRejectedValueOnce(new Error('private-ipc-error'))
      .mockResolvedValueOnce({ port: 9002, token: 'recovered-token' });
    renderTerminal(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    expect(mocks.webSockets).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(mocks.webSockets).toHaveLength(1);
    expect(mocks.webSockets[0].url).toBe('ws://127.0.0.1:9002/?token=recovered-token');
  });

  it('stops after five retries and reports failure when endpoint IPC stays unavailable', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('unavailable'));
    const onStatus = vi.fn();
    renderTerminal(true, onStatus);
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(invoke).toHaveBeenCalledTimes(6);
    expect(mocks.webSockets).toHaveLength(0);
    expect(onStatus).toHaveBeenLastCalledWith('connection-1', 'disconnected');
    expect(toast.error).toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(invoke).toHaveBeenCalledTimes(6);
  });

  it('does not establish a connection when a pending endpoint resolves after unmount', async () => {
    let resolveEndpoint!: (endpoint: { port: number; token: string }) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => { resolveEndpoint = resolve; }));
    const { unmount } = renderTerminal(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    expect(invoke).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { resolveEndpoint({ port: 9001, token: 'late-token' }); });
    expect(mocks.webSockets).toHaveLength(0);
  });

  it('does not retry when a pending endpoint rejects after unmount', async () => {
    let rejectEndpoint!: (error: Error) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectEndpoint = reject; }));
    const { unmount } = renderTerminal(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    unmount();
    await act(async () => { rejectEndpoint(new Error('late failure')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(mocks.webSockets).toHaveLength(0);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('clears a scheduled retry when the terminal unmounts', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('unavailable'));
    const { unmount } = renderTerminal(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(mocks.webSockets).toHaveLength(0);
  });

  it('closes a socket that is still handshaking on unmount', async () => {
    const { unmount } = renderTerminal(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    const socket = mocks.webSockets[0];
    socket.readyState = 0;
    unmount();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.onopen).toBeNull();
  });

  it('does not focus the terminal when it mounts inactive', () => {
    renderTerminal(false);

    expect(mocks.terminals[0].focus).not.toHaveBeenCalled();
  });

  it('keeps scrollbar state local to each terminal without recreating sessions', async () => {
    const first = renderTerminal(true);
    const second = renderTerminal(false, undefined, { connectionId: 'connection-2' });
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    const firstContainer = first.container.querySelector('.pty-terminal-container')!;
    const secondContainer = second.container.querySelector('.pty-terminal-container')!;
    const terminal = mocks.terminals[0];
    const onLineFeed = terminal.onLineFeed.mock.calls[0][0] as () => void;

    expect(firstContainer.getAttribute('data-scrollable')).toBe('false');
    expect(secondContainer.getAttribute('data-scrollable')).toBe('false');

    act(() => {
      terminal.buffer.active.length = terminal.rows + 1;
      onLineFeed();
    });
    expect(firstContainer.getAttribute('data-scrollable')).toBe('true');
    expect(secondContainer.getAttribute('data-scrollable')).toBe('false');

    act(() => {
      terminal.buffer.active.length = terminal.rows;
      onLineFeed();
    });
    expect(firstContainer.getAttribute('data-scrollable')).toBe('false');
    expect(mocks.terminals).toHaveLength(2);
    expect(mocks.webSockets).toHaveLength(2);
    expect(terminal.dispose).not.toHaveBeenCalled();
  });

  it('keeps background-image state local and updates an image without recreating the terminal', () => {
    const first = renderTerminal(true);
    vi.mocked(loadAppearanceSettings).mockReturnValue({
      ...defaultAppearance,
      backgroundImage: 'data:image/png;base64,first',
      backgroundImageOpacity: 30,
      backgroundImageBlur: 0,
      backgroundImagePosition: 'cover',
    });
    const second = renderTerminal(false, undefined, { connectionId: 'connection-2' });
    const firstContainer = first.container.querySelector('.pty-terminal-container')!;
    const secondContainer = second.container.querySelector('.pty-terminal-container')!;
    expect(firstContainer.getAttribute('data-background-image')).toBe('false');
    expect(secondContainer.getAttribute('data-background-image')).toBe('true');
    expect(firstContainer.querySelector('style')).toBeNull();
    expect(secondContainer.querySelector('style')).toBeNull();

    vi.mocked(loadAppearanceSettings).mockReturnValue({
      ...loadAppearanceSettings(),
      backgroundImage: 'data:image/png;base64,second',
    });
    second.rerender(
      <TerminalInputProvider>
        <PtyTerminal connectionId="connection-2" connectionName="SSH Server" host="127.0.0.1" username="root" isActive={false} appearanceKey={1} />
      </TerminalInputProvider>,
    );

    expect(secondContainer.getAttribute('data-background-image')).toBe('true');
    expect(secondContainer.querySelector('[style*="background-image"]')?.getAttribute('style')).toContain('base64,second');
    expect(firstContainer.getAttribute('data-background-image')).toBe('false');
    expect(mocks.terminals).toHaveLength(2);
    expect(mocks.terminals[1].dispose).not.toHaveBeenCalled();
  });

  it('fits, refreshes, and focuses the terminal when it becomes active', async () => {
    const { rerender } = renderTerminal(false);
    const terminal = mocks.terminals[0];
    const fitAddon = mocks.fitAddons[0];
    terminal.focus.mockClear();
    terminal.refresh.mockClear();
    fitAddon.fit.mockClear();

    rerender(
      <TerminalInputProvider>
        <PtyTerminal
          connectionId="connection-1"
          connectionName="SSH Server"
          host="127.0.0.1"
          username="root"
          isActive={true}
        />
      </TerminalInputProvider>,
    );
    await flushTimers();

    expect(fitAddon.fit).toHaveBeenCalled();
    expect(terminal.refresh).toHaveBeenCalledWith(0, terminal.rows - 1);
    expect(terminal.focus).toHaveBeenCalled();
  });

  it('does not recreate the terminal or WebSocket when only active state changes', async () => {
    const { rerender } = renderTerminal(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(mocks.webSockets).toHaveLength(1);

    const terminal = mocks.terminals[0];
    terminal.refresh.mockClear();
    const terminalCount = mocks.terminals.length;
    const webSocketCount = mocks.webSockets.length;

    rerender(
      <TerminalInputProvider>
        <PtyTerminal
          connectionId="connection-1"
          connectionName="SSH Server"
          host="127.0.0.1"
          username="root"
          isActive={true}
        />
      </TerminalInputProvider>,
    );
    await flushTimers();

    expect(mocks.terminals).toHaveLength(terminalCount);
    expect(mocks.webSockets).toHaveLength(webSocketCount);
    expect(terminal.refresh).toHaveBeenCalledWith(0, terminal.rows - 1);
  });

  it('filters the WebKit IME unknown keydown before passing composition to xterm', () => {
    renderTerminal(true);
    const handler = getCustomKeyHandler();
    const unknown = { key: 'Unidentified', keyCode: 0, isComposing: true };
    const event = new KeyboardEvent('keydown', { ...unknown, cancelable: true });

    expect(handler(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(handler(new KeyboardEvent('keyup', unknown))).toBe(true);
    expect(handler(new KeyboardEvent('keydown', { ...unknown, isComposing: false }))).toBe(true);
    expect(handler(new KeyboardEvent('keydown', { key: 'CapsLock', keyCode: 20, isComposing: true }))).toBe(true);
    expect(handler(new KeyboardEvent('keydown', { key: 'Process', keyCode: 229, isComposing: true }))).toBe(true);
  });

  it('lets xterm handle Command+V paste without duplicate custom send on macOS', async () => {
    const readText = vi.fn().mockResolvedValue('mac paste');
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText,
      },
    });
    renderTerminal(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    const preventDefault = vi.fn();
    const handled = getCustomKeyHandler()({
      type: 'keydown',
      key: 'v',
      ctrlKey: false,
      metaKey: true,
      preventDefault,
    } as unknown as KeyboardEvent);
    await flushPromises();

    expect(handled).toBe(true);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(readText).not.toHaveBeenCalled();
  });
});
