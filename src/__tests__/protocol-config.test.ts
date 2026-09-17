import { describe, expect, it } from 'vitest';
import {
  getAuthMethods,
  getDefaultPort,
  getHiddenFields,
} from '../lib/protocol-config';

describe('protocol configuration', () => {
  it('maps each protocol to its default port', () => {
    expect(getDefaultPort('SSH')).toBe(22);
    expect(getDefaultPort('SFTP')).toBe(22);
    expect(getDefaultPort('FTP')).toBe(21);
  });

  it('returns the authentication methods supported by each protocol', () => {
    expect(getAuthMethods('SSH')).toEqual([
      'password',
      'publickey',
      'keyboard-interactive',
    ]);
    expect(getAuthMethods('SFTP')).toEqual(['password', 'publickey']);
    expect(getAuthMethods('FTP')).toEqual(['password', 'anonymous']);
  });

  it('only hides SSH-specific fields for non-SSH protocols', () => {
    const sshSpecificFields = [
      'compression',
      'keepAliveInterval',
      'serverAliveCountMax',
    ];

    expect(getHiddenFields('SSH')).toEqual([]);
    expect(getHiddenFields('SFTP')).toEqual(sshSpecificFields);
    expect(getHiddenFields('FTP')).toEqual(sshSpecificFields);
  });
});
