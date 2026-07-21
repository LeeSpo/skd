import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

// ── Hoisted mocks (must exist before vi.mock factories run) ─────────────────

const {
  mockCheckForGithubUpdate,
  mockGetVersion,
  mockInvoke,
  mockToast,
} = vi.hoisted(() => ({
  mockCheckForGithubUpdate: vi.fn(),
  mockGetVersion: vi.fn(),
  mockInvoke: vi.fn(),
  mockToast: {
    loading: vi.fn(),
    dismiss: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/lib/github-release', () => ({
  checkForGithubUpdate: (...args: unknown[]) => mockCheckForGithubUpdate(...args),
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: () => mockGetVersion(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => {
      const map: Record<string, string> = {
        'updateChecker.checking': 'Checking for updates…',
        'updateChecker.upToDate': "You're up to date!",
        'updateChecker.upToDateDesc': `skd ${opts?.version ?? ''} is the latest version.`,
        'updateChecker.updateAvailable': 'Update available',
        'updateChecker.updateAvailableDesc': `Version ${opts?.version ?? ''} is now available. You have ${opts?.currentVersion ?? ''}.`,
        'updateChecker.releaseNotesFallback':
          'A new version is available with improvements and fixes.',
        'updateChecker.later': 'Later',
        'updateChecker.viewOnGitHub': 'View on GitHub',
        'updateChecker.openFailed': 'Could not open browser',
        'updateChecker.openFailedDesc': 'Unable to open the release page.',
        'updateChecker.checkFailed': 'Update check failed',
        'updateChecker.checkFailedDesc': 'Unable to check for updates. Please try again later.',
      };
      return map[key] ?? key;
    },
  }),
}));

// Minimal UI stubs – AlertDialog renders children so we can query by text
vi.mock('../components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

import { UpdateChecker } from '../components/update-checker';
import { APP_SETTINGS_STORAGE_KEY } from '../lib/keyboard-shortcuts';

// ── Helpers ─────────────────────────────────────────────────────────────────

function enableAutoCheck() {
  localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ checkUpdates: true }));
}

