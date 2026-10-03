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
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({
      request: {
        tcp_timeout_secs: 10,
        keepalive_interval_secs: 60,
      },
    });
  });

  it('sends a saved connection timeout and keepalive interval', async () => {
    localStorage.setItem('sshClientSettings', JSON.stringify({
      connectionTimeout: 30,
      keepAliveInterval: 120,
    }));

    await sshConnectWithHostKeyTrust(publicKeyParams, vi.fn());

    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({
      request: {
        tcp_timeout_secs: 30,
        keepalive_interval_secs: 120,
      },
    });
  });

  it('submits one SFTP authentication request', async () => {
    await sftpConnectWithHostKeyTrust(publicKeyParams, vi.fn());

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[0]).toBe('sftp_connect');
  });
});
