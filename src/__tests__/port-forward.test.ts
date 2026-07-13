import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultLocalBindHost,
  defaultRemoteHost,
  formatForwardSummary,
  listLocalForwards,
  startLocalForward,
  stopLocalForward,
  testLocalForward,
  validateLocalForwardForm,
} from '@/lib/port-forward';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

beforeEach(() => {
  invokeMock.mockReset();
});

describe('port-forward helpers', () => {
  it('provides safe defaults', () => {
    expect(defaultLocalBindHost()).toBe('127.0.0.1');
    expect(defaultRemoteHost()).toBe('localhost');
  });

  it('formats local → remote summary', () => {
    expect(
      formatForwardSummary({
        local_bind_host: '127.0.0.1',
        local_port: 18080,
        remote_host: 'localhost',
        remote_port: 5432,
      }),
    ).toBe('127.0.0.1:18080 → localhost:5432');
  });

  it('validates required fields', () => {
    expect(
      validateLocalForwardForm({
        localBindHost: '',
        localPort: 8080,
        remoteHost: 'localhost',
        remotePort: 80,
      }),
    ).toBe('localBindHostRequired');

    expect(
      validateLocalForwardForm({
        localBindHost: '127.0.0.1',
        localPort: -1,
        remoteHost: 'localhost',
        remotePort: 80,
      }),
    ).toBe('localPortInvalid');

    expect(
      validateLocalForwardForm({
        localBindHost: '127.0.0.1',
        localPort: 0,
        remoteHost: '',
        remotePort: 80,
      }),
    ).toBe('remoteHostRequired');

    expect(
      validateLocalForwardForm({
        localBindHost: '127.0.0.1',
        localPort: 8080,
        remoteHost: 'localhost',
        remotePort: 0,
      }),
    ).toBe('remotePortInvalid');

    expect(
      validateLocalForwardForm({
        localBindHost: '127.0.0.1',
        localPort: 0,
        remoteHost: 'localhost',
        remotePort: 5432,
      }),
    ).toBeNull();
  });
});

describe('port-forward IPC argument names', () => {
  it('lists forwards with camelCase connectionId (Tauri bridge convention)', async () => {
    invokeMock.mockResolvedValueOnce([]);
    await listLocalForwards('conn-1');
    expect(invokeMock).toHaveBeenCalledWith('ssh_list_local_forwards', {
      connectionId: 'conn-1',
    });
  });

  it('stops a forward with camelCase connectionId and forwardId', async () => {
    invokeMock.mockResolvedValueOnce({ success: true });
    await stopLocalForward('conn-1', 'pf-1');
    expect(invokeMock).toHaveBeenCalledWith('ssh_stop_local_forward', {
      connectionId: 'conn-1',
      forwardId: 'pf-1',
    });
  });

  it('starts a forward via request payload with serde field names', async () => {
    invokeMock.mockResolvedValueOnce({
      id: 'pf-1',
      connection_id: 'conn-1',
      local_bind_host: '127.0.0.1',
      local_port: 8080,
      remote_host: 'localhost',
      remote_port: 5432,
      local_status: 'listening',
      target_status: 'reachable',
    });
    await startLocalForward({
      connection_id: 'conn-1',
      local_port: 8080,
      remote_host: 'localhost',
      remote_port: 5432,
    });
    expect(invokeMock).toHaveBeenCalledWith('ssh_start_local_forward', {
      request: {
        connection_id: 'conn-1',
        bookmark_id: undefined,
        name: undefined,
        local_bind_host: undefined,
        local_port: 8080,
        remote_host: 'localhost',
        remote_port: 5432,
      },
    });
  });

  it('throws when stop reports failure', async () => {
    invokeMock.mockResolvedValueOnce({ success: false, error: 'not found' });
    await expect(stopLocalForward('conn-1', 'pf-missing')).rejects.toThrow('not found');
  });

  it('tests a forward with camelCase identifiers', async () => {
    invokeMock.mockResolvedValueOnce({
      id: 'pf-1',
      connection_id: 'conn-1',
      local_status: 'listening',
      target_status: 'reachable',
    });
    await testLocalForward('conn-1', 'pf-1');
    expect(invokeMock).toHaveBeenCalledWith('ssh_test_local_forward', {
      connectionId: 'conn-1',
      forwardId: 'pf-1',
    });
  });
});
