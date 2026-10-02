import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  createLayoutShortcuts,
  createSplitViewShortcuts,
  DEFAULT_SPLIT_VIEW_SHORTCUTS,
  KeyboardShortcut,
  loadKeyboardShortcutSettings,
  parseKeyboardShortcut,
  useKeyboardShortcuts,
} from '../lib/keyboard-shortcuts';

function createMockActions() {
  return {
    splitRight: vi.fn(),
    splitDown: vi.fn(),
    focusGroup: vi.fn(),
    closeTab: vi.fn(),
    nextTab: vi.fn(),
    prevTab: vi.fn(),
  };
}

function findShortcut(
  shortcuts: KeyboardShortcut[],
  key: string,
  opts: { ctrlKey?: boolean; shiftKey?: boolean } = {},
): KeyboardShortcut | undefined {
  return shortcuts.find(
    (s) =>
      s.key === key &&
      (opts.ctrlKey === undefined || s.ctrlKey === opts.ctrlKey) &&
      (opts.shiftKey === undefined || s.shiftKey === opts.shiftKey),
  );
}

describe('createSplitViewShortcuts', () => {
  // Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7

  // Requirement 5.1: Ctrl+\ splits right
  it('Ctrl+\\ triggers splitRight', () => {
    const actions = createMockActions();
    const shortcuts = createSplitViewShortcuts(actions);
    const shortcut = findShortcut(shortcuts, '\\', { ctrlKey: true, shiftKey: false });

    expect(shortcut).toBeDefined();
    shortcut!.handler();
    expect(actions.splitRight).toHaveBeenCalledOnce();
  });

  // Requirement 5.7: Ctrl+Shift+\ splits down
  it('Ctrl+Shift+\\ triggers splitDown', () => {
    const actions = createMockActions();
    const shortcuts = createSplitViewShortcuts(actions);
    const shortcut = findShortcut(shortcuts, '\\', { ctrlKey: true, shiftKey: true });

    expect(shortcut).toBeDefined();
    shortcut!.handler();
    expect(actions.splitDown).toHaveBeenCalledOnce();
  });

  // Requirement 5.2: Ctrl+1~9 focuses group by index (0-based)
  describe('Ctrl+1~9 focus group shortcuts', () => {
    it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
      'Ctrl+%i calls focusGroup with 0-based index',
      (digit) => {
        const actions = createMockActions();
        const shortcuts = createSplitViewShortcuts(actions);
        const shortcut = findShortcut(shortcuts, String(digit), { ctrlKey: true, shiftKey: false });

        shortcut!.handler();
        expect(actions.focusGroup).toHaveBeenCalledWith(digit - 1);
      },
    );
  });

  // Requirement 5.3: Ctrl+Shift+W closes active tab without stealing bash Ctrl+W
  it('Ctrl+Shift+W triggers closeTab by default', () => {
    const actions = createMockActions();
    const shortcuts = createSplitViewShortcuts(actions);
    const shortcut = findShortcut(shortcuts, 'w', { ctrlKey: true, shiftKey: true });

    expect(shortcut).toBeDefined();
    shortcut!.handler();
    expect(actions.closeTab).toHaveBeenCalledOnce();
  });

  it('does not bind Ctrl+W to closeTab by default', () => {
    const actions = createMockActions();
    const shortcuts = createSplitViewShortcuts(actions);
    const shortcut = findShortcut(shortcuts, 'w', { ctrlKey: true, shiftKey: false });

    expect(shortcut).toBeUndefined();
  });

  it('uses a custom closeTab shortcut when provided', () => {
    const actions = createMockActions();
    const shortcuts = createSplitViewShortcuts(actions, { closeTab: 'Alt+W' });
    const shortcut = shortcuts.find(
      (s) => s.key === 'w' && s.altKey === true && s.ctrlKey === false && s.shiftKey === false,
    );

    expect(shortcut).toBeDefined();
    shortcut!.handler();
    expect(actions.closeTab).toHaveBeenCalledOnce();
  });

  // Requirement 5.4: Ctrl+Tab switches to next tab
  it('Ctrl+Tab triggers nextTab', () => {
    const actions = createMockActions();
    const shortcuts = createSplitViewShortcuts(actions);
    const shortcut = findShortcut(shortcuts, 'Tab', { ctrlKey: true, shiftKey: false });

    expect(shortcut).toBeDefined();
    shortcut!.handler();
    expect(actions.nextTab).toHaveBeenCalledOnce();
  });

  // Requirement 5.5: Ctrl+Shift+Tab switches to previous tab
  it('Ctrl+Shift+Tab triggers prevTab', () => {
    const actions = createMockActions();
    const shortcuts = createSplitViewShortcuts(actions);
    const shortcut = findShortcut(shortcuts, 'Tab', { ctrlKey: true, shiftKey: true });

    expect(shortcut).toBeDefined();
    shortcut!.handler();
    expect(actions.prevTab).toHaveBeenCalledOnce();
  });

});

