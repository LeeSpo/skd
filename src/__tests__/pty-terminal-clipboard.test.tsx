import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Terminal } from '@xterm/xterm';
import { toast } from 'sonner';
import { PtyTerminal } from '@/components/pty-terminal';
import { TerminalInputProvider } from '@/lib/terminal-input-context';

const mocks = vi.hoisted(() => {
  class Socket {
    static OPEN = 1;
    readyState = 1;
    binaryType = '';
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    send = vi.fn();
    close = vi.fn(() => { this.readyState = 3; });
    constructor() { sockets.push(this); }
  }
  const sockets: Socket[] = [];
  return { terminals: [] as import('@xterm/xterm').Terminal[], sockets, Socket };
});

vi.mock('@xterm/xterm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xterm/xterm')>();
  return {
    ...actual,
    Terminal: class extends actual.Terminal {
      constructor(options?: import('@xterm/xterm').ITerminalOptions) {
        super(options);
        mocks.terminals.push(this);
      }
    },
  };
});

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    activate() {}
    fit() {}
    dispose() {}
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => true),
  invoke: vi.fn(async () => undefined),
}));

vi.mock('@/lib/terminal-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/terminal-config')>();
  return {
    ...actual,
    loadAppearanceSettings: () => ({
      ...actual.loadAppearanceSettings(),
      allowTransparency: false,
      backgroundImage: '',
      useWebglRenderer: false,
    }),
  };
});

vi.mock('@/components/terminal/terminal-search-bar', () => ({
  TerminalSearchBar: () => null,
}));

vi.mock('@/lib/restoration-manager', () => ({ signalReady: vi.fn() }));
vi.mock('@/lib/use-webview-file-drop', () => ({ useWebviewFileDrop: () => ({ isDragOver: false }) }));
vi.mock('@/lib/terminal-callbacks-context', () => ({ useTerminalCallbacks: () => ({}) }));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

function osc52(text: string, selection = 'c', terminator = '\x07') {
  return `\x1b]52;${selection};${Buffer.from(text).toString('base64')}${terminator}`;
}

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

