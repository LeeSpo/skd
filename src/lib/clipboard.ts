import { invoke, isTauri } from '@tauri-apps/api/core';

/** Use the native pasteboard on desktop to avoid WebKit clipboard restrictions. */
export async function writeClipboardText(text: string): Promise<void> {
  if (isTauri()) {
    await invoke('write_clipboard_text', { text });
  } else {
    await navigator.clipboard.writeText(text);
  }
}

/** Explicit user paste only; remote terminal queries must not use this bridge. */
export async function readClipboardText(): Promise<string> {
  if (isTauri()) {
    return invoke<string>('read_clipboard_text');
  }
  return navigator.clipboard.readText();
}
