import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import en from '@/locales/en.json';

/** Keys used by the native macOS menu bar */
const NATIVE_MENU_KEYS = [
  'menuBar.file', 'menuBar.edit', 'menuBar.tools', 'menuBar.connection', 'menuBar.window',
  'menuBar.newConnection', 'menuBar.newLocalTerminal', 'menuBar.saveConnection', 'menuBar.closeTab',
  'menuBar.find', 'menuBar.clearScreen',
  'menuBar.options', 'menuBar.checkForUpdates',
  'menuBar.newTab', 'menuBar.duplicateTab', 'menuBar.nextTab', 'menuBar.previousTab',
  'menuBar.reconnect', 'menuBar.disconnect',
  'menuBar.undo', 'menuBar.redo', 'menuBar.cut', 'menuBar.copy', 'menuBar.paste', 'menuBar.selectAll',
  'menuBar.minimize', 'menuBar.zoom', 'menuBar.fullscreen',
] as const;

/**
 * Type-safe translation lookup for native menu keys.
 * Uses the en.json resource type to constrain keys, avoiding the unsafe `as never` cast.
 */
function menuTranslation(key: typeof NATIVE_MENU_KEYS[number]): string {
  return i18n.t(key);
}

/** Push translated menu labels to the native macOS menu bar via Tauri IPC. */
async function syncNativeMenu(): Promise<void> {
  try {
    const translations: Record<string, string> = {};
    for (const key of NATIVE_MENU_KEYS) {
      translations[key] = menuTranslation(key);
    }
    await invoke('update_menu_language', { translations });
  } catch (e) {
    // Expected on non-macOS or when the Tauri bridge is unavailable
    console.warn('[i18n] Native menu sync skipped:', e);
  }
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

void syncNativeMenu();

export default i18n;