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

function isValidAbsolutePath(path: string): boolean {
  return path.length > 0
    && path.length <= 4096
    && path.startsWith('/')
    && !containsControlCharacter(path);
}

/** Decode the escaping used by OSC 633 property values. */
export function decodeOsc633Value(value: string): string | null {
  if (value.length === 0 || value.length > 4096 || containsControlCharacter(value)) {
    return null;
  }

  let decoded = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '\\') {
      decoded += character;
      continue;
    }

    const next = value[index + 1];
    if (next === '\\') {
      decoded += '\\';
      index += 1;
      continue;
    }
    if (next === 'x' && /^[0-9a-fA-F]{2}$/.test(value.slice(index + 2, index + 4))) {
      decoded += String.fromCharCode(Number.parseInt(value.slice(index + 2, index + 4), 16));
      index += 3;
      continue;
    }
    return null;
  }

  return containsControlCharacter(decoded) ? null : decoded;
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
    if (!isValidAbsolutePath(path)) return null;
    return path || '/';
  } catch {
    return null;
  }
}

/** Parse iTerm-style OSC 1337 CurrentDir reports as a compatibility fallback. */
export function parseOsc1337Cwd(payload: string): string | null {
  const prefix = 'CurrentDir=';
  if (!payload.startsWith(prefix)) return null;

  const path = payload.slice(prefix.length);
  return isValidAbsolutePath(path) ? path : null;
}

/** Parse VS Code-compatible OSC 633 Cwd property reports. */
export function parseOsc633Cwd(payload: string): string | null {
  const prefix = 'P;Cwd=';
  if (!payload.startsWith(prefix)) return null;

  const path = decodeOsc633Value(payload.slice(prefix.length));
  return path && isValidAbsolutePath(path) ? path : null;
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
