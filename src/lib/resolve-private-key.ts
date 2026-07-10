import { invoke } from '@tauri-apps/api/core';
import type { ConnectionData } from './connection-storage';
import { loadConnectionSecrets } from './credential-storage';

export type PrivateKeySource = 'path' | 'paste';

export interface PrivateKeyInput {
  privateKeySource?: PrivateKeySource;
  privateKeyPath?: string;
  privateKeyContent?: string;
  hasStoredPrivateKey?: boolean;
  storedPrivateKey?: string;
  /** When set, Keychain can be loaded for this connection id */
  connectionId?: string;
}

const PEM_MARKERS = ['BEGIN OPENSSH PRIVATE KEY', 'BEGIN PRIVATE KEY', 'BEGIN RSA PRIVATE KEY', 'BEGIN EC PRIVATE KEY'];

export function isValidPrivateKeyPem(content: string): boolean {
  const trimmed = content.trim();
  return PEM_MARKERS.some((marker) => trimmed.includes(marker));
}

export async function resolvePrivateKeyContent(input: PrivateKeyInput): Promise<string | undefined> {
  if (input.privateKeyContent?.trim()) {
    return input.privateKeyContent.trim();
  }

  if (input.storedPrivateKey?.trim()) {
    return input.storedPrivateKey.trim();
  }

  if (input.hasStoredPrivateKey && input.connectionId) {
    const secrets = await loadConnectionSecrets(input.connectionId, {
      hasStoredPrivateKey: true,
    });
    if (secrets.privateKey?.trim()) {
      return secrets.privateKey.trim();
    }
  }

  if (input.privateKeyPath?.trim()) {
    return invoke<string>('read_private_key_file_command', {
      path: input.privateKeyPath.trim(),
    });
  }

  return undefined;
}

export async function resolvePrivateKeyForStorage(
  input: PrivateKeyInput,
  rememberPassword: boolean,
): Promise<string | undefined> {
  if (!rememberPassword) {
    return resolvePrivateKeyContent(input);
  }

  if (input.privateKeySource === 'paste') {
    return input.privateKeyContent?.trim() || input.storedPrivateKey?.trim();
  }

  if (input.privateKeySource === 'path' && input.privateKeyPath?.trim()) {
    return invoke<string>('read_private_key_file_command', {
      path: input.privateKeyPath.trim(),
    });
  }

  if (input.privateKeyContent?.trim()) {
    return input.privateKeyContent.trim();
  }

  if (input.hasStoredPrivateKey && input.connectionId) {
    const secrets = await loadConnectionSecrets(input.connectionId, {
      hasStoredPrivateKey: true,
    });
    return secrets.privateKey?.trim();
  }

  return undefined;
}

export async function getPrivateKeyContentForConnection(
  connection: Pick<
    ConnectionData,
    'id' | 'privateKeyContent' | 'privateKeyPath' | 'hasStoredPrivateKey' | 'privateKeySource'
  >,
): Promise<string | null> {
  const content = await resolvePrivateKeyContent({
    privateKeyContent: connection.privateKeyContent,
    privateKeyPath: connection.privateKeyPath,
    hasStoredPrivateKey: connection.hasStoredPrivateKey,
    storedPrivateKey: connection.privateKeyContent,
    privateKeySource: connection.privateKeySource,
    connectionId: connection.id,
  });
  return content ?? null;
}
