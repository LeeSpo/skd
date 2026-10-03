import { useEffect } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface WindowAccessibility {
  reduceTransparency: boolean;
}

/** Keep the native material and web chrome in the same appearance. */
export function useWindowAppearance(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.nativeMaterial = 'false';
    if (!isTauri()) return;

    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    const window = getCurrentWindow();
    const updateAccessibility = (state: WindowAccessibility) => {
      if (!disposed) root.dataset.nativeMaterial = String(!state.reduceTransparency);
    };
    const syncTheme = () => {
      // Automatic appearance must leave AppKit free to follow the system.
      const theme = root.dataset.themeMode === 'auto' ? null : root.classList.contains('dark') ? 'dark' : 'light';
      void window.setTheme(theme).catch(() => {
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

    // Subscribe before querying so an accessibility change cannot be lost.
    void (async () => {
      try {
        retainListener(await listen<WindowAccessibility>('window-accessibility-changed', ({ payload }) => {
          updateAccessibility(payload);
        }));
        if (disposed) return;
        updateAccessibility(await invoke<WindowAccessibility>('get_window_accessibility'));
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
    };
  }, []);
}
