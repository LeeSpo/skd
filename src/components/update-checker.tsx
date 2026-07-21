import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Button } from './ui/button';
import { APP_SETTINGS_STORAGE_KEY } from '@/lib/keyboard-shortcuts';
import {
  checkForGithubUpdate,
  type UpdateCheckResult,
} from '@/lib/github-release';

interface UpdateCheckerProps {
  checkSignal?: number;
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'error';

interface AvailableUpdate {
  currentVersion: string;
  latestVersion: string;
  htmlUrl: string;
  body: string | null;
}

/** Read the user's "auto check for updates" preference from localStorage. */
const isAutoCheckEnabled = () => {
  try {
    // The settings modal persists the full settings object (including
    // checkUpdates) under this single key; see SettingsModal.handleSave.
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) return false; // default: disabled
    const parsed = JSON.parse(raw) as { checkUpdates?: boolean };
    return parsed.checkUpdates === true;
  } catch {
    return false;
  }
};

export function UpdateChecker({ checkSignal }: UpdateCheckerProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<AvailableUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const lastSignalRef = useRef<number | undefined>(checkSignal);
  const busyRef = useRef(false);

  const busy = status === 'checking';

  const resetState = useCallback(() => {
    setStatus('idle');
    setUpdateInfo(null);
    setError(null);
    setDialogOpen(false);
  }, []);

  const applyResult = useCallback(
    (result: UpdateCheckResult, manual: boolean) => {
      if (result.status === 'available') {
        setUpdateInfo({
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          htmlUrl: result.htmlUrl,
          body: result.body,
        });
        setStatus('available');
        setDialogOpen(true);
        return;
      }

      if (result.status === 'up-to-date') {
        setStatus('idle');
        if (manual) {
          toast.success(t('updateChecker.upToDate'), {
            description: t('updateChecker.upToDateDesc', {
              version: result.currentVersion,
            }),
          });
        }
        return;
      }

      // error
      setStatus('error');
      setError(result.message);
      if (manual) {
        toast.error(t('updateChecker.checkFailed'), {
          description: result.message,
        });
      }
    },
    [t],
  );

  const checkForUpdates = useCallback(
    async (manual: boolean) => {
      // Guard against concurrent checks (rapid clicks, overlapping auto+manual)
      if (busyRef.current) {
        return;
      }
      busyRef.current = true;

      setStatus('checking');
      setError(null);

      if (manual) {
        toast.loading(t('updateChecker.checking'), { id: 'update-check' });
      }

      try {
        const currentVersion = await getVersion();
        const result = await checkForGithubUpdate(currentVersion);

        if (manual) {
          toast.dismiss('update-check');
        }

        applyResult(result, manual);
      } catch (caught) {
        if (manual) {
          toast.dismiss('update-check');
        }

        const message =
          caught instanceof Error
            ? caught.message
            : t('updateChecker.checkFailedDesc');
        setStatus('error');
        setError(message);
        if (manual) {
          toast.error(t('updateChecker.checkFailed'), { description: message });
        }
      } finally {
        busyRef.current = false;
      }
    },
    [applyResult, t],
  );

  const handleOpenGithub = useCallback(async () => {
    if (!updateInfo?.htmlUrl) {
      return;
    }

    try {
      await invoke('open_url', { url: updateInfo.htmlUrl });
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : t('updateChecker.openFailedDesc');
      toast.error(t('updateChecker.openFailed'), { description: message });
    }
  }, [t, updateInfo]);

  // Keep a stable ref so mount/signal effects do not re-fire when the
  // callback identity changes (e.g. i18n `t` recreating each render).
  const checkForUpdatesRef = useRef(checkForUpdates);
  useEffect(() => {
    checkForUpdatesRef.current = checkForUpdates;
  }, [checkForUpdates]);

  useEffect(() => {
    if (isAutoCheckEnabled()) {
      void checkForUpdatesRef.current(false);
    }
  }, []);

  useEffect(() => {
    if (typeof checkSignal === 'number') {
      if (lastSignalRef.current !== checkSignal) {
        lastSignalRef.current = checkSignal;
        void checkForUpdatesRef.current(true);
      }
    }
  }, [checkSignal]);

  const notes = useMemo(() => {
    if (!updateInfo?.body?.trim()) {
      return t('updateChecker.releaseNotesFallback');
    }
    return updateInfo.body;
  }, [t, updateInfo?.body]);

  const onDialogOpenChange = useCallback(
    (open: boolean) => {
      if (busy) {
        return;
      }

      if (!open) {
        resetState();
      } else {
        setDialogOpen(open);
      }
    },
    [busy, resetState],
  );

  return (
    <AlertDialog open={dialogOpen} onOpenChange={onDialogOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('updateChecker.updateAvailable')}</AlertDialogTitle>
          <AlertDialogDescription>
            {updateInfo
              ? t('updateChecker.updateAvailableDesc', {
                  version: updateInfo.latestVersion,
                  currentVersion: updateInfo.currentVersion,
                })
              : t('updateChecker.updateAvailable')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground whitespace-pre-line max-h-48 overflow-y-auto">
            {notes}
          </p>
          {status === 'error' && error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              resetState();
            }}
            disabled={busy}
          >
            {t('updateChecker.later')}
          </Button>
          <Button onClick={() => void handleOpenGithub()} disabled={busy || !updateInfo}>
            {t('updateChecker.viewOnGitHub')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
