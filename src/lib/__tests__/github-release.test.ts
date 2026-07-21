import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseSemver,
  isNewerVersion,
  fetchLatestRelease,
  checkForGithubUpdate,
} from '../github-release';

describe('parseSemver', () => {
  it('parses plain and v-prefixed versions', () => {
    expect(parseSemver('0.2.1')).toEqual([0, 2, 1]);
    expect(parseSemver('v0.2.1')).toEqual([0, 2, 1]);
    expect(parseSemver('V1.0.0')).toEqual([1, 0, 0]);
  });

  it('ignores prerelease / build suffixes after the core triple', () => {
    expect(parseSemver('1.2.3-beta.1')).toEqual([1, 2, 3]);
    expect(parseSemver('v2.0.0+build')).toEqual([2, 0, 0]);
  });

  it('returns null for invalid input', () => {
    expect(parseSemver('')).toBeNull();
    expect(parseSemver('latest')).toBeNull();
    expect(parseSemver('1.2')).toBeNull();
  });
});

describe('isNewerVersion', () => {
  it('detects major / minor / patch bumps', () => {
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.3.0', '0.2.9')).toBe(true);
    expect(isNewerVersion('0.2.2', '0.2.1')).toBe(true);
  });

  it('returns false for equal or older versions', () => {
    expect(isNewerVersion('0.2.1', '0.2.1')).toBe(false);
    expect(isNewerVersion('v0.2.1', '0.2.1')).toBe(false);
    expect(isNewerVersion('0.1.9', '0.2.0')).toBe(false);
  });

  it('returns false when either side is unparseable', () => {
    expect(isNewerVersion('nope', '0.2.1')).toBe(false);
    expect(isNewerVersion('0.2.1', 'nope')).toBe(false);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchLatestRelease', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps a successful GitHub payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        tag_name: 'v0.3.0',
        name: 'skd v0.3.0',
        body: 'Notes',
        html_url: 'https://github.com/LeeSpo/skd/releases/tag/v0.3.0',
      }),
    );

    const release = await fetchLatestRelease(fetchImpl);
    expect(release).toEqual({
      tagName: 'v0.3.0',
      name: 'skd v0.3.0',
      body: 'Notes',
      htmlUrl: 'https://github.com/LeeSpo/skd/releases/tag/v0.3.0',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/repos/LeeSpo/skd/releases/latest'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/vnd.github+json',
        }),
      }),
    );
  });

  it('throws a friendly error on 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    await expect(fetchLatestRelease(fetchImpl)).rejects.toThrow(/No releases found/);
  });

  it('throws a friendly error on rate limit (403)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 403));
    await expect(fetchLatestRelease(fetchImpl)).rejects.toThrow(/rate limit/i);
  });

  it('throws when the network fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchLatestRelease(fetchImpl)).rejects.toThrow(/Could not reach GitHub/);
  });

  it('throws when tag_name is missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ html_url: 'https://github.com/LeeSpo/skd/releases/tag/x' }),
    );
    await expect(fetchLatestRelease(fetchImpl)).rejects.toThrow(/missing a version tag/);
  });
});

describe('checkForGithubUpdate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns up-to-date when remote is equal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        tag_name: 'v0.2.1',
        name: 'skd v0.2.1',
        body: null,
        html_url: 'https://github.com/LeeSpo/skd/releases/tag/v0.2.1',
      }),
    );

    const result = await checkForGithubUpdate('0.2.1', fetchImpl);
    expect(result).toEqual({
      status: 'up-to-date',
      currentVersion: '0.2.1',
      latestVersion: '0.2.1',
    });
  });

  it('returns available when remote is newer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        tag_name: 'v0.3.0',
        name: 'skd v0.3.0',
        body: 'Changelog body',
        html_url: 'https://github.com/LeeSpo/skd/releases/tag/v0.3.0',
      }),
    );

    const result = await checkForGithubUpdate('0.2.1', fetchImpl);
    expect(result).toEqual({
      status: 'available',
      currentVersion: '0.2.1',
      latestVersion: '0.3.0',
      htmlUrl: 'https://github.com/LeeSpo/skd/releases/tag/v0.3.0',
      body: 'Changelog body',
      name: 'skd v0.3.0',
    });
  });

  it('returns error result instead of throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('offline'));
    const result = await checkForGithubUpdate('0.2.1', fetchImpl);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toMatch(/Could not reach GitHub/);
    }
  });
});
