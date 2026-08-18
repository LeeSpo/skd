import { invoke } from '@tauri-apps/api/core';
import { APP_SETTINGS_STORAGE_KEY } from './keyboard-shortcuts';

export type ConnectionSecretType =
  | 'password'
  | 'public_key_credentials';

type LegacyConnectionSecretType = 'passphrase' | 'private_key';
type ReadableConnectionSecretType = ConnectionSecretType | LegacyConnectionSecretType;

export type CredentialAuthMethod =
  | 'password'
  | 'publickey'
  | 'keyboard-interactive'
  | 'anonymous';

export interface ConnectionSecrets {
  password?: string;
  passphrase?: string;
  privateKey?: string;
}

export interface ConnectionSecretUpdate {
  password?: string | null;
  passphrase?: string | null;
  privateKey?: string | null;
}

export interface StoredCredentialFlags {
  hasStoredPassword: boolean;
  hasStoredPassphrase: boolean;
  hasStoredPrivateKey: boolean;
  hasStoredPublicKeyCredentials: boolean;
}

export interface CredentialStoreOptions {
  force?: boolean;
  rememberPassword?: boolean;
  authMethod?: CredentialAuthMethod;
}

interface PublicKeyCredentialsV1 {
  version: 1;
  privateKey?: string;
  passphrase?: string;
}

function serializePublicKeyCredentials(secrets: ConnectionSecrets): string {
  const credentials: PublicKeyCredentialsV1 = {
    version: 1,
    ...(secrets.privateKey ? { privateKey: secrets.privateKey } : {}),
    ...(secrets.passphrase ? { passphrase: secrets.passphrase } : {}),
  };
  return JSON.stringify(credentials);
}

function parsePublicKeyCredentials(raw: string): ConnectionSecrets {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Stored public-key credentials are invalid.');
  }

  if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1) {
    throw new Error('Stored public-key credentials use an unsupported version.');
  }

  const credentials = parsed as Record<string, unknown>;
  const privateKey = credentials.privateKey;
  const passphrase = credentials.passphrase;
  if (
    (privateKey !== undefined && typeof privateKey !== 'string')
    || (passphrase !== undefined && typeof passphrase !== 'string')
  ) {
    throw new Error('Stored public-key credentials are invalid.');
  }

  if (!privateKey && !passphrase) {
    throw new Error('Stored public-key credentials are empty.');
  }

  return {
    ...(privateKey ? { privateKey } : {}),
    ...(passphrase ? { passphrase } : {}),
  };
}

/**
 * Global opt-out for saving credentials (optional settings key).
 * Defaults to true. Dialog-level `rememberPassword` remains the primary control.
 */
export function isSavePasswordsEnabled(): boolean {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { savePasswords?: boolean };
    return parsed.savePasswords !== false;
  } catch {
    return true;
  }
}

function shouldStoreSecrets(options?: CredentialStoreOptions): boolean {
  if (options?.force) return true;
  const remember = options?.rememberPassword ?? true;
  return remember && isSavePasswordsEnabled();
}

export async function storeConnectionSecret(
  connectionId: string,
  secretType: ConnectionSecretType,
  secret: string,
): Promise<void> {
  await invoke('store_connection_secret', {
    connectionId,
    secretType,
    secret,
  });
}

export async function getConnectionSecret(
  connectionId: string,
  secretType: ReadableConnectionSecretType,
): Promise<string | undefined> {
  const secret = await invoke<string | null>('get_connection_secret', {
    connectionId,
    secretType,
  });

  return secret ?? undefined;
}

export async function deleteConnectionSecret(
  connectionId: string,
  secretType: ReadableConnectionSecretType,
): Promise<void> {
  await invoke('delete_connection_secret', {
    connectionId,
    secretType,
  });
}

export async function deleteConnectionSecrets(connectionId: string): Promise<void> {
  await invoke('delete_connection_secrets', { connectionId });
}

async function writeProvidedSecrets(
  connectionId: string,
  secrets: ConnectionSecrets,
): Promise<StoredCredentialFlags> {
  let hasStoredPassword = false;
  let hasStoredPassphrase = false;
  let hasStoredPrivateKey = false;
  let hasStoredPublicKeyCredentials = false;

  if (secrets.password) {
    await storeConnectionSecret(connectionId, 'password', secrets.password);
    hasStoredPassword = true;
  }

  if (secrets.passphrase || secrets.privateKey) {
    await storeConnectionSecret(
      connectionId,
      'public_key_credentials',
      serializePublicKeyCredentials(secrets),
    );
    hasStoredPassphrase = !!secrets.passphrase;
    hasStoredPrivateKey = !!secrets.privateKey;
    hasStoredPublicKeyCredentials = true;
  }

  return {
    hasStoredPassword,
    hasStoredPassphrase,
    hasStoredPrivateKey,
    hasStoredPublicKeyCredentials,
  };
}

