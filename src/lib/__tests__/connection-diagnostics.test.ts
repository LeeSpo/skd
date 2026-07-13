import { describe, expect, it } from 'vitest';
import {
  computeStageStatuses,
  DIALOG_CONNECT_STAGES,
  errorKindI18nKey,
  formatConnectError,
  isConnectErrorKind,
  isConnectStage,
  stageI18nKey,
} from '../connection-diagnostics';

describe('connection-diagnostics', () => {
  it('maps stage and error kinds to i18n keys', () => {
    expect(stageI18nKey('resolvingDns')).toBe('connectionDiagnostics.stage.resolvingDns');
    expect(errorKindI18nKey('passwordIncorrect')).toBe(
      'connectionDiagnostics.error.passwordIncorrect',
    );
  });

  it('validates stage and error kind guards', () => {
    expect(isConnectStage('authenticating')).toBe(true);
    expect(isConnectStage('nope')).toBe(false);
    expect(isConnectErrorKind('dnsFailure')).toBe(true);
    expect(isConnectErrorKind('not-a-kind')).toBe(false);
  });

  it('computes pending statuses when idle', () => {
    expect(computeStageStatuses(DIALOG_CONNECT_STAGES, null, null)).toEqual(
      DIALOG_CONNECT_STAGES.map(() => 'pending'),
    );
  });

  it('marks stages done/active based on current stage', () => {
    const statuses = computeStageStatuses(DIALOG_CONNECT_STAGES, 'authenticating', null);
    expect(statuses[0]).toBe('done'); // dns
    expect(statuses[1]).toBe('done'); // tcp
    expect(statuses[2]).toBe('done'); // handshake
    expect(statuses[3]).toBe('done'); // host key
    expect(statuses[4]).toBe('active'); // authenticating
    expect(statuses[5]).toBe('pending'); // PTY
    expect(statuses[6]).toBe('pending'); // connected
  });

  it('marks connected stage as done when current is connected', () => {
    const statuses = computeStageStatuses(DIALOG_CONNECT_STAGES, 'connected', null);
    expect(statuses.every((s) => s === 'done')).toBe(true);
  });

  it('marks failed stage and freezes later stages', () => {
    const statuses = computeStageStatuses(
      DIALOG_CONNECT_STAGES,
      'establishingTcp',
      'establishingTcp',
    );
    expect(statuses[0]).toBe('done');
    expect(statuses[1]).toBe('failed');
    expect(statuses.slice(2).every((s) => s === 'pending')).toBe(true);
  });

  it('formatConnectError returns classified title and backend detail', () => {
    const t = (key: string) => {
      if (key === 'connectionDiagnostics.error.passwordIncorrect') {
        return 'Incorrect password';
      }
      if (key === 'connectionDialog.toast.connectionFailed') {
        return 'Connection Failed';
      }
      return key;
    };

    const formatted = formatConnectError(t, {
      success: false,
      error: 'Password authentication failed. Please check your password and try again.',
      errorKind: 'passwordIncorrect',
      failedStage: 'authenticating',
    });

    expect(formatted).toEqual({
      title: 'Incorrect password',
      description: 'Password authentication failed. Please check your password and try again.',
    });
  });

  it('formatConnectError returns null for host-key trust flow', () => {
    const t = (key: string) => key;
    expect(
      formatConnectError(t, {
        success: false,
        pendingHostKeyTrust: true,
        errorKind: 'hostKeyUnknown',
      }),
    ).toBeNull();
  });

  it('recognizes actionable connection error kinds', () => {
    expect(isConnectErrorKind('connectionRefused')).toBe(true);
    expect(isConnectErrorKind('networkUnreachable')).toBe(true);
    expect(isConnectErrorKind('sshHandshakeFailed')).toBe(true);
    expect(isConnectErrorKind('authenticationFailed')).toBe(true);
    expect(isConnectErrorKind('privateKeyPassphraseIncorrect')).toBe(true);
  });

  it('formatConnectError falls back for unknown kinds', () => {
    const t = (key: string) => {
      if (key === 'connectionDialog.toast.connectionFailed') return 'Connection Failed';
      if (key === 'connectionDialog.toast.connectionFailedDesc') return 'Generic fail';
      return key; // missing kind key echoes itself
    };

    const formatted = formatConnectError(t, {
      success: false,
      errorKind: 'notReal',
    });

    expect(formatted?.title).toBe('Connection Failed');
    expect(formatted?.description).toBe('Generic fail');
  });
});
