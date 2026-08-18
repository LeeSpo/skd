import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  sftpConnectWithHostKeyTrust,
  sshConnectWithHostKeyTrust,
  type SshConnectParams,
} from '../ssh-connect';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

const publicKeyParams: SshConnectParams = {
  connection_id: 'public-key-connection',
  host: 'example.com',
  port: 22,
  username: 'user',
  auth_method: 'publickey',
  key_content: '<REDACTED>',
  passphrase: '<REDACTED>',
};

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ success: true });
});

describe('public-key connection requests', () => {
  it('submits one SSH authentication request', async () => {
    await sshConnectWithHostKeyTrust(publicKeyParams, vi.fn());

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[0]).toBe('ssh_connect');
  });

  it('submits one SFTP authentication request', async () => {
    await sftpConnectWithHostKeyTrust(publicKeyParams, vi.fn());

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[0]).toBe('sftp_connect');
  });
});