/**
 * Full-replace store: clears existing Keychain entries for the connection, then
 * writes only the provided secrets. Use for new saves and duplicate targets.
 */
export async function storeConnectionSecrets(
  connectionId: string,
  secrets: ConnectionSecrets,
  options?: CredentialStoreOptions,
): Promise<StoredCredentialFlags> {
  if (!shouldStoreSecrets(options)) {
    await deleteConnectionSecrets(connectionId);
    return {
      hasStoredPassword: false,
      hasStoredPassphrase: false,
      hasStoredPrivateKey: false,
      hasStoredPublicKeyCredentials: false,
    };
  }

  // Delete first so reused connection IDs cannot leave orphan secret types.
  await deleteConnectionSecrets(connectionId);
  return writeProvidedSecrets(connectionId, secrets);
}

/** Write migration material without clearing unrelated authentication entries. */
export async function mergeConnectionSecrets(
  connectionId: string,
  secrets: ConnectionSecrets,
): Promise<StoredCredentialFlags> {
  return writeProvidedSecrets(connectionId, secrets);
}

/**
 * Prune Keychain entries that are irrelevant for the current auth method.
 */
export async function pruneSecretsForAuthMethod(
  connectionId: string,
  authMethod: CredentialAuthMethod,
  flags: StoredCredentialFlags,
): Promise<StoredCredentialFlags> {
  let hasStoredPassword = flags.hasStoredPassword;
  let hasStoredPassphrase = flags.hasStoredPassphrase;
  let hasStoredPrivateKey = flags.hasStoredPrivateKey;
  let hasStoredPublicKeyCredentials = flags.hasStoredPublicKeyCredentials;

  switch (authMethod) {
    case 'password':
      if (hasStoredPublicKeyCredentials) {
        await deleteConnectionSecret(connectionId, 'public_key_credentials');
        hasStoredPublicKeyCredentials = false;
      }
      if (hasStoredPrivateKey) {
        await deleteConnectionSecret(connectionId, 'private_key');
        hasStoredPrivateKey = false;
      }
      if (hasStoredPassphrase) {
        await deleteConnectionSecret(connectionId, 'passphrase');
        hasStoredPassphrase = false;
      }
      break;
    case 'keyboard-interactive':
      await deleteConnectionSecrets(connectionId);
      hasStoredPassword = false;
      hasStoredPassphrase = false;
      hasStoredPrivateKey = false;
      hasStoredPublicKeyCredentials = false;
      break;
    case 'publickey':
      if (hasStoredPassword) {
        await deleteConnectionSecret(connectionId, 'password');
        hasStoredPassword = false;
      }
      break;
    case 'anonymous':
      await deleteConnectionSecrets(connectionId);
      hasStoredPassword = false;
      hasStoredPassphrase = false;
      hasStoredPrivateKey = false;
      hasStoredPublicKeyCredentials = false;
      break;
    default:
      break;
  }

  return {
    hasStoredPassword,
    hasStoredPassphrase,
    hasStoredPrivateKey,
    hasStoredPublicKeyCredentials,
  };
}

/**
 * Partial update for editing an existing profile.
 * - Newly provided secrets are written.
 * - Unspecified secrets keep existing flags (user left password blank on edit).
 * - Auth-method prune removes orphan types after the write.
 */
