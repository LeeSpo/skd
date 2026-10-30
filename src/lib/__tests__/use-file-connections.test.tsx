import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionAttemptProvider, useConnectionAttempts } from '@/lib/connection-attempt-context';
import { useFileConnections } from '@/lib/use-file-connections';
import type { ConnectResponse, HostKeyTrustRequest } from '@/lib/ssh-connect';
import type { ConnectProgressEvent } from '@/lib/connection-diagnostics';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), unlisten: vi.fn(), dispatch: vi.fn(), error: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('@/lib/terminal-group-context', () => ({ useTerminalGroups: () => ({ dispatch: mocks.dispatch }) }));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));

const config = { protocol: 'FTP', host: '127.0.0.1', port: 21, username: 'test', password: 'test' };

function setup() {
  const trust = vi.fn<(request: HostKeyTrustRequest, onCancelled?: () => void) => void>();
  const hook = renderHook(() => ({
    ...useFileConnections(trust),
    ...useConnectionAttempts(),
  }), { wrapper: ConnectionAttemptProvider });
  return { ...hook, trust };
}

function pendingResponse() {
  let resolve!: (response: ConnectResponse) => void;
  const promise = new Promise<ConnectResponse>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('file connection lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    mocks.listen.mockResolvedValue(mocks.unlisten);
    mocks.invoke.mockResolvedValue({ success: true });
  });
  afterEach(cleanup);

  it('begins FTPS progress before invoking connect, filters events and marks success', async () => {
    const pending = pendingResponse();
    mocks.invoke.mockImplementation((command: string) => command === 'ftp_connect' ? pending.promise : Promise.resolve({ success: true }));
    const { result } = setup();
    let operation!: Promise<ConnectResponse>;
    act(() => { operation = result.current.connectFileWithDiagnostics('one', { ...config, ftpsEnabled: true }); });
    expect(result.current.attempts.one.status).toBe('connecting');
    expect(result.current.attempts.one.stages).toContain('tlsHandshake');
    await waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(1));
    const handler = mocks.listen.mock.calls[0][1] as (event: { payload: ConnectProgressEvent }) => void;
    act(() => handler({ payload: { connectionId: 'other', stage: 'authenticating' } }));
    expect(result.current.attempts.one.currentStage).toBeNull();
    act(() => handler({ payload: { connectionId: 'one', stage: 'tlsHandshake' } }));
    expect(result.current.attempts.one.currentStage).toBe('tlsHandshake');
    await act(async () => { pending.resolve({ success: true }); await operation; });
    expect(result.current.attempts.one.status).toBe('connected');
    expect(mocks.dispatch).toHaveBeenLastCalledWith({ type: 'UPDATE_TAB_STATUS', tabId: 'one', status: 'connected' });
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it('records structured FTP failure and clears it on retry', async () => {
    mocks.invoke.mockImplementation((command: string) => Promise.resolve(command === 'ftp_connect'
      ? { success: false, errorKind: 'authenticationFailed', failedStage: 'authenticating', error: 'Login rejected' }
      : { success: true }));
    const { result } = setup();
    await act(async () => { await result.current.connectFileWithDiagnostics('one', config); });
    expect(result.current.attempts.one).toMatchObject({ status: 'failed', failedStage: 'authenticating', message: 'Login rejected' });
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(result.current.getFileConnectionConfig('one')).toEqual(config);
    expect(localStorage.length).toBe(0);
    mocks.invoke.mockResolvedValue({ success: true });
    await act(async () => { await result.current.connectFileWithDiagnostics('one', config); });
    expect(result.current.attempts.one).toMatchObject({ status: 'connected', failedStage: null, message: null });
  });

  it('keeps SFTP host key confirmation pending and completes the same tab after trust', async () => {
    const unknown = 'UNKNOWN_HOST_KEY:' + JSON.stringify({ host: config.host, port: 22, fingerprint: 'test', keyType: 'ssh-ed25519', keyData: 'test' });
    let connections = 0;
    mocks.invoke.mockImplementation((command: string) => Promise.resolve(command === 'sftp_connect' && connections++ === 0
      ? { success: false, errorKind: 'hostKeyUnknown', error: unknown }
      : { success: true }));
    const { result, trust } = setup();
    const onConnected = vi.fn();
    await act(async () => { await result.current.connectFileWithDiagnostics('one', { ...config, protocol: 'SFTP' }, onConnected); });
    expect(result.current.attempts.one.status).toBe('awaitingHostKey');
    expect(result.current.attempts.one.stages).toContain('openingSftp');
    expect(result.current.attempts.one.stages).not.toContain('requestingPty');
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'disconnected' }));
    await act(async () => { await trust.mock.calls[0][0].retry(); });
    expect(result.current.attempts.one.status).toBe('connected');
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(mocks.listen).toHaveBeenCalledTimes(2);
    expect(mocks.unlisten).toHaveBeenCalledTimes(2);
  });

  it('cancels a closed tab, immediately unlistens and discards a late success', async () => {
    const pending = pendingResponse();
    mocks.invoke.mockImplementation((command: string) => command === 'ftp_connect' ? pending.promise : Promise.resolve({ success: true }));
    const { result } = setup();
    const onConnected = vi.fn();
    let operation!: Promise<ConnectResponse>;
    act(() => { operation = result.current.connectFileWithDiagnostics('one', config, onConnected); });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('ftp_connect', expect.anything()));
    act(() => result.current.cancelFileConnection('one'));
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith('ssh_cancel_connect', { connectionId: 'one' });
    await act(async () => { pending.resolve({ success: true }); await operation; });
    expect(result.current.attempts.one).toBeUndefined();
    expect(result.current.getFileConnectionConfig('one')).toBeUndefined();
    expect(onConnected).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenLastCalledWith('ftp_disconnect', { connectionId: 'one' });
  });

  it('serializes replacement attempts and ignores the old progress and result', async () => {
    const first = pendingResponse();
    let connects = 0;
    mocks.invoke.mockImplementation((command: string) => command === 'ftp_connect' && connects++ === 0 ? first.promise : Promise.resolve({ success: true }));
    const { result } = setup();
    let one!: Promise<ConnectResponse>;
    let two!: Promise<ConnectResponse>;
    act(() => { one = result.current.connectFileWithDiagnostics('one', config); });
    await waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(1));
    act(() => { two = result.current.connectFileWithDiagnostics('one', { ...config, ftpsEnabled: true }); });
    expect(connects).toBe(1);
    await act(async () => { first.resolve({ success: true }); await one; await two; });
    expect(connects).toBe(2);
    expect(result.current.attempts.one).toMatchObject({ status: 'connected', stages: expect.arrayContaining(['tlsHandshake']) });
    expect(mocks.dispatch.mock.calls.filter(([action]) => action.status === 'connected')).toHaveLength(1);
  });

  it('keeps a changed SFTP host key pending and connects after trust', async () => {
    const mismatch = 'HOST_KEY_MISMATCH:' + JSON.stringify({
      host: config.host,
      port: 22,
      fingerprint: 'SHA256:new',
      keyType: 'ssh-ed25519',
      keyData: 'new-key',
      expectedFingerprint: 'SHA256:old',
    });
    let connections = 0;
    mocks.invoke.mockImplementation((command: string) => Promise.resolve(command === 'sftp_connect' && connections++ === 0
      ? { success: false, errorKind: 'hostKeyMismatch', error: mismatch }
      : { success: true }));
    const { result, trust } = setup();
    const onConnected = vi.fn();
    await act(async () => { await result.current.connectFileWithDiagnostics('one', { ...config, protocol: 'SFTP' }, onConnected); });
    expect(result.current.attempts.one.status).toBe('awaitingHostKey');
    expect(mocks.error).not.toHaveBeenCalled();
    expect(trust.mock.calls[0][0].payload).toMatchObject({ changed: true, expectedFingerprint: 'SHA256:old', keyData: 'new-key' });
    await act(async () => { await trust.mock.calls[0][0].retry(); });
    expect(result.current.attempts.one.status).toBe('connected');
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('declining host key trust clears progress and prevents its retry from connecting', async () => {
    mocks.invoke.mockImplementation((command: string) => Promise.resolve(command === 'sftp_connect' ? {
      success: false, errorKind: 'hostKeyUnknown',
      error: 'UNKNOWN_HOST_KEY:' + JSON.stringify({ host: 'test', keyType: 'ssh-ed25519', keyData: 'test' }),
    } : { success: true }));
    const { result, trust } = setup();
    await act(async () => { await result.current.connectFileWithDiagnostics('one', { ...config, protocol: 'SFTP' }); });
    await act(async () => { trust.mock.calls[0][1]?.(); });
    expect(result.current.attempts.one).toBeUndefined();
    await act(async () => { expect((await trust.mock.calls[0][0].retry()).errorKind).toBe('cancelled'); });
    expect(mocks.listen).toHaveBeenCalledTimes(1);
  });

  it('keeps simultaneous connections and failures independent', async () => {
    const one = pendingResponse();
    const two = pendingResponse();
    mocks.invoke.mockImplementation((command: string, args: { request?: { connection_id: string } }) => command === 'ftp_connect'
      ? (args.request?.connection_id === 'one' ? one.promise : two.promise) : Promise.resolve({ success: true }));
    const { result } = setup();
    let first!: Promise<ConnectResponse>;
    let second!: Promise<ConnectResponse>;
    act(() => {
      first = result.current.connectFileWithDiagnostics('one', config);
      second = result.current.connectFileWithDiagnostics('two', { ...config, ftpsEnabled: true });
    });
    await waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(2));
    await act(async () => {
      one.resolve({ success: false, errorKind: 'connectionRefused', failedStage: 'establishingTcp' });
      await first;
    });
    expect(result.current.attempts.one.status).toBe('failed');
    expect(result.current.attempts.two.status).toBe('connecting');
    await act(async () => { two.resolve({ success: true }); await second; });
    expect(result.current.attempts.one.status).toBe('failed');
    expect(result.current.attempts.two.status).toBe('connected');
  });

  it('does not invoke connect if the tab closes while event subscription is pending', async () => {
    let subscribed!: (unlisten: () => void) => void;
    mocks.listen.mockImplementation(() => new Promise<() => void>((done) => { subscribed = done; }));
    const { result } = setup();
    let operation!: Promise<ConnectResponse>;
    act(() => { operation = result.current.connectFileWithDiagnostics('one', config); });
    await waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(1));
    act(() => result.current.cancelFileConnection('one'));
    await act(async () => { subscribed(mocks.unlisten); await operation; });
    expect(mocks.invoke).not.toHaveBeenCalledWith('ftp_connect', expect.anything());
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
    expect(result.current.attempts.one).toBeUndefined();
  });
});
