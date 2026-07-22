import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteConnectionSecrets,
  isSavePasswordsEnabled,
  storeConnectionSecrets,
  updateConnectionSecrets,
  KEYCHAIN_MIGRATION_FLAG,
  KEYCHAIN_MIGRATION_FLAG_V1,
} from '../credential-storage';
import { APP_SETTINGS_STORAGE_KEY } from '../keyboard-shortcuts';
import {
  clearAllConnectionsWithCredentials,
  cleanupKeyboardInteractiveCredentials,
  connectionHasStoredCredentials,
  ConnectionStorageManager,
  getConnectionWithCredentials,
  migratePlaintextCredentialsToKeychain,
} from '../connection-storage';
import { getPrivateKeyContentForConnection } from '../resolve-private-key';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  ConnectionStorageManager.initialize();
});

describe('credential storage', () => {
  it('isSavePasswordsEnabled returns true by default', () => {
    expect(isSavePasswordsEnabled()).toBe(true);
  });

  it('isSavePasswordsEnabled respects savePasswords: false in settings', () => {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ savePasswords: false }));
    expect(isSavePasswordsEnabled()).toBe(false);
  });

  it('does not store secrets when rememberPassword is false', async () => {
    await storeConnectionSecrets('conn-1', { password: 'secret' }, { rememberPassword: false });

    expect(invokeMock).not.toHaveBeenCalledWith('store_connection_secret', expect.anything());
    expect(invokeMock).toHaveBeenCalledWith('delete_connection_secrets', {
      connectionId: 'conn-1',
    });
  });

  it('full-replace store deletes existing secrets before writing', async () => {
    invokeMock.mockResolvedValue(null);

    await storeConnectionSecrets('conn-replace', { password: 'new-pw' }, { force: true });

    const deleteIdx = invokeMock.mock.calls.findIndex(
      ([cmd]) => cmd === 'delete_connection_secrets',
    );
    const storeIdx = invokeMock.mock.calls.findIndex(
      ([cmd]) => cmd === 'store_connection_secret',
    );

    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(storeIdx).toBeGreaterThan(deleteIdx);
    expect(invokeMock).toHaveBeenCalledWith('store_connection_secret', {
      connectionId: 'conn-replace',
      secretType: 'password',
      secret: 'new-pw',
    });
  });

  it('update password→publickey prunes password secret', async () => {
    invokeMock.mockResolvedValue(null);

    const flags = await updateConnectionSecrets(
      'conn-switch',
      { privateKey: 'pem-content' },
      { hasStoredPassword: true, hasStoredPassphrase: false, hasStoredPrivateKey: false },
      { rememberPassword: true, authMethod: 'publickey' },
    );

    expect(invokeMock).toHaveBeenCalledWith('store_connection_secret', {
      connectionId: 'conn-switch',
      secretType: 'private_key',
      secret: 'pem-content',
    });
    expect(invokeMock).toHaveBeenCalledWith('delete_connection_secret', {
      connectionId: 'conn-switch',
      secretType: 'password',
    });
    expect(flags).toEqual({
      hasStoredPassword: false,
      hasStoredPassphrase: false,
      hasStoredPrivateKey: true,
    });
  });

  it('update publickey→password prunes private key and passphrase', async () => {
    invokeMock.mockResolvedValue(null);

    const flags = await updateConnectionSecrets(
      'conn-switch-2',
      { password: 'pw' },
      { hasStoredPassword: false, hasStoredPassphrase: true, hasStoredPrivateKey: true },
      { rememberPassword: true, authMethod: 'password' },
    );

    expect(invokeMock).toHaveBeenCalledWith('delete_connection_secret', {
      connectionId: 'conn-switch-2',
      secretType: 'private_key',
    });
    expect(invokeMock).toHaveBeenCalledWith('delete_connection_secret', {
      connectionId: 'conn-switch-2',
      secretType: 'passphrase',
    });
    expect(flags).toEqual({
      hasStoredPassword: true,
      hasStoredPassphrase: false,
      hasStoredPrivateKey: false,
    });
  });

  it('persists only metadata flags in localStorage after migration', async () => {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ savePasswords: true }));
    invokeMock.mockResolvedValue(null);

    localStorage.setItem('skd-connections', JSON.stringify([
      {
        id: 'legacy-conn',
        name: 'Test',
        host: '1.1.1.1',
        port: 22,
        username: 'user',
        protocol: 'SSH',
        authMethod: 'password',
        password: 'plain-secret',
        createdAt: new Date().toISOString(),
        folder: 'All Connections',
      },
    ]));

    await migratePlaintextCredentialsToKeychain();

    const storedRaw = localStorage.getItem('skd-connections');
    expect(storedRaw).toBeDefined();
    expect(storedRaw).not.toContain('plain-secret');

    const loaded = ConnectionStorageManager.getConnection('legacy-conn');
    expect(loaded?.hasStoredPassword).toBe(true);
    expect(loaded?.password).toBeUndefined();
    expect(localStorage.getItem(KEYCHAIN_MIGRATION_FLAG)).toBe('1');
  });

  it('migration v2 moves privateKeyContent into Keychain even after v1 flag', async () => {
    localStorage.setItem(KEYCHAIN_MIGRATION_FLAG_V1, '1');
    invokeMock.mockResolvedValue(null);

    localStorage.setItem('skd-connections', JSON.stringify([
      {
        id: 'legacy-key',
        name: 'Key',
        host: '1.1.1.1',
        port: 22,
        username: 'user',
        protocol: 'SSH',
        authMethod: 'publickey',
        privateKeyContent: '-----BEGIN OPENSSH PRIVATE KEY-----\nAAA\n-----END OPENSSH PRIVATE KEY-----',
        hasStoredPassword: true,
        createdAt: new Date().toISOString(),
        folder: 'All Connections',
      },
    ]));

    const count = await migratePlaintextCredentialsToKeychain();
    expect(count).toBe(1);

    expect(invokeMock).toHaveBeenCalledWith('store_connection_secret', {
      connectionId: 'legacy-key',
      secretType: 'private_key',
      secret: expect.stringContaining('BEGIN OPENSSH PRIVATE KEY'),
    });

    const loaded = ConnectionStorageManager.getConnection('legacy-key');
    expect(loaded?.hasStoredPrivateKey).toBe(true);
    expect(loaded?.hasStoredPassword).toBe(true);
    expect(loaded?.privateKeyContent).toBeUndefined();
    expect(localStorage.getItem(KEYCHAIN_MIGRATION_FLAG)).toBe('1');
    expect(localStorage.getItem(KEYCHAIN_MIGRATION_FLAG_V1)).toBeNull();
  });

  it('hydrates secrets through getConnectionWithCredentials', async () => {
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'get_connection_secret' && args?.secretType === 'password') {
        return 'keychain-password';
      }
      return null;
    });

    ConnectionStorageManager.saveConnectionWithId('conn-2', {
      name: 'Hydrate',
      host: '1.1.1.1',
      port: 22,
      username: 'user',
      protocol: 'SSH',
      authMethod: 'password',
      hasStoredPassword: true,
    });

    const hydrated = await getConnectionWithCredentials('conn-2');
    expect(hydrated?.password).toBe('keychain-password');
  });

  it('deleteConnectionSecrets invokes backend delete command', async () => {
    await deleteConnectionSecrets('conn-3');

    expect(invokeMock).toHaveBeenCalledWith('delete_connection_secrets', {
      connectionId: 'conn-3',
    });
  });

  it('stores private_key in Keychain when provided', async () => {
    await storeConnectionSecrets('conn-4', { privateKey: 'pem-content' }, { force: true });

    expect(invokeMock).toHaveBeenCalledWith('store_connection_secret', {
      connectionId: 'conn-4',
      secretType: 'private_key',
      secret: 'pem-content',
    });
  });

  it('export strips secrets and hasStored flags', () => {
    ConnectionStorageManager.saveConnectionWithId('export-1', {
      name: 'Export Me',
      host: '1.1.1.1',
      port: 22,
      username: 'user',
      protocol: 'SSH',
      authMethod: 'password',
      hasStoredPassword: true,
      hasStoredPassphrase: true,
      hasStoredPrivateKey: true,
    });

    const exported = JSON.parse(ConnectionStorageManager.exportConnections()) as {
      connections: Array<Record<string, unknown>>;
      secretsExcluded: boolean;
    };

    expect(exported.secretsExcluded).toBe(true);
    const conn = exported.connections.find((c) => c.name === 'Export Me');
    expect(conn).toBeDefined();
    expect(conn?.hasStoredPassword).toBe(false);
    expect(conn?.hasStoredPassphrase).toBe(false);
    expect(conn?.hasStoredPrivateKey).toBe(false);
    expect(conn?.password).toBeUndefined();
  });

  it('import resets hasStored flags and uses new ids', () => {
    const payload = JSON.stringify({
      connections: [
        {
          id: 'old-id',
          name: 'Imported',
          host: '2.2.2.2',
          port: 22,
          username: 'u',
          protocol: 'SSH',
          authMethod: 'password',
          hasStoredPassword: true,
          password: 'should-not-persist',
          createdAt: new Date().toISOString(),
          folder: 'All Connections',
        },
      ],
      folders: [],
      secretsExcluded: true,
    });

    const count = ConnectionStorageManager.importConnections(payload);
    expect(count).toBe(1);

    const imported = ConnectionStorageManager.getConnections().find((c) => c.name === 'Imported');
    expect(imported).toBeDefined();
    expect(imported?.id).not.toBe('old-id');
    expect(imported?.hasStoredPassword).toBe(false);
    expect(imported?.password).toBeUndefined();
  });

  it('clearAllConnectionsWithCredentials deletes each Keychain entry', async () => {
    invokeMock.mockResolvedValue(null);

    ConnectionStorageManager.saveConnectionWithId('wipe-a', {
      name: 'A',
      host: '1.1.1.1',
      port: 22,
      username: 'u',
      protocol: 'SSH',
      authMethod: 'password',
      hasStoredPassword: true,
    });
    ConnectionStorageManager.saveConnectionWithId('wipe-b', {
      name: 'B',
      host: '2.2.2.2',
      port: 22,
      username: 'u',
      protocol: 'SSH',
      authMethod: 'password',
      hasStoredPassword: true,
    });

    await clearAllConnectionsWithCredentials();

    expect(invokeMock).toHaveBeenCalledWith('delete_connection_secrets', { connectionId: 'wipe-a' });
    expect(invokeMock).toHaveBeenCalledWith('delete_connection_secrets', { connectionId: 'wipe-b' });
    expect(ConnectionStorageManager.getConnections()).toHaveLength(0);
  });

  it('getPrivateKeyContentForConnection loads from Keychain when only flag is set', async () => {
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'get_connection_secret' && args?.secretType === 'private_key') {
        return '-----BEGIN OPENSSH PRIVATE KEY-----\nfrom-keychain\n-----END OPENSSH PRIVATE KEY-----';
      }
      return null;
    });

    const content = await getPrivateKeyContentForConnection({
      id: 'conn-key-only',
      hasStoredPrivateKey: true,
      privateKeySource: 'paste',
    });

    expect(content).toContain('from-keychain');
    expect(invokeMock).toHaveBeenCalledWith('get_connection_secret', {
      connectionId: 'conn-key-only',
      secretType: 'private_key',
    });
  });

  it('keyboard-interactive connections do not require stored credentials', () => {
    expect(connectionHasStoredCredentials({
      id: 'kbd-1',
      name: 'Interactive',
      host: 'example.com',
      port: 22,
      username: 'user',
      protocol: 'SSH',
      authMethod: 'keyboard-interactive',
      createdAt: new Date().toISOString(),
    })).toBe(true);
  });

  it('keyboard-interactive secret pruning removes every stored secret', async () => {
    invokeMock.mockResolvedValue(null);

    const flags = await updateConnectionSecrets(
      'kbd-prune',
      { password: 'must-not-survive', passphrase: 'also-remove', privateKey: 'key' },
      { hasStoredPassword: true, hasStoredPassphrase: true, hasStoredPrivateKey: true },
      { rememberPassword: true, authMethod: 'keyboard-interactive' },
    );

    expect(invokeMock).toHaveBeenCalledWith('delete_connection_secrets', {
      connectionId: 'kbd-prune',
    });
    expect(flags).toEqual({
      hasStoredPassword: false,
      hasStoredPassphrase: false,
      hasStoredPrivateKey: false,
    });
  });

  it('cleans legacy keyboard-interactive credentials once', async () => {
    invokeMock.mockResolvedValue(null);
    ConnectionStorageManager.saveConnectionWithId('kbd-legacy', {
      name: 'Legacy Interactive',
      host: 'example.com',
      port: 22,
      username: 'user',
      protocol: 'SSH',
      authMethod: 'keyboard-interactive',
      hasStoredPassword: true,
      hasStoredPassphrase: true,
      hasStoredPrivateKey: true,
    });

    expect(await cleanupKeyboardInteractiveCredentials()).toBe(1);
    expect(invokeMock).toHaveBeenCalledWith('delete_connection_secrets', {
      connectionId: 'kbd-legacy',
    });
    expect(ConnectionStorageManager.getConnection('kbd-legacy')).toMatchObject({
      hasStoredPassword: false,
      hasStoredPassphrase: false,
      hasStoredPrivateKey: false,
    });

    invokeMock.mockClear();
    expect(await cleanupKeyboardInteractiveCredentials()).toBe(0);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
