import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  prepareTerminalPayload,
  wrapBracketedPaste,
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  COMPOSE_PANE_SEND_OPTIONS,
  TerminalInputProvider,
  useTerminalInput,
} from '../terminal-input-context';

describe('terminal-input-context helpers', () => {
  it('appends newline and bracketed paste by default', () => {
    expect(prepareTerminalPayload('echo hi')).toBe(
      `${BRACKETED_PASTE_START}echo hi\n${BRACKETED_PASTE_END}`,
    );
  });

  it('preserves existing trailing newline', () => {
    expect(prepareTerminalPayload('echo hi\n')).toBe(
      `${BRACKETED_PASTE_START}echo hi\n${BRACKETED_PASTE_END}`,
    );
  });

  it('can disable bracketed paste and newline', () => {
    expect(
      prepareTerminalPayload('echo hi', {
        bracketedPaste: false,
        appendNewline: false,
        normalizeLineBreaks: false,
      }),
    ).toBe('echo hi');
  });

  it('uses carriage return for compose-style shell submission', () => {
    expect(prepareTerminalPayload('echo hi', COMPOSE_PANE_SEND_OPTIONS)).toBe('echo hi\r');
    expect(prepareTerminalPayload('echo a\necho b', COMPOSE_PANE_SEND_OPTIONS)).toBe(
      'echo a\recho b\r',
    );
  });
});

describe('TerminalInputProvider sendToTerminal', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <TerminalInputProvider>{children}</TerminalInputProvider>
  );

  it('returns false when no sender is registered', () => {
    const { result } = renderHook(() => useTerminalInput(), { wrapper });

    let sent = false;
    act(() => {
      sent = result.current.sendToTerminal('conn-1', 'echo hi');
    });

    expect(sent).toBe(false);
  });

  it('invokes registered sender with prepared payload', () => {
    const sender = vi.fn(() => true);
    const { result } = renderHook(() => useTerminalInput(), { wrapper });

    act(() => {
      result.current.registerSender('conn-1', sender);
    });

    let sent = false;
    act(() => {
      sent = result.current.sendToTerminal('conn-1', 'echo hi');
    });

    expect(sent).toBe(true);
    expect(sender).toHaveBeenCalledWith(
      `${BRACKETED_PASTE_START}echo hi\n${BRACKETED_PASTE_END}`,
    );
  });

  it('unregisters sender', () => {
    const sender = vi.fn(() => true);
    const { result } = renderHook(() => useTerminalInput(), { wrapper });

    act(() => {
      result.current.registerSender('conn-1', sender);
      result.current.unregisterSender('conn-1');
    });

    let sent = false;
    act(() => {
      sent = result.current.sendToTerminal('conn-1', 'echo hi');
    });

    expect(sent).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });
});