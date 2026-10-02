import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { getWebSocketUrl } from '../websocket-endpoint';

describe('authenticated WebSocket endpoint', () => {
  beforeEach(() => { invoke.mockReset(); });

  it('uses the assigned port and encodes the token in the handshake URL', async () => {
    invoke.mockResolvedValue({ port: 9004, token: 'a+b/c=' });
    await expect(getWebSocketUrl()).resolves.toBe('ws://127.0.0.1:9004/?token=a%2Bb%2Fc%3D');
    expect(invoke).toHaveBeenCalledWith('get_websocket_endpoint');
  });

  it('obtains a new endpoint on every attempt instead of caching credentials', async () => {
    invoke.mockResolvedValueOnce({ port: 9001, token: 'first' });
    invoke.mockResolvedValueOnce({ port: 9002, token: 'second' });
    await expect(getWebSocketUrl()).resolves.toContain('9001/?token=first');
    await expect(getWebSocketUrl()).resolves.toContain('9002/?token=second');
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('rejects IPC failure without returning a bare URL or leaking the error', async () => {
    invoke.mockRejectedValue(new Error('secret-token-in-ipc-error'));
    await expect(getWebSocketUrl()).rejects.toThrow('Terminal bridge endpoint unavailable');
  });

  it.each([
    undefined,
    { port: 0, token: 'secret' },
    { port: 9001.5, token: 'secret' },
    { port: 9011, token: 'secret' },
    { port: 9001, token: '' },
    { port: 9001, token: '   ' },
    { port: 9001 },
  ])('rejects an unavailable or malformed endpoint: %j', async (endpoint) => {
    invoke.mockResolvedValue(endpoint);
    await expect(getWebSocketUrl()).rejects.toThrow('Terminal bridge endpoint unavailable');
  });
});
