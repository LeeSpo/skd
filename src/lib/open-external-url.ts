import { invoke } from '@tauri-apps/api/core';

export function isSafeExternalUrl(url: string): boolean {
  if (/[\r\n\0]/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isSafeExternalUrl(url)) {
    throw new Error('Only http(s) URLs can be opened');
  }
  await invoke('open_url', { url });
}
