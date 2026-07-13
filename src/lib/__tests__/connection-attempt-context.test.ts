import { describe, expect, it } from 'vitest';
import { connectionAttemptReducer } from '../connection-attempt-context';

describe('connectionAttemptReducer', () => {
  it('tracks transport progress through PTY success', () => {
    let state = connectionAttemptReducer({}, { type: 'BEGIN', connectionId: 'ssh-1' });
    state = connectionAttemptReducer(state, {
      type: 'PROGRESS',
      connectionId: 'ssh-1',
      stage: 'authenticating',
    });
    expect(state['ssh-1'].status).toBe('connecting');
    expect(state['ssh-1'].currentStage).toBe('authenticating');

    state = connectionAttemptReducer(state, {
      type: 'PROGRESS',
      connectionId: 'ssh-1',
      stage: 'requestingPty',
    });
    expect(state['ssh-1'].currentStage).toBe('requestingPty');

    state = connectionAttemptReducer(state, {
      type: 'PROGRESS',
      connectionId: 'ssh-1',
      stage: 'connected',
    });
    expect(state['ssh-1'].status).toBe('connected');
  });

  it('keeps host-key trust interactive instead of failed', () => {
    let state = connectionAttemptReducer({}, { type: 'BEGIN', connectionId: 'ssh-1' });
    state = connectionAttemptReducer(state, { type: 'AWAIT_HOST_KEY', connectionId: 'ssh-1' });
    expect(state['ssh-1']).toMatchObject({
      status: 'awaitingHostKey',
      currentStage: 'verifyingHostKey',
      failedStage: null,
    });
  });

  it('stores classified failure details and clears them on retry', () => {
    let state = connectionAttemptReducer({}, { type: 'BEGIN', connectionId: 'ssh-1' });
    state = connectionAttemptReducer(state, {
      type: 'FAIL',
      connectionId: 'ssh-1',
      response: {
        success: false,
        error: 'Connection refused by host:22',
        errorKind: 'connectionRefused',
        failedStage: 'establishingTcp',
      },
    });
    expect(state['ssh-1']).toMatchObject({
      status: 'failed',
      errorKind: 'connectionRefused',
      failedStage: 'establishingTcp',
    });

    state = connectionAttemptReducer(state, { type: 'BEGIN', connectionId: 'ssh-1' });
    expect(state['ssh-1'].errorKind).toBeNull();
    expect(state['ssh-1'].failedStage).toBeNull();
  });

  it('removes transient attempts when a tab closes', () => {
    let state = connectionAttemptReducer({}, { type: 'BEGIN', connectionId: 'ssh-1' });
    state = connectionAttemptReducer(state, { type: 'CLEAR', connectionId: 'ssh-1' });
    expect(state['ssh-1']).toBeUndefined();
  });
});
