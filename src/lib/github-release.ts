/** Public GitHub repo used for “Check for Updates”. */
export const GITHUB_RELEASES = {
  owner: 'LeeSpo',
  repo: 'skd',
} as const;

const LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_RELEASES.owner}/${GITHUB_RELEASES.repo}/releases/latest`;

export interface GithubRelease {
  tagName: string;
  name: string | null;
  body: string | null;
  htmlUrl: string;
}

export type UpdateCheckResult =
  | { status: 'up-to-date'; currentVersion: string; latestVersion: string }
  | {
      status: 'available';
      currentVersion: string;
      latestVersion: string;
      htmlUrl: string;
      body: string | null;
      name: string | null;
    }
  | { status: 'error'; message: string };

/** Parse a version string like `v0.2.1` or `0.2.1` into [major, minor, patch]. */
export function parseSemver(version: string): [number, number, number] | null {
  const cleaned = version.trim().replace(/^[vV]/, '');
  // Allow optional pre-release / build suffix after the core triple
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `latest` is a higher semver than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

interface GithubReleaseApiResponse {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
}

function mapHttpError(status: number, statusText: string): string {
  if (status === 404) {
    return 'No releases found on GitHub for this project.';
  }
  if (status === 403) {
    return 'GitHub rate limit exceeded. Please try again later.';
  }
  if (status >= 500) {
    return 'GitHub is temporarily unavailable. Please try again later.';
  }
  return `GitHub returned ${status}${statusText ? ` ${statusText}` : ''}.`;
}

/** Fetch the latest published (non-draft, non-prerelease) release from GitHub. */
export async function fetchLatestRelease(
  fetchImpl: typeof fetch = fetch,
): Promise<GithubRelease> {
  let response: Response;
  try {
    response = await fetchImpl(LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch {
    throw new Error('Could not reach GitHub. Check your internet connection.');
  }

  if (!response.ok) {
    throw new Error(mapHttpError(response.status, response.statusText));
  }

  let data: GithubReleaseApiResponse;
  try {
    data = (await response.json()) as GithubReleaseApiResponse;
  } catch {
    throw new Error('Invalid response from GitHub.');
  }

  if (typeof data.tag_name !== 'string' || !data.tag_name.trim()) {
    throw new Error('GitHub release is missing a version tag.');
  }
  if (typeof data.html_url !== 'string' || !data.html_url.startsWith('https://')) {
    throw new Error('GitHub release is missing a valid page URL.');
  }

  return {
    tagName: data.tag_name,
    name: typeof data.name === 'string' ? data.name : null,
    body: typeof data.body === 'string' ? data.body : null,
    htmlUrl: data.html_url,
  };
}

/**
 * Compare the running app version against the latest GitHub release.
 * `currentVersion` should come from Tauri `getVersion()` (e.g. `0.2.1`).
 */
export async function checkForGithubUpdate(
  currentVersion: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateCheckResult> {
  try {
    const release = await fetchLatestRelease(fetchImpl);
    const latestVersion = release.tagName.replace(/^[vV]/, '');

    if (!isNewerVersion(release.tagName, currentVersion)) {
      return {
        status: 'up-to-date',
        currentVersion,
        latestVersion,
      };
    }

    return {
      status: 'available',
      currentVersion,
      latestVersion,
      htmlUrl: release.htmlUrl,
      body: release.body,
      name: release.name,
    };
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : 'Unable to check for updates.';
    return { status: 'error', message };
  }
}
