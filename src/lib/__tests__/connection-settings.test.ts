import { beforeEach, describe, expect, it } from 'vitest';
import {
  isAutoReconnectEnabled,
  loadConnectionTimeoutSecs,
  loadKeepAliveIntervalSecs,
  shouldReconnectAfterDrop,
} from '../connection-settings';

beforeEach(() => {
  localStorage.clear();
});

describe('connection settings', () => {
  it('defaults the timeout to 10 seconds and keepalive to 60', () => {
    expect(loadConnectionTimeoutSecs()).toBe(10);
    expect(loadKeepAliveIntervalSecs()).toBe(60);
    expect(isAutoReconnectEnabled()).toBe(true);
  });

  it('reads saved timing values and keeps them in range', () => {
    localStorage.setItem('sshClientSettings', JSON.stringify({
      connectionTimeout: 30,
      keepAliveInterval: 1,
      autoReconnect: false,
    }));

    expect(loadConnectionTimeoutSecs()).toBe(30);
    expect(loadKeepAliveIntervalSecs()).toBe(30);
    expect(isAutoReconnectEnabled()).toBe(false);
    expect(shouldReconnectAfterDrop(false)).toBe(false);
    expect(shouldReconnectAfterDrop(true)).toBe(true);
  });
});