function makeAvailable(latest = '2.0.0', body: string | null = 'Bug fixes') {
  return {
    status: 'available' as const,
    currentVersion: '1.0.0',
    latestVersion: latest,
    htmlUrl: `https://github.com/LeeSpo/skd/releases/tag/v${latest}`,
    body,
    name: `skd v${latest}`,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('UpdateChecker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetVersion.mockResolvedValue('1.0.0');
    mockCheckForGithubUpdate.mockResolvedValue({
      status: 'up-to-date',
      currentVersion: '1.0.0',
      latestVersion: '1.0.0',
    });
    mockInvoke.mockResolvedValue(undefined);
  });

  // ── Auto-check on mount ────────────────────────────────────────────────

  describe('auto-check on mount', () => {
    it('skips check when auto-check is disabled (default)', async () => {
      render(<UpdateChecker />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(mockCheckForGithubUpdate).not.toHaveBeenCalled();
    });

    it('calls check when checkUpdates is true in localStorage', async () => {
      localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ checkUpdates: true }));
      render(<UpdateChecker />);
      await waitFor(() => expect(mockCheckForGithubUpdate).toHaveBeenCalledTimes(1));
      expect(mockGetVersion).toHaveBeenCalled();
    });

    it('skips check when checkUpdates is false in localStorage', async () => {
      localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ checkUpdates: false }));
      render(<UpdateChecker />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(mockCheckForGithubUpdate).not.toHaveBeenCalled();
    });

    it('shows no toast on silent auto-check when no update', async () => {
      enableAutoCheck();
      render(<UpdateChecker />);
      await waitFor(() => expect(mockCheckForGithubUpdate).toHaveBeenCalledTimes(1));
      expect(mockToast.success).not.toHaveBeenCalled();
      expect(mockToast.error).not.toHaveBeenCalled();
      expect(mockToast.loading).not.toHaveBeenCalled();
    });

    it('shows no toast on silent auto-check when check fails', async () => {
      enableAutoCheck();
      mockCheckForGithubUpdate.mockResolvedValue({
        status: 'error',
        message: 'Could not reach GitHub. Check your internet connection.',
      });
      render(<UpdateChecker />);
      await waitFor(() => expect(mockCheckForGithubUpdate).toHaveBeenCalledTimes(1));
      expect(mockToast.error).not.toHaveBeenCalled();
    });
  });

  // ── Manual check via signal ────────────────────────────────────────────

  describe('manual check via signal', () => {
    it('triggers check when checkSignal changes', async () => {
      enableAutoCheck();
      const { rerender } = render(<UpdateChecker checkSignal={0} />);
      await waitFor(() => expect(mockCheckForGithubUpdate).toHaveBeenCalledTimes(1));
      mockCheckForGithubUpdate.mockClear();

      rerender(<UpdateChecker checkSignal={1} />);
      await waitFor(() => expect(mockCheckForGithubUpdate).toHaveBeenCalledTimes(1));
    });

    it('shows loading toast during manual check', async () => {
      enableAutoCheck();
      let resolveCheck: (v: unknown) => void;
      mockCheckForGithubUpdate.mockImplementation(
        () => new Promise((r) => {
          resolveCheck = r;
        }),
      );

      const { rerender } = render(<UpdateChecker checkSignal={0} />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      await act(async () => {
        resolveCheck!({
          status: 'up-to-date',
          currentVersion: '1.0.0',
          latestVersion: '1.0.0',
        });
      });
      mockCheckForGithubUpdate.mockClear();
      mockToast.loading.mockClear();

      mockCheckForGithubUpdate.mockImplementation(
        () => new Promise((r) => {
          resolveCheck = r;
        }),
      );
      rerender(<UpdateChecker checkSignal={1} />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });

      expect(mockToast.loading).toHaveBeenCalledWith('Checking for updates…', {
        id: 'update-check',
      });

      await act(async () => {
        resolveCheck!({
          status: 'up-to-date',
          currentVersion: '1.0.0',
          latestVersion: '1.0.0',
        });
      });
      expect(mockToast.dismiss).toHaveBeenCalledWith('update-check');
      expect(mockToast.success).toHaveBeenCalledWith("You're up to date!", {
        description: 'skd 1.0.0 is the latest version.',
      });
    });

    it('does NOT trigger check when signal is same value', async () => {
      enableAutoCheck();
      const { rerender } = render(<UpdateChecker checkSignal={5} />);
      await waitFor(() => expect(mockCheckForGithubUpdate).toHaveBeenCalledTimes(1));
      mockCheckForGithubUpdate.mockClear();

      rerender(<UpdateChecker checkSignal={5} />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(mockCheckForGithubUpdate).not.toHaveBeenCalled();
    });
  });

  // ── Update available ──────────────────────────────────────────────────

  describe('update available', () => {
    it('opens dialog with version info when update is found', async () => {
      enableAutoCheck();
      mockCheckForGithubUpdate.mockResolvedValue(makeAvailable('2.0.0', 'Bug fixes'));
      render(<UpdateChecker />);

      await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
      expect(screen.getByText('Update available')).toBeTruthy();
      expect(screen.getByText(/Version 2.0.0/)).toBeTruthy();
      expect(screen.getByText('Bug fixes')).toBeTruthy();
    });

    it('shows fallback notes when update has no body', async () => {
      enableAutoCheck();
      mockCheckForGithubUpdate.mockResolvedValue(makeAvailable('2.0.0', null));
      render(<UpdateChecker />);

      await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
      expect(
        screen.getByText('A new version is available with improvements and fixes.'),
      ).toBeTruthy();
    });

    it('shows View on GitHub button in available state', async () => {
      enableAutoCheck();
      mockCheckForGithubUpdate.mockResolvedValue(makeAvailable('3.0.0'));
      render(<UpdateChecker />);

      await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
      expect(screen.getByText('View on GitHub')).toBeTruthy();
      expect(screen.getByText('Later')).toBeTruthy();
    });

    it('opens the release page when View on GitHub is clicked', async () => {
      enableAutoCheck();
      mockCheckForGithubUpdate.mockResolvedValue(makeAvailable('3.0.0'));
      render(<UpdateChecker />);
      await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

      await act(async () => {
        screen.getByText('View on GitHub').click();
        await new Promise((r) => setTimeout(r, 30));
      });

      expect(mockInvoke).toHaveBeenCalledWith('open_url', {
        url: 'https://github.com/LeeSpo/skd/releases/tag/v3.0.0',
      });
    });
  });

  // ── Error handling ────────────────────────────────────────────────────

  describe('error handling', () => {
    it('shows error toast on manual check failure', async () => {
      mockCheckForGithubUpdate.mockResolvedValue({
        status: 'error',
        message: 'No releases found on GitHub for this project.',
      });
      const { rerender } = render(<UpdateChecker checkSignal={0} />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      mockCheckForGithubUpdate.mockClear();
      mockToast.error.mockClear();

      mockCheckForGithubUpdate.mockResolvedValue({
        status: 'error',
        message: 'No releases found on GitHub for this project.',
      });
      rerender(<UpdateChecker checkSignal={1} />);
      await waitFor(() => expect(mockToast.error).toHaveBeenCalled());

      const [title, opts] = mockToast.error.mock.calls[0];
      expect(title).toBe('Update check failed');
      expect(opts.description).toContain('No releases found');
    });

    it('maps network error message through to toast', async () => {
      mockCheckForGithubUpdate.mockResolvedValue({
        status: 'error',
        message: 'Could not reach GitHub. Check your internet connection.',
      });
      const { rerender } = render(<UpdateChecker checkSignal={0} />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      mockCheckForGithubUpdate.mockClear();

      mockCheckForGithubUpdate.mockResolvedValue({
        status: 'error',
        message: 'Could not reach GitHub. Check your internet connection.',
      });
      rerender(<UpdateChecker checkSignal={1} />);
      await waitFor(() => expect(mockToast.error).toHaveBeenCalled());

      const [, opts] = mockToast.error.mock.calls[0];
      expect(opts.description).toContain('Could not reach GitHub');
    });
  });

  // ── Busy guard ────────────────────────────────────────────────────────

  describe('busy guard', () => {
    it('prevents concurrent checks when already checking', async () => {
      enableAutoCheck();
      let resolveCheck: (v: unknown) => void;
      mockCheckForGithubUpdate.mockImplementation(
        () => new Promise((r) => {
          resolveCheck = r;
        }),
      );

      const { rerender } = render(<UpdateChecker checkSignal={0} />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });

      rerender(<UpdateChecker checkSignal={1} />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });

      expect(mockCheckForGithubUpdate).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveCheck!({
          status: 'up-to-date',
          currentVersion: '1.0.0',
          latestVersion: '1.0.0',
        });
      });
    });
  });

  // ── Later button ──────────────────────────────────────────────────────

  describe('later button', () => {
    it('closes dialog and resets state', async () => {
      enableAutoCheck();
      mockCheckForGithubUpdate.mockResolvedValue(makeAvailable('5.0.0'));
      render(<UpdateChecker />);
      await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

      await act(async () => {
        screen.getByText('Later').click();
      });

      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
