import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { shouldIgnoreImeKeyDown } from '../terminal-ime';

describe('terminal IME commits with real xterm', () => {
  let term: Terminal;
  let textarea: HTMLTextAreaElement;
  let sent: string[];

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
    const getComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = getComputedStyle(element);
      return new Proxy(style, {
        get(target, prop, receiver) {
          if (prop === 'getPropertyValue') {
            return (name: string) => name === 'padding-left' || name === 'padding-top'
              ? '0'
              : target.getPropertyValue(name);
          }
          return Reflect.get(target, prop, receiver);
        },
      });
    });

    // xterm detects Node from process.title; exercise its macOS browser path.
    const title = Object.getOwnPropertyDescriptor(process, 'title');
    delete (process as { title?: string }).title;
    let XTerm: typeof Terminal;
    try {
      XTerm = (await import('@xterm/xterm')).Terminal;
    } finally {
      if (title) Object.defineProperty(process, 'title', title);
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    term = new XTerm({ cols: 40, rows: 6 });
    sent = [];
    term.onData((data) => sent.push(data));
    term.attachCustomKeyEventHandler((event) => !shouldIgnoreImeKeyDown(event));
    term.open(host);
    term.focus();
    textarea = term.textarea!;
    vi.advanceTimersByTime(20);
  });

  afterEach(() => {
    term?.dispose();
    document.body.replaceChildren();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function key(type: string, init: KeyboardEventInit) {
    const event = new KeyboardEvent(type, {
      bubbles: true, cancelable: true, composed: true, ...init,
    });
    textarea.dispatchEvent(event);
    return event;
  }

  function composition(type: string, data: string) {
    textarea.dispatchEvent(new CompositionEvent(type, {
      bubbles: true, composed: true, data,
    }));
  }

  function input(inputType: string, data: string | null, value: string, isComposing: boolean) {
    const init = { bubbles: true, composed: true, inputType, data, isComposing };
    textarea.dispatchEvent(new InputEvent('beforeinput', init));
    textarea.value = value;
    textarea.dispatchEvent(new InputEvent('input', init));
  }

  function startComposition(text: string) {
    const prefix = textarea.value;
    composition('compositionstart', '');
    composition('compositionupdate', text);
    input('insertCompositionText', text, prefix + text, true);
    vi.advanceTimersByTime(0);
    return prefix;
  }

  function finishComposition(text: string, prefix: string) {
    input('deleteCompositionText', null, prefix, true);
    input('insertFromComposition', text, prefix + text, true);
    composition('compositionend', text);
    vi.advanceTimersByTime(0);
  }

  function commitWithCapsLock(text: string) {
    const prefix = startComposition(text);
    // Captured in WKWebView on macOS 15.7.8 with the system Pinyin IME.
    key('keydown', { key: 'CapsLock', code: 'CapsLock', keyCode: 20, isComposing: true });
    key('keydown', { key: 'Unidentified', code: 'Unidentified', keyCode: 0, isComposing: true });
    // The native compositionend arrived about 70ms after the unknown keydown.
    vi.advanceTimersByTime(70);
    finishComposition(text, prefix);
    key('keyup', { key: 'CapsLock', code: 'CapsLock', keyCode: 20 });
  }

  it('sends the CapsLock-committed word once', () => {
    commitWithCapsLock('good');
    expect(sent).toEqual(['good']);
  });

  it('preserves two separate commits of the same word', () => {
    commitWithCapsLock('good');
    commitWithCapsLock('good');
    expect(sent).toEqual(['good', 'good']);
  });

  it('does not resend text preceding the composition', () => {
    textarea.value = 'previous ';
    commitWithCapsLock('good');
    expect(sent).toEqual(['good']);
  });

  it.each([
    { key: ' ', code: 'Space' },
    { key: 'Enter', code: 'Enter' },
  ])('preserves candidate selection with $code', (selectionKey) => {
    const prefix = startComposition('gou');
    key('keydown', { ...selectionKey, keyCode: 229, isComposing: true });
    finishComposition('够', prefix);
    key('keyup', { ...selectionKey, keyCode: selectionKey.code === 'Space' ? 32 : 13 });
    expect(sent).toEqual(['够']);
  });

  it('keeps the next IME punctuation sent through keyCode 229', () => {
    commitWithCapsLock('good');
    key('keydown', { key: '.', code: 'Period', keyCode: 229 });
    input('insertText', '.', textarea.value + '.', false);
    vi.advanceTimersByTime(0);
    key('keyup', { key: '.', code: 'Period', keyCode: 190 });
    expect(sent).toEqual(['good', '.']);
  });

  it('keeps an independent insertText immediately after the commit', () => {
    commitWithCapsLock('good');
    input('insertText', '🙂', textarea.value + '🙂', false);
    expect(sent).toEqual(['good', '🙂']);
  });

  it('preserves ordinary English, Space, Enter, and Backspace', () => {
    for (const init of [
      { key: 'x', code: 'KeyX', keyCode: 88 },
      { key: ' ', code: 'Space', keyCode: 32 },
      { key: 'Enter', code: 'Enter', keyCode: 13 },
      { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    ]) {
      const down = key('keydown', init);
      // A browser emits keypress for printable keys only if keydown wasn't cancelled.
      if (!down.defaultPrevented && init.key.length === 1) {
        key('keypress', { ...init, charCode: init.key.charCodeAt(0) });
      }
      key('keyup', init);
    }
    expect(sent).toEqual(['x', ' ', '\r', '\x7f']);
  });

  it('does not send a cancelled composition', () => {
    const prefix = startComposition('good');
    key('keydown', { key: 'Escape', code: 'Escape', keyCode: 229, isComposing: true });
    input('deleteCompositionText', null, prefix, true);
    composition('compositionend', '');
    vi.advanceTimersByTime(0);
    expect(sent).toEqual([]);
  });
});
