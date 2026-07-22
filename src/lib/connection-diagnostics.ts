/** Connection diagnostics: stages, error kinds, and UI helpers. */

export const CONNECT_PROGRESS_EVENT = 'ssh-connect-progress';

export type ConnectStage =
  | 'resolvingDns'
  | 'establishingTcp'
  | 'sshHandshake'
  | 'verifyingHostKey'
  | 'authenticating'
  | 'requestingPty'
  | 'connected';

export type ConnectErrorKind =
  | 'dnsFailure'
  | 'tcpTimeout'
  | 'connectionRefused'
  | 'networkUnreachable'
  | 'proxyFailure'
  | 'sshHandshakeFailed'
  | 'sshAlgorithmIncompatible'
  | 'hostKeyMismatch'
  | 'hostKeyUnknown'
  | 'authenticationFailed'
  | 'passwordIncorrect'
  | 'publicKeyUnauthorized'
  | 'privateKeyFormatUnsupported'
  | 'privateKeyPassphraseIncorrect'
  | 'keyboardInteractiveRejected'
  | 'keyboardInteractiveTimeout'
  | 'ptyCreateFailed'
  | 'cancelled'
  | 'unknown';

/** Complete interactive SSH connection lifecycle. */
export const SSH_CONNECT_STAGES: ConnectStage[] = [
  'resolvingDns',
  'establishingTcp',
  'sshHandshake',
  'verifyingHostKey',
  'authenticating',
  'requestingPty',
  'connected',
];

/** Backward-compatible name used by the connection dialog. */
export const DIALOG_CONNECT_STAGES = SSH_CONNECT_STAGES;

export interface ConnectProgressEvent {
  connectionId: string;
  stage: ConnectStage;
}

export interface ConnectDiagnosticResponse {
  success: boolean;
  error?: string;
  /** Backend may send known ConnectErrorKind values or future kinds. */
  errorKind?: string;
  /** Backend may send known ConnectStage values or future stages. */
  failedStage?: string;
  pendingHostKeyTrust?: boolean;
}

export type StageUiStatus = 'pending' | 'active' | 'done' | 'failed';

export function stageI18nKey(stage: ConnectStage): string {
  return `connectionDiagnostics.stage.${stage}`;
}

export function errorKindI18nKey(kind: string): string {
  return `connectionDiagnostics.error.${kind}`;
}

/** Map a stage list + current/failed stage into UI statuses. */
export function computeStageStatuses(
  stages: ConnectStage[],
  currentStage: ConnectStage | null,
  failedStage: string | null | undefined,
): StageUiStatus[] {
  if (!currentStage && !failedStage) {
    return stages.map(() => 'pending');
  }

  const failedIndex = failedStage
    ? stages.indexOf(failedStage as ConnectStage)
    : -1;
  const currentIndex = currentStage
    ? stages.indexOf(currentStage)
    : -1;

  return stages.map((stage, index) => {
    if (failedIndex >= 0) {
      if (index < failedIndex) return 'done';
      if (index === failedIndex) return 'failed';
      return 'pending';
    }
    if (currentIndex < 0) return 'pending';
    if (index < currentIndex) return 'done';
    if (index === currentIndex) {
      return stage === 'connected' ? 'done' : 'active';
    }
    return 'pending';
  });
}

/** Loose translator adapter — accepts react-i18next `t` without key union friction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TranslateFn = (key: any, options?: any) => string;

/**
 * Build toast title + description from a classified connect response.
 * Returns null title when this is an interactive host-key trust flow.
 */
export function formatConnectError(
  t: TranslateFn,
  response: ConnectDiagnosticResponse,
): { title: string; description: string } | null {
  if (response.pendingHostKeyTrust || response.errorKind === 'hostKeyUnknown') {
    return null;
  }

  const kind = (response.errorKind as ConnectErrorKind | undefined) ?? 'unknown';
  const titleKey = errorKindI18nKey(kind);
  const fallbackTitle = t('connectionDialog.toast.connectionFailed');
  const title = t(titleKey);
  // i18next returns the key when missing — treat that as fallback
  const resolvedTitle = title === titleKey ? fallbackTitle : title;

  const description =
    response.error?.trim() ||
    t('connectionDialog.toast.connectionFailedDesc');

  return { title: resolvedTitle, description };
}

export function isConnectErrorKind(value: unknown): value is ConnectErrorKind {
  return (
    typeof value === 'string' &&
    [
      'dnsFailure',
      'tcpTimeout',
      'connectionRefused',
      'networkUnreachable',
      'proxyFailure',
      'sshHandshakeFailed',
      'sshAlgorithmIncompatible',
      'hostKeyMismatch',
      'hostKeyUnknown',
      'authenticationFailed',
      'passwordIncorrect',
      'publicKeyUnauthorized',
      'privateKeyFormatUnsupported',
      'privateKeyPassphraseIncorrect',
      'ptyCreateFailed',
      'cancelled',
      'unknown',
    ].includes(value)
  );
}

export function isConnectStage(value: unknown): value is ConnectStage {
  return (
    typeof value === 'string' &&
    [
      'resolvingDns',
      'establishingTcp',
      'sshHandshake',
      'verifyingHostKey',
      'authenticating',
      'requestingPty',
      'connected',
    ].includes(value)
  );
}
