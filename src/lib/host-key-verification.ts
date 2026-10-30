import { APP_SETTINGS_STORAGE_KEY } from './keyboard-shortcuts';

export const UNKNOWN_HOST_KEY_PREFIX = 'UNKNOWN_HOST_KEY:';
export const HOST_KEY_MISMATCH_PREFIX = 'HOST_KEY_MISMATCH:';

export interface UnknownHostKeyPayload {
  host: string;
  port: number;
  fingerprint: string;
  keyType: string;
  keyData: string;
  /** True when this host was already saved and the server key differs. */
  changed: boolean;
  expectedFingerprint?: string;
}

export function isHostKeyVerificationEnabled(): boolean {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) return true;
    const settings = JSON.parse(raw) as { hostKeyVerification?: boolean };
    return settings.hostKeyVerification ?? true;
  } catch {
    return true;
  }
}

export function isUnknownHostKeyError(error: string): boolean {
  return parseUnknownHostKeyError(error) !== null;
}

export function isHostKeyTrustPrompt(error: string): boolean {
  return parseHostKeyTrustError(error) !== null;
}

export function parseHostKeyTrustError(error: string): UnknownHostKeyPayload | null {
  return parsePrefixedHostKey(error, HOST_KEY_MISMATCH_PREFIX, true)
    ?? parsePrefixedHostKey(error, UNKNOWN_HOST_KEY_PREFIX, false);
}

export function parseUnknownHostKeyError(error: string): UnknownHostKeyPayload | null {
  return parsePrefixedHostKey(error, UNKNOWN_HOST_KEY_PREFIX, false);
}

function parsePrefixedHostKey(
  error: string,
  prefix: string,
  changed: boolean,
): UnknownHostKeyPayload | null {
  const index = error.indexOf(prefix);
  if (index === -1) return null;

  const jsonPart = error.slice(index + prefix.length).trim();
  try {
    const payload = JSON.parse(jsonPart) as UnknownHostKeyPayload;
    if (!payload.host || !payload.keyType || !payload.keyData) {
      return null;
    }
    return {
      host: payload.host,
      port: payload.port,
      fingerprint: payload.fingerprint,
      keyType: payload.keyType,
      keyData: payload.keyData,
      changed,
      ...(typeof payload.expectedFingerprint === 'string' && payload.expectedFingerprint
        ? { expectedFingerprint: payload.expectedFingerprint }
        : {}),
    };
  } catch {
    return null;
  }
}