import { useSyncExternalStore } from 'react';

const cwdByConnection = new Map<string, string>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

/**
 * Parse the OSC 7 payload emitted by shell integrations.
 *
 * Expected form: file://hostname/absolute/path. The hostname is deliberately
 * ignored: the connection id already scopes the path to the correct PTY/SFTP
 * session and some shells report aliases rather than the configured SSH host.
 */
export function parseOsc7Cwd(payload: string): string | null {
  if (payload.length === 0 || payload.length > 4096 || containsControlCharacter(payload)) {
    return null;
  }

  try {
    const url = new URL(payload);
    if (url.protocol !== 'file:') return null;

    const path = decodeURIComponent(url.pathname);
    if (!path.startsWith('/') || containsControlCharacter(path)) return null;
    return path || '/';
  } catch {
    return null;
  }
}

/** Parse iTerm-style OSC 1337 CurrentDir reports as a compatibility fallback. */
export function parseOsc1337Cwd(payload: string): string | null {
  const prefix = 'CurrentDir=';
  if (!payload.startsWith(prefix)) return null;

  const encodedPath = payload.slice(prefix.length);
  if (encodedPath.length === 0 || encodedPath.length > 4096) return null;

  try {
    const path = decodeURIComponent(encodedPath);
    if (!path.startsWith('/') || containsControlCharacter(path)) return null;
    return path;
  } catch {
    return null;
  }
}

/** Parse VS Code-compatible OSC 633 Cwd property reports. */
export function parseOsc633Cwd(payload: string): string | null {
  const prefix = 'P;Cwd=';
  if (!payload.startsWith(prefix)) return null;

  const encodedPath = payload.slice(prefix.length);
  if (encodedPath.length === 0 || encodedPath.length > 4096) return null;

  try {
    const path = decodeURIComponent(encodedPath);
    if (!path.startsWith('/') || containsControlCharacter(path)) return null;
    return path;
  } catch {
    return null;
  }
}

export function publishTerminalCwd(connectionId: string, path: string): void {
  if (!connectionId || cwdByConnection.get(connectionId) === path) return;
  cwdByConnection.set(connectionId, path);
  notifyListeners();
}

export function clearTerminalCwd(connectionId: string): void {
  if (!cwdByConnection.delete(connectionId)) return;
  notifyListeners();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTerminalCwd(connectionId: string | undefined): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => connectionId ? cwdByConnection.get(connectionId) : undefined,
    () => undefined,
  );
}
