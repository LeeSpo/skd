import { invoke } from '@tauri-apps/api/core';
import { APP_SETTINGS_STORAGE_KEY } from './keyboard-shortcuts';

export type ConnectionSecretType = 'password' | 'passphrase' | 'private_key';

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
  password?: string;
  passphrase?: string;
  privateKey?: string;
}

export interface StoredCredentialFlags {
  hasStoredPassword: boolean;
  hasStoredPassphrase: boolean;
  hasStoredPrivateKey: boolean;
}

export interface CredentialStoreOptions {
  force?: boolean;
  rememberPassword?: boolean;
  authMethod?: CredentialAuthMethod;
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
  secretType: ConnectionSecretType,
): Promise<string | undefined> {
  const secret = await invoke<string | null>('get_connection_secret', {
    connectionId,
    secretType,
  });

  return secret ?? undefined;
}

export async function deleteConnectionSecret(
  connectionId: string,
  secretType: ConnectionSecretType,
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

  if (secrets.password) {
    await storeConnectionSecret(connectionId, 'password', secrets.password);
    hasStoredPassword = true;
  }

  if (secrets.passphrase) {
    await storeConnectionSecret(connectionId, 'passphrase', secrets.passphrase);
    hasStoredPassphrase = true;
  }

  if (secrets.privateKey) {
    await storeConnectionSecret(connectionId, 'private_key', secrets.privateKey);
    hasStoredPrivateKey = true;
  }

  return { hasStoredPassword, hasStoredPassphrase, hasStoredPrivateKey };
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
    return { hasStoredPassword: false, hasStoredPassphrase: false, hasStoredPrivateKey: false };
  }

  // Delete first so reused connection IDs cannot leave orphan secret types.
  await deleteConnectionSecrets(connectionId);
  return writeProvidedSecrets(connectionId, secrets);
}

/**
 * Merge store: write provided secrets without clearing other types.
 * Used by plaintext→Keychain migration so partial legacy fields do not wipe
 * already-migrated Keychain entries.
 */
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

  switch (authMethod) {
    case 'password':
    case 'keyboard-interactive':
      if (hasStoredPrivateKey) {
        await deleteConnectionSecret(connectionId, 'private_key');
        hasStoredPrivateKey = false;
      }
      if (hasStoredPassphrase) {
        await deleteConnectionSecret(connectionId, 'passphrase');
        hasStoredPassphrase = false;
      }
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
      break;
    default:
      break;
  }

  return { hasStoredPassword, hasStoredPassphrase, hasStoredPrivateKey };
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
  },
  options?: CredentialStoreOptions,
): Promise<StoredCredentialFlags> {
  if (!shouldStoreSecrets(options)) {
    await deleteConnectionSecrets(connectionId);
    return { hasStoredPassword: false, hasStoredPassphrase: false, hasStoredPrivateKey: false };
  }

  let hasStoredPassword = existing.hasStoredPassword ?? false;
  let hasStoredPassphrase = existing.hasStoredPassphrase ?? false;
  let hasStoredPrivateKey = existing.hasStoredPrivateKey ?? false;

  if (secrets.password) {
    await storeConnectionSecret(connectionId, 'password', secrets.password);
    hasStoredPassword = true;
  }

  if (secrets.passphrase) {
    await storeConnectionSecret(connectionId, 'passphrase', secrets.passphrase);
    hasStoredPassphrase = true;
  }

  if (secrets.privateKey) {
    await storeConnectionSecret(connectionId, 'private_key', secrets.privateKey);
    hasStoredPrivateKey = true;
  }

  if (options?.authMethod) {
    return pruneSecretsForAuthMethod(connectionId, options.authMethod, {
      hasStoredPassword,
      hasStoredPassphrase,
      hasStoredPrivateKey,
    });
  }

  return { hasStoredPassword, hasStoredPassphrase, hasStoredPrivateKey };
}

export async function loadConnectionSecrets(
  connectionId: string,
  flags?: {
    hasStoredPassword?: boolean;
    hasStoredPassphrase?: boolean;
    hasStoredPrivateKey?: boolean;
  },
): Promise<ConnectionSecrets> {
  const secrets: ConnectionSecrets = {};

  if (flags?.hasStoredPassword) {
    secrets.password = await getConnectionSecret(connectionId, 'password');
  }

  if (flags?.hasStoredPassphrase) {
    secrets.passphrase = await getConnectionSecret(connectionId, 'passphrase');
  }

  if (flags?.hasStoredPrivateKey) {
    secrets.privateKey = await getConnectionSecret(connectionId, 'private_key');
  }

  return secrets;
}

export async function copyConnectionSecrets(fromId: string, toId: string): Promise<StoredCredentialFlags> {
  if (!isSavePasswordsEnabled()) {
    return { hasStoredPassword: false, hasStoredPassphrase: false, hasStoredPrivateKey: false };
  }

  const [password, passphrase, privateKey] = await Promise.all([
    getConnectionSecret(fromId, 'password'),
    getConnectionSecret(fromId, 'passphrase'),
    getConnectionSecret(fromId, 'private_key'),
  ]);

  return storeConnectionSecrets(toId, { password, passphrase, privateKey }, { force: true });
}

/** v1 migrated password/passphrase only; v2 also migrates privateKeyContent. */
export const KEYCHAIN_MIGRATION_FLAG = 'skd-keychain-migrated-v2';
export const KEYCHAIN_MIGRATION_FLAG_V1 = 'skd-keychain-migrated-v1';
