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
      active: {
        length: 0,
        getLine: vi.fn(),
      },
    };

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
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
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
