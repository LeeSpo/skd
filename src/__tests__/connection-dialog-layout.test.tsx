import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ConnectionDialog, type ConnectionConfig } from '@/components/connection-dialog';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

function fieldOrder(ids: string[]): string[] {
  return ids
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => el !== null)
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map((el) => el.id);
}

function connection(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'c1',
    name: 'Test',
    protocol: 'SSH',
    host: 'example.com',
    port: 22,
    username: 'root',
    authMethod: 'password',
    ...overrides,
  };
}

describe('ConnectionDialog field layout', () => {
  afterEach(() => {
    cleanup();
  });

  it('puts identity, destination, then login fields on one Connection tab', () => {
    render(
      <ConnectionDialog
        open
        onOpenChange={vi.fn()}
        onConnect={vi.fn()}
      />,
    );

    expect(fieldOrder([
      'connection-name',
      'protocol',
      'host',
      'port',
      'username',
      'auth-method',
      'password',
    ])).toEqual([
      'connection-name',
      'protocol',
      'host',
      'port',
      'username',
      'auth-method',
      'password',
    ]);
  });

  it('does not keep a separate Auth tab', () => {
    render(
      <ConnectionDialog
        open
        onOpenChange={vi.fn()}
        onConnect={vi.fn()}
      />,
    );

    expect(screen.queryByRole('tab', { name: 'Auth' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Connection' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Proxy' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Advanced' })).toBeTruthy();
  });

  it('shows password and remember-password on the Connection tab by default', () => {
    render(
      <ConnectionDialog
        open
        onOpenChange={vi.fn()}
        onConnect={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByLabelText('Remember Password')).toBeTruthy();
  });

  it('shows private key fields when editing a publickey connection', () => {
    render(
      <ConnectionDialog
        open
        onOpenChange={vi.fn()}
        onConnect={vi.fn()}
        editingConnection={connection({ authMethod: 'publickey', privateKeySource: 'path' })}
      />,
    );

    expect(screen.getByLabelText('Private Key File')).toBeTruthy();
    expect(screen.getByLabelText('Passphrase (optional)')).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByLabelText('Remember Password')).toBeTruthy();
  });

  it('shows FTPS next to connection settings when editing an FTP profile', () => {
    render(
      <ConnectionDialog
        open
        onOpenChange={vi.fn()}
        onConnect={vi.fn()}
        editingConnection={connection({ protocol: 'FTP', port: 21, authMethod: 'password' })}
      />,
    );

    expect(screen.getByText('Enable FTPS (FTP over TLS)')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('hides remember-password for keyboard-interactive auth', () => {
    render(
      <ConnectionDialog
        open
        onOpenChange={vi.fn()}
        onConnect={vi.fn()}
        editingConnection={connection({ authMethod: 'keyboard-interactive' })}
      />,
    );

    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByLabelText('Remember Password')).toBeNull();
  });
});