export async function updateConnectionSecrets(
  connectionId: string,
  secrets: ConnectionSecretUpdate,
  existing: {
    hasStoredPassword?: boolean;
    hasStoredPassphrase?: boolean;
    hasStoredPrivateKey?: boolean;
    hasStoredPublicKeyCredentials?: boolean;
  },
  options?: CredentialStoreOptions,
): Promise<StoredCredentialFlags> {
  if (!shouldStoreSecrets(options)) {
    await deleteConnectionSecrets(connectionId);
    return {
      hasStoredPassword: false,
      hasStoredPassphrase: false,
      hasStoredPrivateKey: false,
      hasStoredPublicKeyCredentials: false,
    };
  }

  let hasStoredPassword = existing.hasStoredPassword ?? false;
  let hasStoredPassphrase = existing.hasStoredPassphrase ?? false;
  let hasStoredPrivateKey = existing.hasStoredPrivateKey ?? false;
  let hasStoredPublicKeyCredentials = existing.hasStoredPublicKeyCredentials ?? false;

  if (secrets.password) {
    await storeConnectionSecret(connectionId, 'password', secrets.password);
    hasStoredPassword = true;
  }

  const hasPassphraseUpdate = Object.prototype.hasOwnProperty.call(secrets, 'passphrase');
  const hasPrivateKeyUpdate = Object.prototype.hasOwnProperty.call(secrets, 'privateKey');
  if (hasPassphraseUpdate || hasPrivateKeyUpdate) {
    let storedSecrets: ConnectionSecrets = {};
    if (
      (!hasPassphraseUpdate || !hasPrivateKeyUpdate)
      && (hasStoredPublicKeyCredentials || hasStoredPassphrase || hasStoredPrivateKey)
    ) {
      storedSecrets = await loadConnectionSecrets(connectionId, {
        hasStoredPassphrase,
        hasStoredPrivateKey,
        hasStoredPublicKeyCredentials,
      });
    }
    const mergedSecrets: ConnectionSecrets = {
      privateKey: hasPrivateKeyUpdate
        ? secrets.privateKey || undefined
        : storedSecrets.privateKey,
      passphrase: hasPassphraseUpdate
        ? secrets.passphrase || undefined
        : storedSecrets.passphrase,
    };

    if (!mergedSecrets.passphrase && !mergedSecrets.privateKey) {
      await deleteConnectionSecret(connectionId, 'public_key_credentials');
      if (existing.hasStoredPrivateKey) {
        await deleteConnectionSecret(connectionId, 'private_key');
      }
      if (existing.hasStoredPassphrase) {
        await deleteConnectionSecret(connectionId, 'passphrase');
      }
      hasStoredPassphrase = false;
      hasStoredPrivateKey = false;
      hasStoredPublicKeyCredentials = false;
    } else {
      await storeConnectionSecret(
        connectionId,
        'public_key_credentials',
        serializePublicKeyCredentials(mergedSecrets),
      );
      hasStoredPassphrase = !!mergedSecrets.passphrase;
      hasStoredPrivateKey = !!mergedSecrets.privateKey;
      hasStoredPublicKeyCredentials = true;
    }
  }

  if (options?.authMethod) {
    return pruneSecretsForAuthMethod(connectionId, options.authMethod, {
      hasStoredPassword,
      hasStoredPassphrase,
      hasStoredPrivateKey,
      hasStoredPublicKeyCredentials,
    });
  }

  return {
    hasStoredPassword,
    hasStoredPassphrase,
    hasStoredPrivateKey,
    hasStoredPublicKeyCredentials,
  };
}

export async function loadConnectionSecrets(
  connectionId: string,
  flags?: {
    hasStoredPassword?: boolean;
    hasStoredPassphrase?: boolean;
    hasStoredPrivateKey?: boolean;
    hasStoredPublicKeyCredentials?: boolean;
  },
): Promise<ConnectionSecrets> {
  const secrets: ConnectionSecrets = {};

  if (flags?.hasStoredPassword) {
    secrets.password = await getConnectionSecret(connectionId, 'password');
  }

  if (flags?.hasStoredPublicKeyCredentials) {
    const raw = await getConnectionSecret(connectionId, 'public_key_credentials');
    if (!raw) {
      throw new Error('Stored public-key credentials are missing.');
    }
    Object.assign(secrets, parsePublicKeyCredentials(raw));
  } else if (flags?.hasStoredPassphrase) {
    secrets.passphrase = await getConnectionSecret(connectionId, 'passphrase');
    if (flags?.hasStoredPrivateKey) {
      secrets.privateKey = await getConnectionSecret(connectionId, 'private_key');
    }
  } else if (flags?.hasStoredPrivateKey) {
    secrets.privateKey = await getConnectionSecret(connectionId, 'private_key');
  }

  return secrets;
}

/** v1 migrated password/passphrase only; v2 also migrates privateKeyContent. */
export const KEYCHAIN_MIGRATION_FLAG = 'skd-keychain-migrated-v2';
export const KEYCHAIN_MIGRATION_FLAG_V1 = 'skd-keychain-migrated-v1';
