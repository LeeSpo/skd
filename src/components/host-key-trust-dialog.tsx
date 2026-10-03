import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import type { UnknownHostKeyPayload } from '@/lib/host-key-verification';

interface HostKeyTrustDialogProps {
  open: boolean;
  payload: UnknownHostKeyPayload | null;
  onOpenChange: (open: boolean) => void;
  onTrusted: () => void;
  onTrustFailed?: (message: string) => void;
  onCancelled?: () => void;
}

export function HostKeyTrustDialog({
  open,
  payload,
  onOpenChange,
  onTrusted,
  onTrustFailed,
  onCancelled,
}: HostKeyTrustDialogProps) {
  const { t } = useTranslation();
  const [isTrusting, setIsTrusting] = useState(false);

  const handleTrust = async () => {
    if (!payload || isTrusting) return;

    setIsTrusting(true);
    try {
      await invoke('trust_host_key', {
        request: {
          host: payload.host,
          port: payload.port,
          key_type: payload.keyType,
          key_data: payload.keyData,
        },
      });

      onOpenChange(false);
      onTrusted();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onTrustFailed?.(message);
    } finally {
      setIsTrusting(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && open && !isTrusting) {
      onCancelled?.();
    }
    onOpenChange(nextOpen);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="macos-alert sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('hostKeyTrust.title')}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>{t('hostKeyTrust.description', { host: payload?.host, port: payload?.port })}</p>
              {payload?.fingerprint && (
                <p className="font-mono text-xs break-all rounded-md bg-muted p-2">
                  {payload.fingerprint}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isTrusting}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={isTrusting}
            onClick={(event) => {
              event.preventDefault();
              void handleTrust();
            }}
          >
            {isTrusting ? t('hostKeyTrust.trusting') : t('hostKeyTrust.trustAndConnect')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}