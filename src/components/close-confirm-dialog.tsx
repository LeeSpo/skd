import { useTranslation } from 'react-i18next';
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

interface CloseConfirmDialogProps {
  open: boolean;
  kind: 'close-tabs' | 'quit' | null;
  busyCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function CloseConfirmDialog({
  open,
  kind,
  busyCount,
  onCancel,
  onConfirm,
}: CloseConfirmDialogProps) {
  const { t } = useTranslation();
  const isQuit = kind === 'quit';

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isQuit ? t('closeConfirm.quitTitle') : t('closeConfirm.title')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(isQuit ? 'closeConfirm.quitDescription' : 'closeConfirm.closeDescription', {
              count: busyCount,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isQuit ? t('closeConfirm.quitAnyway') : t('closeConfirm.closeAnyway')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
