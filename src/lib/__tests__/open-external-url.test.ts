import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { isSafeExternalUrl, openExternalUrl } from '../open-external-url';

describe('isSafeExternalUrl', () => {
  it('accepts http and https, any case', () => {
    expect(isSafeExternalUrl('https://example.com/a')).toBe(true);
    expect(isSafeExternalUrl('http://localhost:3000')).toBe(true);
    expect(isSafeExternalUrl('HTTPS://Example.COM')).toBe(true);
  });

  it('rejects non-http schemes and control characters', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,hi')).toBe(false);
    expect(isSafeExternalUrl('https://example.com/\nhttps://evil')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
  });
});

describe('openExternalUrl', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it('invokes open_url for a safe url', async () => {
    await openExternalUrl('https://example.com');
    expect(invoke).toHaveBeenCalledWith('open_url', { url: 'https://example.com' });
  });

  it('does not invoke open_url for an unsafe url', async () => {
    await expect(openExternalUrl('javascript:alert(1)')).rejects.toThrow(/http/i);
    expect(invoke).not.toHaveBeenCalled();
  });
});
