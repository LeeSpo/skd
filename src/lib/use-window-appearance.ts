import { useEffect, useSyncExternalStore } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

export interface WindowAppearance {
  reduceTransparency: boolean;
  increaseContrast?: boolean;
  /** macOS accent colour as `#rrggbb`, or null when it cannot be resolved. */
  accentColor?: string | null;
}

const ACCENT_PATTERN = /^#[0-9a-f]{6}$/i;

/** Apply native appearance inputs to the document root. */
export function applyWindowAppearance(root: HTMLElement, state: WindowAppearance): void {
  // Increased contrast and reduced transparency both require opaque chrome.
  root.dataset.nativeMaterial = String(!state.reduceTransparency && !state.increaseContrast);
  root.dataset.reduceTransparency = String(!!state.reduceTransparency);
  root.dataset.increaseContrast = String(!!state.increaseContrast);
  if (state.accentColor && ACCENT_PATTERN.test(state.accentColor)) {
    root.style.setProperty('--system-accent', state.accentColor);
  } else {
    root.style.removeProperty('--system-accent');
  }
}

/** True when Reduce Transparency or Increase Contrast requires an opaque terminal. */
export function useBlocksTerminalTransparency(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-reduce-transparency', 'data-increase-contrast'],
      });
      return () => observer.disconnect();
    },
    () => {
      const root = document.documentElement.dataset;
      return root.reduceTransparency === 'true' || root.increaseContrast === 'true';
    },
    () => false,
  );
}

/** Keep the native material, accent colour and web chrome in the same appearance. */
export function useWindowAppearance(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.nativeMaterial = 'false';
    if (!isTauri()) return;

    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    const window = getCurrentWindow();
    const updateAppearance = (state: WindowAppearance) => {
      if (!disposed) applyWindowAppearance(root, state);
    };
    const refreshAppearance = () => invoke<WindowAppearance>('get_window_appearance').then(updateAppearance);
    const syncTheme = () => {
      // Automatic appearance must leave AppKit free to follow the system.
      const theme = root.dataset.themeMode === 'auto' ? null : root.classList.contains('dark') ? 'dark' : 'light';
      void window.setTheme(theme)
        // The accent colour resolves differently in light and dark appearances.
        .then(refreshAppearance)
        .catch(() => {
          // A failed native sync must still leave readable, opaque chrome.
          if (!disposed) root.dataset.nativeMaterial = 'false';
        });
    };
    const retainListener = (unlisten: UnlistenFn) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    };
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme-mode'] });

    // Subscribe before querying so an appearance change cannot be lost.
    void (async () => {
      try {
        retainListener(await listen<WindowAppearance>('window-appearance-changed', ({ payload }) => {
          updateAppearance(payload);
        }));
        if (disposed) return;
        await refreshAppearance();
        syncTheme();
        retainListener(await window.onFocusChanged(({ payload }) => {
          if (!disposed) root.dataset.windowActive = String(payload);
        }));
        if (!disposed) root.dataset.windowActive = String(await window.isFocused());
      } catch {
        if (!disposed) root.dataset.nativeMaterial = 'false';
      }
    })();

    return () => {
      disposed = true;
      observer.disconnect();
      unlisteners.forEach(unlisten => unlisten());
      delete root.dataset.nativeMaterial;
      delete root.dataset.windowActive;
      delete root.dataset.reduceTransparency;
      delete root.dataset.increaseContrast;
      root.style.removeProperty('--system-accent');
    };
  }, []);
}
