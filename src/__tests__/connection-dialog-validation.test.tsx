import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { ConnectionDialog, type ConnectionConfig } from '@/components/connection-dialog';
import {
  saveConnectionWithCredentials,
  updateConnectionWithCredentials,
} from '@/lib/connection-storage';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/connection-storage', () => ({
  ConnectionStorageManager: {
    getValidFolders: vi.fn(() => []),
    getConnection: vi.fn(),
  },
  getConnectionWithCredentials: vi.fn(),
  saveConnectionWithCredentials: vi.fn(),
  updateConnectionWithCredentials: vi.fn(),
}));

function renderConnection(overrides: Partial<ConnectionConfig> = {}) {
  const onConnect = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ConnectionDialog
      open
      onOpenChange={onOpenChange}
      onConnect={onConnect}
      editingConnection={{
        id: 'test-connection',
        name: 'Storage',
        protocol: 'FTP',
        host: '192.0.2.1:53211',
        port: 21,
        username: 'test-user',
        authMethod: 'password',
        ...overrides,
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } });
  return { onConnect, onOpenChange };
}

describe('ConnectionDialog destination validation', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it.each([
    'storage.example.com:53211',
    '[2001:db8::1]:53211',
  ])('rejects host %s before saving or connecting', async (host) => {
    const { onConnect, onOpenChange } = renderConnection({ protocol: 'SFTP', host });
    fireEvent.click(screen.getByRole('button', { name: 'Update & Connect' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Enter the port separately', {
        description: 'Host must contain only a hostname or IP address. Move the port number to the Port field.',
      });
    });
    expect(onConnect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(updateConnectionWithCredentials).not.toHaveBeenCalled();
    expect(saveConnectionWithCredentials).not.toHaveBeenCalled();
  });

  it('allows a rejected destination to be corrected and connected over SFTP', async () => {
    const { onConnect } = renderConnection({ protocol: 'SFTP' });
    fireEvent.click(screen.getByRole('button', { name: 'Update & Connect' }));
    expect(toast.error).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Host'), { target: { value: '192.0.2.1' } });
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '53211' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update & Connect' }));

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({
        protocol: 'SFTP', host: '192.0.2.1', port: 53211,
      }));
    });
    expect(updateConnectionWithCredentials).toHaveBeenCalledWith(
      'test-connection',
      expect.objectContaining({ protocol: 'SFTP', host: '192.0.2.1', port: 53211 }),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('passes an unbracketed IPv6 host and a separate port through', async () => {
    const destination = { protocol: 'SFTP' as const, host: '2001:db8::1', port: 53211 };
    const { onConnect } = renderConnection(destination);
    fireEvent.click(screen.getByRole('button', { name: 'Update & Connect' }));

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith(expect.objectContaining(destination));
    });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