describe('PTY terminal clipboard integration', () => {
  const browserWrite = vi.fn();
  const browserRead = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.terminals.length = 0;
    mocks.sockets.length = 0;
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command) => (
      command === 'get_websocket_endpoint' ? { port: 9001, token: 'test-token' } : undefined
    ));
    browserWrite.mockRejectedValue(new DOMException('User activation is required', 'NotAllowedError'));
    browserRead.mockResolvedValue('private local clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: browserWrite, readText: browserRead },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }));
    vi.stubGlobal('WebSocket', mocks.Socket);
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mount() {
    render(
      <TerminalInputProvider>
        <PtyTerminal connectionId="clipboard-test" connectionName="SSH Server" isActive />
      </TerminalInputProvider>,
    );
    return mocks.terminals[0];
  }

  it('copies remote OSC 52 output through the native bridge without browser user activation', async () => {
    const term = mount();
    const text = 'Codex response\n远端复制内容 🦀';

    await write(term, osc52(text));

    expect(invoke).toHaveBeenCalledWith('write_clipboard_text', { text });
    expect(browserWrite).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('continues parsing output after the native clipboard rejects a write', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('Clipboard unavailable'));
    const term = mount();

    await write(term, `${osc52('copy failed')}terminal still responsive`);

    expect(toast.error).toHaveBeenCalledWith('Failed to copy to clipboard');
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toContain('terminal still responsive');

    vi.mocked(invoke).mockResolvedValue(undefined);
    await write(term, osc52('next copy succeeds'));
    expect(invoke).toHaveBeenLastCalledWith('write_clipboard_text', { text: 'next copy succeeds' });
  });

  it.each(['c', '', 'p', 's', 'pc'])('supports OSC 52 selection %j on macOS', async (selection) => {
    const term = mount();

    await write(term, osc52('copied text', selection));

    expect(invoke).toHaveBeenCalledWith('write_clipboard_text', { text: 'copied text' });
  });

  it('ignores numbered cut buffers instead of overwriting the system clipboard', async () => {
    const term = mount();

    await write(term, osc52('cut buffer contents', '0'));

    expect(invoke).not.toHaveBeenCalledWith('write_clipboard_text', expect.anything());
  });

  it.each(['\x07', '\x1b\\'])('supports OSC 52 terminator %j', async (terminator) => {
    const term = mount();

    await write(term, osc52('terminated copy', 'c', terminator));

    expect(invoke).toHaveBeenCalledWith('write_clipboard_text', { text: 'terminated copy' });
  });

  it.each([true, false])('copies long responses split across PTY WebSocket frames (binary: %s)', async (binary) => {
    const term = mount();
    await waitFor(() => expect(mocks.sockets).toHaveLength(1));
    const socket = mocks.sockets[0];
    const text = 'Codex response: 中文 🦀\n'.repeat(8000);
    const sequence = osc52(text);
    const id = new TextEncoder().encode('clipboard-test');
    const clipboardWritten = new Promise<void>((resolve) => {
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === 'write_clipboard_text') resolve();
      });
    });

    act(() => {
      for (let offset = 0; offset < sequence.length; offset += 4093) {
        const payload = new TextEncoder().encode(sequence.slice(offset, offset + 4093));
        if (binary) {
          const frame = new Uint8Array(3 + id.length + payload.length);
          frame[0] = 0x01;
          frame[1] = id.length >> 8;
          frame[2] = id.length & 0xff;
          frame.set(id, 3);
          frame.set(payload, 3 + id.length);
          socket.onmessage?.(new MessageEvent('message', { data: frame.buffer }));
        } else {
          socket.onmessage?.(new MessageEvent('message', {
            data: JSON.stringify({ type: 'Output', data: Array.from(payload) }),
          }));
        }
      }
    });
    await clipboardWritten;
    await write(term, '');

    const copies = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'write_clipboard_text');
    expect(copies).toHaveLength(1);
    expect((copies[0][1] as { text: string }).text === text).toBe(true);
    expect(browserWrite).not.toHaveBeenCalled();
  });

  it('preserves copy order while the native write is pending', async () => {
    const term = mount();
    let finishFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => { finishFirst = resolve; });
    const copied: string[] = [];
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command !== 'write_clipboard_text') return;
      const { text } = args as { text: string };
      copied.push(text);
      if (text === 'first') await firstWrite;
    });

    const done = write(term, `${osc52('first')}${osc52('second')}output after copies`);
    await waitFor(() => expect(copied).toEqual(['first']));
    finishFirst();
    await done;

    expect(copied).toEqual(['first', 'second']);
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toContain('output after copies');
  });

  it('does not expose local clipboard text to OSC 52 read requests', async () => {
    const term = mount();
    const onData = vi.fn();
    term.onData(onData);

    await write(term, '\x1b]52;c;?\x07');

    expect(browserRead).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith('write_clipboard_text', expect.anything());
    expect(invoke).not.toHaveBeenCalledWith('read_clipboard_text');
    expect(onData).toHaveBeenCalledExactlyOnceWith('\x1b]52;c;\x07');
  });

  it('rate limits copy failures without blocking subsequent output', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10000);
    vi.mocked(invoke).mockRejectedValue(new Error('Clipboard unavailable'));
    const term = mount();

    await write(term, `${osc52('first')}${osc52('second')}still responsive`);

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toContain('still responsive');
    vi.mocked(Date.now).mockReturnValue(15000);
    await write(term, osc52('third'));
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it.each(['keyboard', 'context menu'])('copies terminal selections through the native bridge (%s)', async (action) => {
    const term = mount();
    await write(term, 'selected remote text');
    act(() => term.select(0, 0, 'selected remote text'.length));

    if (action === 'keyboard') {
      fireEvent.keyDown(term.textarea!, { key: 'c', keyCode: 67, metaKey: true });
    } else {
      fireEvent.contextMenu(term.element!);
      fireEvent.click(await screen.findByRole('menuitem', { name: /^Copy/ }));
    }
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('write_clipboard_text', { text: 'selected remote text' }));
    expect(browserWrite).not.toHaveBeenCalled();
  });

  it('pastes from the context menu without WebKit clipboard confirmation and sends bracketed text once', async () => {
    const text = '本机剪贴板 🦀\nsecond line';
    browserRead.mockRejectedValue(new DOMException('Paste confirmation is required', 'NotAllowedError'));
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'get_websocket_endpoint') return { port: 9001, token: 'test-token' };
      if (command === 'read_clipboard_text') return text;
    });
    const term = mount();
    await waitFor(() => expect(mocks.sockets).toHaveLength(1));
    const socket = mocks.sockets[0];
    await write(term, '\x1b[?2004h');

    fireEvent.contextMenu(term.element!);
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Paste/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('read_clipboard_text'));
    expect(browserRead).not.toHaveBeenCalled();
    const inputs = socket.send.mock.calls.map(([data]) => JSON.parse(data as string)).filter((message) => message.type === 'Input');
    expect(inputs).toEqual([{
      type: 'Input',
      connection_id: 'clipboard-test',
      data: Array.from(new TextEncoder().encode(`\x1b[200~${text.replace(/\n/g, '\r')}\x1b[201~`)),
    }]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each(['session', 'generation', 'unmount'])('discards pending paste after terminal %s changes', async (change) => {
    let finish!: (text: string) => void;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'get_websocket_endpoint') return { port: 9001, token: 'test-token' };
      if (command === 'read_clipboard_text') return new Promise<string>((resolve) => { finish = resolve; });
    });
    const view = render(
      <TerminalInputProvider>
        <PtyTerminal connectionId="clipboard-test" connectionName="SSH Server" isActive />
      </TerminalInputProvider>,
    );
    const term = mocks.terminals[0];
    await waitFor(() => expect(mocks.sockets).toHaveLength(1));
    const socket = mocks.sockets[0];
    act(() => socket.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ type: 'PtyStarted', connection_id: 'clipboard-test', generation: 1 }),
    })));
    fireEvent.contextMenu(term.element!);
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Paste/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('read_clipboard_text'));

    if (change === 'session') {
      view.rerender(
        <TerminalInputProvider>
          <PtyTerminal connectionId="replacement-session" connectionName="SSH Server" isActive />
        </TerminalInputProvider>,
      );
      await waitFor(() => expect(mocks.sockets).toHaveLength(2));
    } else if (change === 'generation') {
      act(() => socket.onmessage?.(new MessageEvent('message', {
        data: JSON.stringify({ type: 'PtyStarted', connection_id: 'clipboard-test', generation: 2 }),
      })));
    } else {
      view.unmount();
    }
    await act(async () => finish('stale private clipboard'));

    const inputs = mocks.sockets.flatMap((ws) => ws.send.mock.calls)
      .map(([data]) => JSON.parse(data as string)).filter((message) => message.type === 'Input');
    expect(inputs).toHaveLength(0);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not read the clipboard when the terminal socket is disconnected', async () => {
    const term = mount();
    await waitFor(() => expect(mocks.sockets).toHaveLength(1));
    mocks.sockets[0].readyState = 3;

    fireEvent.contextMenu(term.element!);
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Paste/ }));

    expect(invoke).not.toHaveBeenCalledWith('read_clipboard_text');
    expect(toast.error).toHaveBeenCalledWith('Terminal not connected');
  });

  it('reports native clipboard read errors without falling back to WebKit confirmation', async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'get_websocket_endpoint') return { port: 9001, token: 'test-token' };
      if (command === 'read_clipboard_text') throw new Error('Clipboard unavailable');
    });
    const term = mount();
    await waitFor(() => expect(mocks.sockets).toHaveLength(1));

    fireEvent.contextMenu(term.element!);
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Paste/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to read from clipboard'));
    expect(browserRead).not.toHaveBeenCalled();
    const inputs = mocks.sockets[0].send.mock.calls.map(([data]) => JSON.parse(data as string)).filter((message) => message.type === 'Input');
    expect(inputs).toHaveLength(0);
  });

  it('uses browser clipboard reads for context menu paste in frontend-only development', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    browserRead.mockResolvedValue('browser paste');
    const term = mount();
    await waitFor(() => expect(mocks.sockets).toHaveLength(1));

    fireEvent.contextMenu(term.element!);
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Paste/ }));

    await waitFor(() => expect(browserRead).toHaveBeenCalledTimes(1));
    expect(invoke).not.toHaveBeenCalledWith('read_clipboard_text');
    const inputs = mocks.sockets[0].send.mock.calls.map(([data]) => JSON.parse(data as string)).filter((message) => message.type === 'Input');
    expect(inputs).toEqual([{
      type: 'Input',
      connection_id: 'clipboard-test',
      data: Array.from(new TextEncoder().encode('browser paste')),
    }]);
  });

  it('uses the browser clipboard when running without the native bridge', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    browserWrite.mockResolvedValue(undefined);
    const term = mount();

    await write(term, osc52('browser copy'));

    expect(browserWrite).toHaveBeenCalledWith('browser copy');
    expect(invoke).not.toHaveBeenCalledWith('write_clipboard_text', expect.anything());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reports browser clipboard failures in frontend-only development', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const term = mount();

    await write(term, `${osc52('browser copy')}still responsive`);

    expect(browserWrite).toHaveBeenCalledWith('browser copy');
    expect(invoke).not.toHaveBeenCalledWith('write_clipboard_text', expect.anything());
    expect(toast.error).toHaveBeenCalledWith('Failed to copy to clipboard');
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toContain('still responsive');
  });
});