describe('useKeyboardShortcuts', () => {
  afterEach(() => {
    cleanup();
  });

  function ShortcutHarness({ shortcuts }: { shortcuts: KeyboardShortcut[] }) {
    useKeyboardShortcuts(shortcuts);
    return null;
  }

  it('does not intercept terminal Ctrl+B for layout shortcuts', () => {
    const actions = {
      toggleLeftSidebar: vi.fn(),
      toggleRightSidebar: vi.fn(),
      toggleBottomPanel: vi.fn(),
      toggleZenMode: vi.fn(),
    };
    const shortcuts = createLayoutShortcuts(actions);
    render(React.createElement(ShortcutHarness, { shortcuts }));

    const xterm = document.createElement('div');
    xterm.className = 'xterm';
    const textarea = document.createElement('textarea');
    xterm.appendChild(textarea);
    document.body.appendChild(xterm);

    const event = new KeyboardEvent('keydown', {
      key: 'b',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const wasNotPrevented = textarea.dispatchEvent(event);

    expect(wasNotPrevented).toBe(true);
    expect(actions.toggleLeftSidebar).not.toHaveBeenCalled();
  });

  it('still handles layout Ctrl+B outside the terminal', () => {
    const actions = {
      toggleLeftSidebar: vi.fn(),
      toggleRightSidebar: vi.fn(),
      toggleBottomPanel: vi.fn(),
      toggleZenMode: vi.fn(),
    };
    const shortcuts = createLayoutShortcuts(actions);
    render(React.createElement(ShortcutHarness, { shortcuts }));

    const button = document.createElement('button');
    document.body.appendChild(button);

    const event = new KeyboardEvent('keydown', {
      key: 'b',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const wasNotPrevented = button.dispatchEvent(event);

    expect(wasNotPrevented).toBe(false);
    expect(actions.toggleLeftSidebar).toHaveBeenCalledOnce();
  });
});

describe('keyboard shortcut settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('parses shortcut strings with modifiers', () => {
    expect(parseKeyboardShortcut('Ctrl+Shift+W')).toEqual({
      key: 'w',
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    });
  });

  it('loads saved keyboard shortcuts from sshClientSettings', () => {
    localStorage.setItem('sshClientSettings', JSON.stringify({
      closeSession: 'Alt+W',
      nextTab: 'Ctrl+PageDown',
      previousTab: 'Ctrl+PageUp',
    }));

    expect(loadKeyboardShortcutSettings()).toEqual({
      closeTab: 'Alt+W',
      nextTab: 'Ctrl+PageDown',
      prevTab: 'Ctrl+PageUp',
    });
  });

  it('migrates the legacy Ctrl+W close shortcut to the new default', () => {
    localStorage.setItem('sshClientSettings', JSON.stringify({
      closeSession: 'Ctrl+W',
    }));

    expect(loadKeyboardShortcutSettings().closeTab).toBe(DEFAULT_SPLIT_VIEW_SHORTCUTS.closeTab);
  });
});
