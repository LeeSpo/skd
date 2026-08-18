import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteConnectionSecrets,
  isSavePasswordsEnabled,
  loadConnectionSecrets,
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
  duplicateConnectionWithCredentials,
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
      secretType: 'public_key_credentials',
      secret: JSON.stringify({ version: 1, privateKey: 'pem-content' }),
    });
    expect(invokeMock).toHaveBeenCalledWith('delete_connection_secret', {
      connectionId: 'conn-switch',
      secretType: 'password',
    });
    expect(flags).toEqual({
      hasStoredPassword: false,
      hasStoredPassphrase: false,
      hasStoredPrivateKey: true,
      hasStoredPublicKeyCredentials: true,
    });
  });

  it('update publickey→password prunes private key and passphrase', async () => {
    invokeMock.mockResolvedValue(null);

    const flags = await updateConnectionSecrets(
      'conn-switch-2',
      { password: 'pw', passphrase: undefined, privateKey: undefined },
      {
        hasStoredPassword: false,
        hasStoredPassphrase: true,
        hasStoredPrivateKey: true,
        hasStoredPublicKeyCredentials: true,
      },
      { rememberPassword: true, authMethod: 'password' },
    );

    expect(invokeMock).toHaveBeenCalledWith('delete_connection_secret', {
      connectionId: 'conn-switch-2',
      secretType: 'public_key_credentials',
    });
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
      hasStoredPublicKeyCredentials: false,
    });
  });

  it('preserves the stored passphrase when only the private key is updated', async () => {
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'get_connection_secret' && args?.secretType === 'public_key_credentials') {
        return JSON.stringify({
          version: 1,
          privateKey: 'old-key',
          passphrase: 'stored-passphrase',
        });
      }
      return null;
    });

    await updateConnectionSecrets(
      'conn-partial-key-update',
      { privateKey: 'new-key' },
      {
        hasStoredPassword: false,
        hasStoredPassphrase: true,
        hasStoredPrivateKey: true,
        hasStoredPublicKeyCredentials: true,
      },
      { rememberPassword: true, authMethod: 'publickey' },
    );

    expect(invokeMock).toHaveBeenCalledWith('store_connection_secret', {
      connectionId: 'conn-partial-key-update',
      secretType: 'public_key_credentials',
      secret: JSON.stringify({
        version: 1,
        privateKey: 'new-key',
        passphrase: 'stored-passphrase',
      }),
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
      secretType: 'public_key_credentials',
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

  it('lazily migrates legacy public-key entries and reads the bundle thereafter', async () => {
    const keychain = new Map<string, string>([
      ['passphrase', 'legacy-passphrase'],
      ['private_key', 'legacy-private-key'],
    ]);
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      const secretType = args?.secretType as string | undefined;
      if (command === 'get_connection_secret' && secretType) {
        return keychain.get(secretType) ?? null;
      }
      if (command === 'store_connection_secret' && secretType) {
        keychain.set(secretType, args?.secret as string);
        return null;
      }
      if (command === 'delete_connection_secret' && secretType) {
        keychain.delete(secretType);
        return null;
      }
      return null;
    });

    ConnectionStorageManager.saveConnectionWithId('legacy-public-key', {
      name: 'Legacy public key',
      host: '1.1.1.1',
      port: 22,
      username: 'user',
      protocol: 'SSH',
      authMethod: 'publickey',
      hasStoredPassphrase: true,
      hasStoredPrivateKey: true,
      hasStoredPublicKeyCredentials: false,
    });

    const migrated = await getConnectionWithCredentials('legacy-public-key');
    expect(migrated).toMatchObject({
      passphrase: 'legacy-passphrase',
      privateKeyContent: 'legacy-private-key',
      hasStoredPublicKeyCredentials: true,
    });
    expect(keychain.get('public_key_credentials')).toBe(JSON.stringify({
      version: 1,
      privateKey: 'legacy-private-key',
      passphrase: 'legacy-passphrase',
    }));
    expect(keychain.has('passphrase')).toBe(false);
    expect(keychain.has('private_key')).toBe(false);

    invokeMock.mockClear();
    await getConnectionWithCredentials('legacy-public-key');
    expect(invokeMock.mock.calls.filter(([command]) => command === 'get_connection_secret'))
      .toEqual([[
        'get_connection_secret',
        { connectionId: 'legacy-public-key', secretType: 'public_key_credentials' },
      ]]);
  });

  it('keeps legacy public-key metadata when bundle migration cannot be stored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'get_connection_secret' && args?.secretType === 'passphrase') {
        return 'legacy-passphrase';
      }
      if (command === 'get_connection_secret' && args?.secretType === 'private_key') {
        return 'legacy-private-key';
      }
      if (command === 'store_connection_secret' && args?.secretType === 'public_key_credentials') {
        throw new Error('Keychain write failed');
      }
      return null;
    });

    ConnectionStorageManager.saveConnectionWithId('legacy-write-failure', {
      name: 'Legacy write failure',
      host: '1.1.1.1',
      port: 22,
      username: 'user',
      protocol: 'SSH',
      authMethod: 'publickey',
      hasStoredPassphrase: true,
      hasStoredPrivateKey: true,
      hasStoredPublicKeyCredentials: false,
    });

    const hydrated = await getConnectionWithCredentials('legacy-write-failure');
    expect(hydrated).toMatchObject({
      passphrase: 'legacy-passphrase',
      privateKeyContent: 'legacy-private-key',
      hasStoredPublicKeyCredentials: false,
    });
    expect(invokeMock).not.toHaveBeenCalledWith('delete_connection_secret', expect.anything());
    expect(ConnectionStorageManager.getConnection('legacy-write-failure'))
      .toMatchObject({ hasStoredPublicKeyCredentials: false });
    warn.mockRestore();
  });

  it('migrates a legacy path-based key that only stored a passphrase', async () => {
    let bundle: string | undefined;
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'get_connection_secret' && args?.secretType === 'passphrase') {
        return 'legacy-passphrase';
      }
      if (command === 'store_connection_secret' && args?.secretType === 'public_key_credentials') {
        bundle = args?.secret as string;
      }
      return null;
    });
    ConnectionStorageManager.saveConnectionWithId('legacy-path-key', {
      name: 'Legacy path key',
      host: 'example.com',
      port: 22,
      username: 'user',
      protocol: 'SSH',
      authMethod: 'publickey',
      privateKeySource: 'path',
      privateKeyPath: '/Users/example/.ssh/id_ed25519',
      hasStoredPassphrase: true,
      hasStoredPrivateKey: false,
      hasStoredPublicKeyCredentials: false,
    });

    const hydrated = await getConnectionWithCredentials('legacy-path-key');
    expect(hydrated).toMatchObject({
      passphrase: 'legacy-passphrase',
      privateKeyPath: '/Users/example/.ssh/id_ed25519',
      hasStoredPublicKeyCredentials: true,
      hasStoredPrivateKey: false,
    });
    expect(bundle).toBe(JSON.stringify({ version: 1, passphrase: 'legacy-passphrase' }));
  });

  it('deleteConnectionSecrets invokes backend delete command', async () => {
    await deleteConnectionSecrets('conn-3');

    expect(invokeMock).toHaveBeenCalledWith('delete_connection_secrets', {
      connectionId: 'conn-3',
    });
  });

  it('stores public-key authentication material in one Keychain entry', async () => {
    const flags = await storeConnectionSecrets(
      'conn-4',
      { privateKey: 'pem-content', passphrase: 'key-passphrase' },
      { force: true },
    );

    const stores = invokeMock.mock.calls.filter(([command]) => command === 'store_connection_secret');
    expect(stores).toEqual([[
      'store_connection_secret',
      {
        connectionId: 'conn-4',
        secretType: 'public_key_credentials',
        secret: JSON.stringify({
          version: 1,
          privateKey: 'pem-content',
          passphrase: 'key-passphrase',
        }),
      },
    ]]);
    expect(flags).toEqual({
      hasStoredPassword: false,
      hasStoredPassphrase: true,
      hasStoredPrivateKey: true,
      hasStoredPublicKeyCredentials: true,
    });
  });

  it('loads a public-key credential bundle with one Keychain read', async () => {
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'get_connection_secret' && args?.secretType === 'public_key_credentials') {
        return JSON.stringify({
          version: 1,
          privateKey: 'pem-content',
          passphrase: 'key-passphrase',
        });
      }
      return null;
    });

    const secrets = await loadConnectionSecrets('conn-bundled-key', {
      hasStoredPassphrase: true,
      hasStoredPrivateKey: true,
      hasStoredPublicKeyCredentials: true,
    });

    expect(secrets).toEqual({
      privateKey: 'pem-content',
      passphrase: 'key-passphrase',
    });
    expect(invokeMock.mock.calls.filter(([command]) => command === 'get_connection_secret'))
      .toHaveLength(1);
  });

  it.each([
    ['invalid JSON', 'not-json', 'Stored public-key credentials are invalid.'],
    ['unsupported version', JSON.stringify({ version: 2, privateKey: 'key' }), 'Stored public-key credentials use an unsupported version.'],
  ])('rejects %s in a public-key credential bundle', async (_caseName, stored, message) => {
    invokeMock.mockResolvedValue(stored);

    await expect(loadConnectionSecrets('conn-invalid-bundle', {
      hasStoredPublicKeyCredentials: true,
    })).rejects.toThrow(message);
  });

  it('duplicates a public-key connection through one bundled read and write', async () => {
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'get_connection_secret' && args?.secretType === 'public_key_credentials') {
        return JSON.stringify({ version: 1, privateKey: 'key', passphrase: 'phrase' });
      }
      return null;
    });
    ConnectionStorageManager.saveConnectionWithId('duplicate-source', {
      name: 'Source',
      host: 'example.com',
      port: 22,
      username: 'user',
      protocol: 'SSH',
      authMethod: 'publickey',
      hasStoredPassphrase: true,
      hasStoredPrivateKey: true,
      hasStoredPublicKeyCredentials: true,
    });

    const duplicated = await duplicateConnectionWithCredentials('duplicate-source', {
      name: 'Copy',
      host: 'example.com',
      port: 22,
      username: 'user',
      protocol: 'SSH',
      authMethod: 'publickey',
    });

    expect(duplicated).toMatchObject({
      name: 'Copy',
      hasStoredPublicKeyCredentials: true,
    });
    expect(invokeMock.mock.calls.filter(
      ([command, args]) => command === 'get_connection_secret'
        && (args as Record<string, unknown>).secretType === 'public_key_credentials',
    )).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(
      ([command, args]) => command === 'store_connection_secret'
        && (args as Record<string, unknown>).secretType === 'public_key_credentials',
    )).toHaveLength(1);
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
      hasStoredPublicKeyCredentials: true,
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
    expect(conn?.hasStoredPublicKeyCredentials).toBe(false);
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
          hasStoredPublicKeyCredentials: true,
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
    expect(imported?.hasStoredPublicKeyCredentials).toBe(false);
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
      hasStoredPublicKeyCredentials: false,
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
