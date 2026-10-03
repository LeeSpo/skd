import { APP_SETTINGS_STORAGE_KEY } from './keyboard-shortcuts';

export const DEFAULT_CONNECTION_TIMEOUT_SECS = 10;
export const MIN_CONNECTION_TIMEOUT_SECS = 5;
export const MAX_CONNECTION_TIMEOUT_SECS = 120;
export const DEFAULT_KEEPALIVE_INTERVAL_SECS = 60;
export const MIN_KEEPALIVE_INTERVAL_SECS = 30;
export const MAX_KEEPALIVE_INTERVAL_SECS = 300;

function readAppSettings(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore invalid JSON. Callers fall back to defaults.
  }
  return null;
}

function clampSetting(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

export function loadConnectionTimeoutSecs(): number {
  return clampSetting(
    readAppSettings()?.connectionTimeout,
    DEFAULT_CONNECTION_TIMEOUT_SECS,
    MIN_CONNECTION_TIMEOUT_SECS,
    MAX_CONNECTION_TIMEOUT_SECS,
  );
}

export function loadKeepAliveIntervalSecs(): number {
  return clampSetting(
    readAppSettings()?.keepAliveInterval,
    DEFAULT_KEEPALIVE_INTERVAL_SECS,
    MIN_KEEPALIVE_INTERVAL_SECS,
    MAX_KEEPALIVE_INTERVAL_SECS,
  );
}

/** Missing or unreadable settings stay on, matching the previous always-on behavior. */
export function isAutoReconnectEnabled(): boolean {
  return readAppSettings()?.autoReconnect !== false;
}

/** A dropped session reconnects only when the setting is on. */
export function shouldReconnectAfterDrop(autoReconnectEnabled: boolean): boolean {
  return autoReconnectEnabled;
}
