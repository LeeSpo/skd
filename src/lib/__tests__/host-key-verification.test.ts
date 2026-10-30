import { describe, expect, it } from 'vitest';
import {
  HOST_KEY_MISMATCH_PREFIX,
  isHostKeyTrustPrompt,
  isUnknownHostKeyError,
  parseHostKeyTrustError,
  parseUnknownHostKeyError,
  UNKNOWN_HOST_KEY_PREFIX,
} from '../host-key-verification';

describe('host-key-verification', () => {
  it('parses unknown host key payload from wrapped connection error', () => {
    const error =
      'Failed to connect to 10.0.0.1:22: UNKNOWN_HOST_KEY:{"host":"10.0.0.1","port":22,"fingerprint":"abc","keyType":"ssh-ed25519","keyData":"AAAAC3NzaC1lZDI1NTE5AAAAI"}';

    const payload = parseUnknownHostKeyError(error);
    expect(payload).toEqual({
      host: '10.0.0.1',
      port: 22,
      fingerprint: 'abc',
      keyType: 'ssh-ed25519',
      keyData: 'AAAAC3NzaC1lZDI1NTE5AAAAI',
      changed: false,
    });
  });

  it('parses a changed host key as a trust prompt with both fingerprints', () => {
    const error = `${HOST_KEY_MISMATCH_PREFIX}${JSON.stringify({
      host: '172.93.221.146',
      port: 22,
      fingerprint: 'SHA256:new',
      keyType: 'ssh-ed25519',
      keyData: 'AAAAC3NzaC1lZDI1NTE5AAAAINew',
      expectedFingerprint: 'SHA256:old',
    })}`;

    expect(isUnknownHostKeyError(error)).toBe(false);
    expect(isHostKeyTrustPrompt(error)).toBe(true);
    expect(parseHostKeyTrustError(error)).toEqual({
      host: '172.93.221.146',
      port: 22,
      fingerprint: 'SHA256:new',
      keyType: 'ssh-ed25519',
      keyData: 'AAAAC3NzaC1lZDI1NTE5AAAAINew',
      changed: true,
      expectedFingerprint: 'SHA256:old',
    });
  });

  it('detects unknown host key errors', () => {
    const error = `${UNKNOWN_HOST_KEY_PREFIX}{"host":"h","port":22,"fingerprint":"f","keyType":"ssh-ed25519","keyData":"d"}`;
    expect(isUnknownHostKeyError(error)).toBe(true);
  });

  it('returns false for regular auth failures', () => {
    expect(isUnknownHostKeyError('Password authentication failed')).toBe(false);
  });
});