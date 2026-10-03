import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import {
  applyWindowAppearance,
  useWindowAppearance,
  type WindowAppearance,
} from '../use-window-appearance';

// ---- Tauri mocks ---------------------------------------------------------
// The event mock captures the pushed-appearance handler and counts unlisten
// calls so the hook's subscription lifecycle can be asserted.

type Handler = (event: { payload: WindowAppearance }) => void;
let capturedHandler: Handler | null = null;
let unlistenCount = 0;

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn(() =>
    Promise.resolve({
      reduceTransparency: false,
      increaseContrast: false,
      accentColor: '#007aff',
    }),
  ),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_event: string, handler: Handler) => {
    capturedHandler = handler;
    return Promise.resolve(() => {
      unlistenCount += 1;
      if (capturedHandler === handler) capturedHandler = null;
    });
  }),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setTheme: vi.fn(() => Promise.resolve()),
    onFocusChanged: vi.fn(() => Promise.resolve(() => {})),
    isFocused: vi.fn(() => Promise.resolve(true)),
  }),
}));

function HookProbe() {
  useWindowAppearance();
  return null;
}

describe('window appearance bridge', () => {
  const root = document.documentElement;

  beforeEach(() => {
    capturedHandler = null;
    unlistenCount = 0;
    delete root.dataset.nativeMaterial;
    delete root.dataset.increaseContrast;
    delete root.dataset.windowActive;
    root.style.removeProperty('--system-accent');
  });

  afterEach(() => {
    cleanup();
  });

  it('applies the accent colour and material flags to the document root', () => {
    applyWindowAppearance(root, {
      reduceTransparency: false,
      increaseContrast: false,
      accentColor: '#007AFF',
    });
    expect(root.dataset.nativeMaterial).toBe('true');
    expect(root.dataset.increaseContrast).toBe('false');
    expect(root.style.getPropertyValue('--system-accent')).toBe('#007AFF');
  });

  it('forces opaque chrome when transparency is reduced or contrast is increased', () => {
    applyWindowAppearance(root, {
      reduceTransparency: true,
      increaseContrast: false,
      accentColor: '#007aff',
    });
    expect(root.dataset.nativeMaterial).toBe('false');

    applyWindowAppearance(root, {
      reduceTransparency: false,
      increaseContrast: true,
      accentColor: '#007aff',
    });
    expect(root.dataset.nativeMaterial).toBe('false');
    expect(root.dataset.increaseContrast).toBe('true');
  });

  it('drops an unresolvable accent colour instead of keeping a stale one', () => {
    applyWindowAppearance(root, {
      reduceTransparency: false,
      increaseContrast: false,
      accentColor: '#007aff',
    });
    expect(root.style.getPropertyValue('--system-accent')).toBe('#007aff');

    applyWindowAppearance(root, {
      reduceTransparency: false,
      increaseContrast: false,
      accentColor: 'systemBlue',
    });
    expect(root.style.getPropertyValue('--system-accent')).toBe('');
  });

  it('queries the native appearance on mount and cleans up on unmount', async () => {
    const { unmount } = render(createElement(HookProbe));
    await waitFor(() => expect(root.dataset.nativeMaterial).toBe('true'));
    expect(root.style.getPropertyValue('--system-accent')).toBe('#007aff');
    expect(capturedHandler).not.toBeNull();

    unmount();
    expect(unlistenCount).toBe(1);
    expect(root.dataset.nativeMaterial).toBeUndefined();
    expect(root.dataset.increaseContrast).toBeUndefined();
    expect(root.style.getPropertyValue('--system-accent')).toBe('');
  });

  it('applies appearance updates pushed from the native side', async () => {
    render(createElement(HookProbe));
    await waitFor(() => expect(root.dataset.nativeMaterial).toBe('true'));

    act(() => {
      capturedHandler!({
        payload: {
          reduceTransparency: true,
          increaseContrast: false,
          accentColor: '#ff0000',
        },
      });
    });
    expect(root.dataset.nativeMaterial).toBe('false');
    expect(root.style.getPropertyValue('--system-accent')).toBe('#ff0000');
  });
});
