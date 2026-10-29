import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalTabSurface } from '@/components/terminal/terminal-group-view';
import type { TerminalTab } from '@/lib/terminal-group-types';
import type { ConnectionAttemptState } from '@/lib/connection-attempt-context';
import { getConnectStages } from '@/lib/connection-diagnostics';

const mocks = vi.hoisted(() => ({
  attempts: {} as Record<string, ConnectionAttemptState>,
  reconnect: vi.fn(),
  edit: vi.fn(),
}));

vi.mock('@/lib/terminal-group-context', () => ({
  useTerminalGroups: () => ({ dispatch: vi.fn() }),
}));
vi.mock('@/lib/terminal-callbacks-context', () => ({
  useTerminalCallbacks: () => ({ onReconnectTab: mocks.reconnect, onEditConnection: mocks.edit }),
}));
vi.mock('@/lib/connection-attempt-context', () => ({
  useConnectionAttempts: () => ({ attempts: mocks.attempts }),
}));
vi.mock('@/components/file-browser-view', () => ({
  FileBrowserView: ({ isConnected }: { isConnected: boolean }) => (
    <div>{isConnected ? 'Files ready' : 'Connection lost to storage'}</div>
  ),
}));

function fileTab(protocol: string, connectionStatus: TerminalTab['connectionStatus'] = 'connecting'): TerminalTab {
  return { id: 'storage', name: 'Storage', protocol, tabType: 'file-browser', connectionStatus, reconnectCount: 0 };
}

describe('file connection progress', () => {
  beforeEach(() => { mocks.attempts = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('shows progress before the first backend event instead of connection lost', () => {
    render(<TerminalTabSurface tab={fileTab('SFTP')} isActive themeKey={0} />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.getByText('Connecting to Storage')).toBeTruthy();
    expect(screen.queryByText(/Connection lost/)).toBeNull();
  });

  it('shows SFTP trust confirmation as waiting', () => {
    mocks.attempts.storage = {
      status: 'awaitingHostKey', currentStage: 'verifyingHostKey', failedStage: null,
      errorKind: null, message: null, stages: getConnectStages('SFTP'),
    };
    render(<TerminalTabSurface tab={fileTab('SFTP')} isActive themeKey={0} />);
    expect(screen.getByText('Waiting for host key confirmation')).toBeTruthy();
    expect(screen.queryByLabelText('Requesting PTY')).toBeNull();
    expect(screen.getByLabelText('Initializing SFTP')).toBeTruthy();
    expect(screen.queryByText(/Connection lost/)).toBeNull();
  });

  it('keeps the completed progress visible until the file session is ready', async () => {
    mocks.attempts.storage = {
      status: 'connected', currentStage: 'connected', failedStage: null, errorKind: null, message: null,
    };
    const { rerender } = render(<TerminalTabSurface tab={fileTab('FTP')} isActive themeKey={0} />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.queryByText(/Connection lost/)).toBeNull();
    rerender(<TerminalTabSurface tab={fileTab('FTP', 'connected')} isActive themeKey={0} />);
    expect(await screen.findByText('Files ready')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps FTP failure details and routes retry and edit to the same tab', () => {
    mocks.attempts.storage = {
      status: 'failed', currentStage: 'authenticating', failedStage: 'authenticating',
      errorKind: 'authenticationFailed', message: 'FTP login rejected', stages: getConnectStages('FTP'),
    };
    render(<TerminalTabSurface tab={fileTab('FTP', 'disconnected')} isActive themeKey={0} />);
    expect(screen.getByText('Authentication failed')).toBeTruthy();
    expect(screen.getByText('FTP login rejected')).toBeTruthy();
    expect(screen.queryByText(/Connection lost/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit connection' }));
    expect(mocks.reconnect).toHaveBeenCalledWith('storage');
    expect(mocks.edit).toHaveBeenCalledWith('storage');
    expect(screen.queryByLabelText('Performing SSH handshake')).toBeNull();
  });

  it('shows disconnected only after an actual disconnect', async () => {
    render(<TerminalTabSurface tab={fileTab('SFTP', 'disconnected')} isActive themeKey={0} />);
    expect(await screen.findByText(/Connection lost/)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
