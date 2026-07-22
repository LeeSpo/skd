import { AlertTriangle, Loader2, RotateCcw, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConnectionAttemptState } from '@/lib/connection-attempt-context';
import {
  computeStageStatuses,
  errorKindI18nKey,
  SSH_CONNECT_STAGES,
  stageI18nKey,
} from '@/lib/connection-diagnostics';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

interface ConnectionProgressSegmentsProps {
  attempt: ConnectionAttemptState | null | undefined;
  className?: string;
}

export function ConnectionProgressSegments({
  attempt,
  className,
}: ConnectionProgressSegmentsProps) {
  const { t } = useTranslation();
  const statuses = computeStageStatuses(
    SSH_CONNECT_STAGES,
    attempt?.currentStage ?? null,
    attempt?.failedStage,
  );
  const displayStage = attempt?.failedStage ?? attempt?.currentStage;

  return (
    <div className={cn('space-y-2', className)}>
      <div
        className="flex gap-1"
        role="progressbar"
        aria-label={t('connectionDiagnostics.progressTitle')}
        aria-valuemin={0}
        aria-valuemax={SSH_CONNECT_STAGES.length}
        aria-valuenow={statuses.filter((status) => status === 'done').length}
      >
        {SSH_CONNECT_STAGES.map((stage, index) => {
          const status = statuses[index];
          return (
            <div
              key={stage}
              className={cn(
                'h-2 min-w-0 flex-1 rounded-full transition-colors',
                status === 'done' && 'bg-emerald-500',
                status === 'active' && 'bg-primary animate-pulse',
                status === 'failed' && 'bg-destructive',
                status === 'pending' && 'bg-muted-foreground/20',
              )}
              title={t(stageI18nKey(stage) as 'connectionDiagnostics.stage.resolvingDns')}
              aria-label={t(stageI18nKey(stage) as 'connectionDiagnostics.stage.resolvingDns')}
              aria-current={status === 'active' ? 'step' : undefined}
            />
          );
        })}
      </div>
      <div className="flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
        {attempt?.status === 'connecting' && displayStage && (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        )}
        {attempt?.status === 'failed' && (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
        )}
        <span className={cn(attempt?.status === 'failed' && 'text-destructive')}>
          {displayStage
            ? t(stageI18nKey(displayStage) as 'connectionDiagnostics.stage.resolvingDns')
            : t('connectionDiagnostics.preparing')}
        </span>
      </div>
    </div>
  );
}

const EDITABLE_ERROR_KINDS = new Set([
  'dnsFailure',
  'connectionRefused',
  'authenticationFailed',
  'passwordIncorrect',
  'publicKeyUnauthorized',
  'privateKeyFormatUnsupported',
  'privateKeyPassphraseIncorrect',
  'keyboardInteractiveRejected',
]);

interface ConnectionFailureViewProps {
  attempt: ConnectionAttemptState;
  onRetry: () => void;
  onEdit: () => void;
}

export function ConnectionFailureView({ attempt, onRetry, onEdit }: ConnectionFailureViewProps) {
  const { t } = useTranslation();
  const errorKind = attempt.errorKind ?? 'unknown';
  const titleKey = errorKindI18nKey(errorKind);
  const translatedTitle = t(titleKey as 'connectionDiagnostics.error.unknown');
  const title = translatedTitle === titleKey
    ? t('connectionDiagnostics.error.unknown')
    : translatedTitle;
  const canRetry = errorKind !== 'hostKeyMismatch';
  const canEdit = EDITABLE_ERROR_KINDS.has(errorKind) || errorKind === 'hostKeyMismatch';

  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/20 p-6">
      <div className="w-full max-w-xl space-y-5 rounded-lg border bg-background p-5 shadow-sm">
        <ConnectionProgressSegments attempt={attempt} />
        <div className="space-y-1">
          <h3 className="font-medium text-destructive">{title}</h3>
          <p className="text-sm text-muted-foreground">
            {t('connectionDiagnostics.failureDescription')}
          </p>
        </div>
        {attempt.message && (
          <details className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <summary className="cursor-pointer select-none font-medium text-muted-foreground">
              {t('connectionDiagnostics.technicalDetails')}
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-foreground">
              {attempt.message}
            </pre>
          </details>
        )}
        <div className="flex justify-end gap-2">
          {canEdit && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Settings2 className="h-4 w-4" />
              {t('connectionDiagnostics.editConnection')}
            </Button>
          )}
          {canRetry && (
            <Button size="sm" onClick={onRetry}>
              <RotateCcw className="h-4 w-4" />
              {t('connectionDiagnostics.retry')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
