import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open as tauriOpen } from '@tauri-apps/plugin-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

import { Switch } from './ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

import { Separator } from './ui/separator';
import { Textarea } from './ui/textarea';
import {
  ConnectionStorageManager,
  saveConnectionWithCredentials,
  updateConnectionWithCredentials,
} from '../lib/connection-storage';
import { loadConnectionSecrets } from '../lib/credential-storage';
import {
  isValidPrivateKeyPem,
  resolvePrivateKeyContent,
  resolvePrivateKeyForStorage,
  type PrivateKeySource,
} from '../lib/resolve-private-key';
import {
  isUnknownHostKeyError,
  parseUnknownHostKeyError,
  type UnknownHostKeyPayload,
} from '../lib/host-key-verification';
import {
  sshConnectWithHostKeyTrust,
  type ConnectResponse,
  type HostKeyTrustRequest,
} from '../lib/ssh-connect';
import { HostKeyTrustDialog } from './host-key-trust-dialog';
import { toast } from 'sonner';
import {
  Server,
  Shield,
  FolderOpen,
  Network,
  Terminal as TerminalIcon,
} from 'lucide-react';
import { getDefaultPort, getAuthMethods, getHiddenFields } from '@/lib/protocol-config';
import { connectionNameUpdateForHostChange } from '@/lib/connection-name-sync';
import { cn } from '@/lib/utils';

interface ConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (config: ConnectionConfig) => void;
  editingConnection?: ConnectionConfig | null;
}

export interface ConnectionConfig {
  id?: string;
  name: string;
  protocol: 'SSH' | 'SFTP' | 'FTP';
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'publickey' | 'keyboard-interactive' | 'anonymous';
  password?: string;
  privateKeySource?: PrivateKeySource;
  privateKeyPath?: string;
  privateKeyContent?: string;
  passphrase?: string;

  // Advanced options
  proxyType?: 'none' | 'http' | 'socks4' | 'socks5';
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;

  // FTP specific
  ftpsEnabled?: boolean;

  // SSH specific
  compression?: boolean;
  keepAlive?: boolean;
  keepAliveInterval?: number;
  serverAliveCountMax?: number;
}

export function ConnectionDialog({
  open,
  onOpenChange,
  onConnect,
  editingConnection
}: ConnectionDialogProps) {
  const defaultConfig: ConnectionConfig = {
    name: '',
    protocol: 'SSH',
    host: '',
    port: 22,
    username: 'root',
    authMethod: 'password',
    password: '',
    privateKeySource: 'path',
    privateKeyPath: '',
    privateKeyContent: '',
    passphrase: '',
    proxyType: 'none',
    proxyHost: '',
    proxyPort: 8080,
    proxyUsername: '',
    proxyPassword: '',
    compression: true,
    keepAlive: true,
    keepAliveInterval: 60,
    serverAliveCountMax: 3
  };

  const [config, setConfig] = useState<ConnectionConfig>(defaultConfig);

  const [isConnecting, setIsConnecting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [saveAsConnection, setSaveAsConnection] = useState(true);
  const [rememberPassword, setRememberPassword] = useState(true);
  const { t } = useTranslation();
  const [connectionFolder, setConnectionFolder] = useState('All Connections');
  const [availableFolders, setAvailableFolders] = useState<string[]>([]);
  const connectionIdRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);
  const nameManuallyEditedRef = useRef(false);
  const hostKeyRetryRef = useRef<(() => Promise<ConnectResponse>) | null>(null);
  const pendingSshConnectRef = useRef<{
    connectionId: string;
    resolvedKeyContent?: string;
    connectionMeta: {
      privateKeySource: PrivateKeySource;
      privateKeyPath?: string;
      hasStoredPrivateKey: boolean;
    };
    credentialSecrets: {
      password?: string;
      passphrase?: string;
      privateKey?: string;
    };
  } | null>(null);
  const [hostKeyTrustOpen, setHostKeyTrustOpen] = useState(false);
  const [hostKeyTrustPayload, setHostKeyTrustPayload] = useState<UnknownHostKeyPayload | null>(null);
  const [activeTab, setActiveTab] = useState('connection');

  const onHostKeyTrustRequired = (request: HostKeyTrustRequest) => {
    setHostKeyTrustPayload(request.payload);
    hostKeyRetryRef.current = request.retry;
    setHostKeyTrustOpen(true);
  };

  const completeSuccessfulConnect = async (
    connectionId: string,
    resolvedKeyContent: string | undefined,
    connectionMeta: {
      privateKeySource: PrivateKeySource;
      privateKeyPath?: string;
      hasStoredPrivateKey: boolean;
    },
    credentialSecrets: {
      password?: string;
      passphrase?: string;
      privateKey?: string;
    },
  ) => {
    if (editingConnection?.id) {
      await updateConnectionWithCredentials(
        editingConnection.id,
        {
          name: config.name,
          host: config.host,
          port: config.port || 22,
          username: config.username,
          protocol: config.protocol,
          authMethod: config.authMethod,
          ...connectionMeta,
          lastConnected: new Date().toISOString(),
        },
        credentialSecrets,
        {
          rememberPassword,
        },
      );
    } else if (saveAsConnection) {
      await saveConnectionWithCredentials(connectionId, {
        name: config.name,
        host: config.host,
        port: config.port || 22,
        username: config.username,
        protocol: config.protocol,
        folder: connectionFolder,
        authMethod: config.authMethod,
        ...connectionMeta,
      }, credentialSecrets, {
        rememberPassword,
      });
    }

    onConnect({
      ...config,
      id: connectionId,
      privateKeyContent: resolvedKeyContent,
      ...connectionMeta,
    });
    onOpenChange(false);

    if (!editingConnection) {
      setConfig(defaultConfig);
    }
  };

  const handleHostKeyTrustRetry = async () => {
    const pending = pendingSshConnectRef.current;
    if (!hostKeyRetryRef.current || !pending) {
      return;
    }

    const result = await hostKeyRetryRef.current();
    if (result.success) {
      await completeSuccessfulConnect(
        pending.connectionId,
        pending.resolvedKeyContent,
        pending.connectionMeta,
        pending.credentialSecrets,
      );
      pendingSshConnectRef.current = null;
      resetConnectionState();
      return;
    }

    if (result.pendingHostKeyTrust || isUnknownHostKeyError(result.error ?? '')) {
      const payload = result.error ? parseUnknownHostKeyError(result.error) : null;
      if (payload) {
        onHostKeyTrustRequired({ payload, retry: hostKeyRetryRef.current });
      }
      return;
    }

    console.error('Connection failed after host key trust:', result.error);
    toast.error(t('connectionDialog.toast.connectionFailed'), {
      description: result.error || t('connectionDialog.toast.connectionFailedDesc'),
      duration: 5000,
    });
    pendingSshConnectRef.current = null;
    resetConnectionState();
  };

  // Reset connection state and load saved profiles when dialog opens/closes
  useEffect(() => {
    if (open) {
      // Reset connection state when dialog opens
      resetConnectionState();
      setActiveTab('connection');

      // Load only valid folders from connection manager (excludes orphaned/deleted folders)
      const folders = ConnectionStorageManager.getValidFolders();
      const folderPaths = folders.map(f => f.path).sort();
      setAvailableFolders(folderPaths);

      // Load editing connection data into config when dialog opens
      if (editingConnection) {
        const {
          password: _password,
          passphrase: _passphrase,
          privateKeyContent: _privateKeyContent,
          ...connectionWithoutSecrets
        } = editingConnection;
        setConfig({
          ...defaultConfig,
          ...connectionWithoutSecrets,
          password: '',
          passphrase: '',
          privateKeyContent: '',
          privateKeySource: editingConnection.privateKeySource
            ?? (editingConnection.privateKeyPath ? 'path' : 'paste'),
        });
        // When editing, don't show "save as connection" since it already exists
        setSaveAsConnection(false);
        
        const storedConnection = editingConnection.id
          ? ConnectionStorageManager.getConnection(editingConnection.id)
          : undefined;
        setRememberPassword(
          !!storedConnection?.hasStoredPassword
            || !!storedConnection?.hasStoredPassphrase
            || !!storedConnection?.hasStoredPrivateKey,
        );
      } else {
        // Reset to defaults for new connection
        nameManuallyEditedRef.current = false;
        setConfig(defaultConfig);
        setSaveAsConnection(true);
        setRememberPassword(true);
      }
    } else {
      // Reset connection state when dialog closes
      resetConnectionState();
    }
  }, [open, editingConnection]);

  const handleBrowsePrivateKey = async () => {
    const selected = await tauriOpen({
      multiple: false,
      directory: false,
      title: t('connectionDialog.label.privateKey'),
    });

    if (typeof selected === 'string') {
      updateConfig({ privateKeyPath: selected, privateKeySource: 'path' });
    }
  };

  function resetConnectionState() {
    setIsConnecting(false);
    setIsCancelling(false);
    connectionIdRef.current = null;
    cancelRequestedRef.current = false;
  }

  const handleConnect = async () => {
    if (isConnecting) {
      return;
    }

    setIsConnecting(true);
    setIsCancelling(false);
    cancelRequestedRef.current = false;
    const connectionId = editingConnection?.id || `connection-${Date.now()}`;
    connectionIdRef.current = connectionId;

    const storedConnection = editingConnection?.id
      ? ConnectionStorageManager.getConnection(editingConnection.id)
      : undefined;
    const storedSecrets = editingConnection?.id
      ? await loadConnectionSecrets(editingConnection.id, {
          hasStoredPassword: storedConnection?.hasStoredPassword,
          hasStoredPassphrase: storedConnection?.hasStoredPassphrase,
          hasStoredPrivateKey: storedConnection?.hasStoredPrivateKey,
        })
      : {};
    const resolvedPassword = config.password || storedSecrets.password || '';
    const resolvedPassphrase = config.passphrase || storedSecrets.passphrase || '';
    const privateKeySource = config.privateKeySource ?? 'path';
    const hasStoredPrivateKey = !!storedConnection?.hasStoredPrivateKey;

    // Basic validation — anonymous FTP doesn't require a username
    const requiresUsername = config.authMethod !== 'anonymous';
    if (!config.name || !config.host || (requiresUsername && !config.username)) {
      toast.error(t('connectionDialog.toast.missingFields'), {
        description: requiresUsername
          ? t('connectionDialog.toast.missingFieldsDesc')
          : t('connectionDialog.toast.missingFieldsNoUsernameDesc'),
      });
      resetConnectionState();
      return;
    }

    // Validate authentication method specific fields
    if (config.authMethod === 'password' && !resolvedPassword) {
      toast.error(t('connectionDialog.toast.passwordRequired'), {
        description: t('connectionDialog.toast.passwordRequiredDesc'),
      });
      resetConnectionState();
      return;
    }

    if (config.authMethod === 'publickey') {
      if (privateKeySource === 'path' && !config.privateKeyPath?.trim()) {
        toast.error(t('connectionDialog.toast.privateKeyRequired'), {
          description: t('connectionDialog.toast.privateKeyRequiredDesc'),
        });
        resetConnectionState();
        return;
      }

      if (privateKeySource === 'paste' && !config.privateKeyContent?.trim() && !hasStoredPrivateKey) {
        toast.error(t('connectionDialog.toast.privateKeyRequired'), {
          description: t('connectionDialog.toast.privateKeyRequiredDesc'),
        });
        resetConnectionState();
        return;
      }

      if (privateKeySource === 'paste' && config.privateKeyContent?.trim() && !isValidPrivateKeyPem(config.privateKeyContent)) {
        toast.error(t('connectionDialog.toast.invalidPrivateKeyPem'), {
          description: t('connectionDialog.toast.invalidPrivateKeyPemDesc'),
        });
        resetConnectionState();
        return;
      }

      if (privateKeySource === 'path' && config.privateKeyPath?.trim()) {
        const validation = await invoke<{
          valid: boolean;
          warning?: string;
          error?: string;
        }>('validate_private_key_path', { path: config.privateKeyPath.trim() });

        if (!validation.valid) {
          toast.error(t('connectionDialog.toast.privateKeyPathInvalid'), {
            description: validation.error,
          });
          resetConnectionState();
          return;
        }

        if (validation.warning) {
          toast.warning(t('connectionDialog.toast.privateKeyPathWarning'), {
            description: t('connectionDialog.toast.privateKeyPathWarningDesc', {
              warning: validation.warning,
            }),
          });
        }
      }
    }

    let resolvedKeyContent: string | undefined;
    if (config.authMethod === 'publickey') {
      try {
        resolvedKeyContent = await resolvePrivateKeyContent({
          privateKeySource,
          privateKeyPath: config.privateKeyPath,
          privateKeyContent: config.privateKeyContent,
          hasStoredPrivateKey,
          storedPrivateKey: storedSecrets.privateKey,
        });
      } catch (error) {
        toast.error(t('connectionDialog.toast.privateKeyPathInvalid'), {
          description: error instanceof Error ? error.message : String(error),
        });
        resetConnectionState();
        return;
      }

      if (!resolvedKeyContent) {
        toast.error(t('connectionDialog.toast.privateKeyRequired'), {
          description: t('connectionDialog.toast.privateKeyRequiredDesc'),
        });
        resetConnectionState();
        return;
      }
    }

    let privateKeyForStorage: string | undefined;
    if (config.authMethod === 'publickey' && rememberPassword) {
      try {
        privateKeyForStorage = await resolvePrivateKeyForStorage(
          {
            privateKeySource,
            privateKeyPath: config.privateKeyPath,
            privateKeyContent: config.privateKeyContent,
            hasStoredPrivateKey,
            storedPrivateKey: storedSecrets.privateKey,
          },
          rememberPassword,
        );
      } catch (error) {
        toast.error(t('connectionDialog.toast.privateKeyPathInvalid'), {
          description: error instanceof Error ? error.message : String(error),
        });
        resetConnectionState();
        return;
      }
    }

    const connectionMeta = {
      privateKeySource,
      privateKeyPath: privateKeySource === 'path' ? config.privateKeyPath : undefined,
      hasStoredPrivateKey: rememberPassword && !!privateKeyForStorage,
    };

    const credentialSecrets = {
      password: config.password || undefined,
      passphrase: config.passphrase || undefined,
      privateKey: privateKeyForStorage,
    };

    // For SFTP/FTP protocols, delegate connection to App.tsx (via onConnect)
    // which calls the appropriate Tauri commands.
    const isSftpOrFtp = config.protocol === 'SFTP' || config.protocol === 'FTP';

    if (isSftpOrFtp) {
      try {
        // Save connection if requested
        if (editingConnection?.id) {
          await updateConnectionWithCredentials(
            editingConnection.id,
            {
              name: config.name,
              host: config.host,
              port: config.port || (config.protocol === 'FTP' ? 21 : 22),
              username: config.username,
              protocol: config.protocol,
              authMethod: config.authMethod,
              ...connectionMeta,
              ftpsEnabled: config.ftpsEnabled,
              lastConnected: new Date().toISOString(),
            },
            credentialSecrets,
            {
              rememberPassword,
            },
          );
        } else if (saveAsConnection) {
          await saveConnectionWithCredentials(connectionId, {
            name: config.name,
            host: config.host,
            port: config.port || (config.protocol === 'FTP' ? 21 : 22),
            username: config.username,
            protocol: config.protocol,
            folder: connectionFolder,
            authMethod: config.authMethod,
            ...connectionMeta,
            ftpsEnabled: config.ftpsEnabled,
          }, credentialSecrets, {
            rememberPassword,
          });
        }

        // Delegate actual connection to App.tsx handler
        onConnect({
          ...config,
          id: connectionId,
          password: resolvedPassword || undefined,
          passphrase: resolvedPassphrase || undefined,
          privateKeyContent: resolvedKeyContent,
          ...connectionMeta,
        });
        onOpenChange(false);

        if (!editingConnection) {
          setConfig(defaultConfig);
        }
      } finally {
        resetConnectionState();
      }
      return;
    }

    // SSH — connect via ssh_connect
    pendingSshConnectRef.current = {
      connectionId,
      resolvedKeyContent,
      connectionMeta,
      credentialSecrets,
    };

    let awaitingHostKeyTrust = false;
    try {
      const result = await sshConnectWithHostKeyTrust(
        {
          connection_id: connectionId,
          host: config.host,
          port: config.port || 22,
          username: config.username,
          auth_method: config.authMethod || 'password',
          password: resolvedPassword,
          key_content: resolvedKeyContent || null,
          passphrase: resolvedPassphrase || null,
        },
        onHostKeyTrustRequired,
      );

      if (result.success) {
        await completeSuccessfulConnect(
          connectionId,
          resolvedKeyContent,
          connectionMeta,
          credentialSecrets,
        );
        pendingSshConnectRef.current = null;
      } else if (result.pendingHostKeyTrust || isUnknownHostKeyError(result.error ?? '')) {
        awaitingHostKeyTrust = true;
      } else {
        console.error('Connection failed:', result.error);
        if (cancelRequestedRef.current && result.error?.toLowerCase().includes('cancelled')) {
          toast.info(t('connectionDialog.toast.connectionCancelled'));
        } else {
          toast.error(t('connectionDialog.toast.connectionFailed'), {
            description: result.error || t('connectionDialog.toast.connectionFailedDesc'),
            duration: 5000,
          });
        }
        pendingSshConnectRef.current = null;
      }
    } catch (error) {
      console.error('Connection error:', error);
      pendingSshConnectRef.current = null;
      if (cancelRequestedRef.current) {
        toast.info(t('connectionDialog.toast.connectionCancelled'));
      } else {
        toast.error(t('connectionDialog.toast.connectionError'), {
          description: error instanceof Error ? error.message : t('connectionDialog.toast.connectionErrorDesc'),
          duration: 5000,
        });
      }
    } finally {
      if (!awaitingHostKeyTrust) {
        resetConnectionState();
      }
    }
  };

  const handleCancelConnectionAttempt = async () => {
    if (!isConnecting) {
      onOpenChange(false);
      return;
    }

    if (isCancelling) {
      return;
    }

    const connectionId = connectionIdRef.current;
    if (!connectionId) {
      resetConnectionState();
      return;
    }

    cancelRequestedRef.current = true;
    setIsCancelling(true);

    try {
      const response = await invoke<{ success: boolean; error?: string }>('ssh_cancel_connect', {
        connection_id: connectionId
      });
      if (response.success) {
        toast.info(t('connectionDialog.toast.connectionCancelled'));
      }
      // Whether successful or not, we want to reset the state
      // The user clicked cancel, so we should stop the "connecting" state
    } catch (error) {
      console.error('Failed to cancel connection:', error);
      // Don't show error toast - user just wants to stop, we'll reset the state
    } finally {
      // Always reset the state when user requests cancel
      resetConnectionState();
    }
  };

  const updateConfig = (updates: Partial<ConnectionConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  };

  const handleOpenChange = (newOpen: boolean) => {
    // If trying to close while connecting, cancel first then close
    if (!newOpen && isConnecting) {
      // Cancel connection and then close
      handleCancelConnectionAttempt().then(() => {
        resetConnectionState();
        onOpenChange(false);
      });
      return;
    }
    onOpenChange(newOpen);
  };

  const tabContentClassName = 'px-6 py-4 space-y-4 mt-0 overflow-y-auto';

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          '!top-0 !left-0 !translate-x-0 !translate-y-0 !inset-0 !m-auto',
          '!flex !flex-col !w-full sm:!max-w-4xl',
          '!max-h-[85vh] overflow-hidden p-0 gap-0 min-w-0 !h-fit',
        )}
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Server className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div>{editingConnection ? t('connectionDialog.title.edit') : t('connectionDialog.title.new')}</div>
              <DialogDescription className="mt-1">
                {t('connectionDialog.description')}
              </DialogDescription>
            </div>
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex flex-col overflow-hidden shrink-0"
        >
          <TabsList className="shrink-0 w-full justify-start rounded-none border-b bg-transparent h-auto p-0 px-4 overflow-x-auto">
            <TabsTrigger
              value="connection"
              className="flex items-center gap-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-2.5 py-2.5 text-sm whitespace-nowrap"
            >
              <Server className="h-3.5 w-3.5" />
              <span>{t('connectionDialog.tab.connection')}</span>
            </TabsTrigger>
            <TabsTrigger
              value="authentication"
              className="flex items-center gap-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-2.5 py-2.5 text-sm whitespace-nowrap"
            >
              <Shield className="h-3.5 w-3.5" />
              <span>{t('connectionDialog.tab.auth')}</span>
            </TabsTrigger>
            <TabsTrigger
              value="proxy"
              className="flex items-center gap-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-2.5 py-2.5 text-sm whitespace-nowrap"
            >
              <Network className="h-3.5 w-3.5" />
              <span>{t('connectionDialog.tab.proxy')}</span>
            </TabsTrigger>
            <TabsTrigger
              value="advanced"
              className="flex items-center gap-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-2.5 py-2.5 text-sm whitespace-nowrap"
            >
              <TerminalIcon className="h-3.5 w-3.5" />
              <span>{t('connectionDialog.tab.advanced')}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connection" className={tabContentClassName}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  {t('connectionDialog.section.basicSettings')}
                </CardTitle>
                <CardDescription>
                  {t('connectionDialog.section.basicSettingsDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="host">{t('connectionDialog.label.host')}</Label>
                    <Input
                      id="host"
                      placeholder={t('connectionDialog.placeholder.host')}
                      value={config.host}
                      onChange={(e) => {
                        const host = e.target.value;
                        updateConfig({
                          host,
                          ...connectionNameUpdateForHostChange(host, {
                            isNewConnection: !editingConnection,
                            nameManuallyEdited: nameManuallyEditedRef.current,
                          }),
                        });
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="port">{t('connectionDialog.label.port')}</Label>
                    <Input
                      id="port"
                      type="number"
                      value={config.port}
                      onChange={(e) => updateConfig({ port: parseInt(e.target.value) || 22 })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="connection-name">{t('connectionDialog.label.connectionName')}</Label>
                    <Input
                      id="connection-name"
                      placeholder={t('connectionDialog.placeholder.connectionName')}
                      value={config.name}
                      onChange={(e) => {
                        nameManuallyEditedRef.current = true;
                        updateConfig({ name: e.target.value });
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="protocol">{t('connectionDialog.label.protocol')}</Label>
                    <Select
                      value={config.protocol}
                      onValueChange={(value: ConnectionConfig['protocol']) => {
                        const validAuthMethods = getAuthMethods(value);
                        const currentAuthValid = validAuthMethods.includes(config.authMethod);
                        updateConfig({
                          protocol: value,
                          port: getDefaultPort(value),
                          ...(!currentAuthValid && { authMethod: validAuthMethods[0] }),
                          ...(value !== 'FTP' && { ftpsEnabled: undefined }),
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SSH">SSH</SelectItem>
                        <SelectItem value="SFTP">SFTP</SelectItem>
                        <SelectItem value="FTP">FTP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="username">{t('connectionDialog.label.username')}</Label>
                  <Input
                    id="username"
                    placeholder={t('connectionDialog.placeholder.username')}
                    value={config.username}
                    onChange={(e) => updateConfig({ username: e.target.value })}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="authentication" className={tabContentClassName}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  {t('connectionDialog.section.authentication')}
                </CardTitle>
                <CardDescription>
                  {t('connectionDialog.section.authenticationDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('connectionDialog.section.authentication')}</Label>
                  <Select
                    value={config.authMethod}
                    onValueChange={(value: ConnectionConfig['authMethod']) => updateConfig({ authMethod: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getAuthMethods(config.protocol).map((method) => (
                        <SelectItem key={method} value={method}>
                          {method === 'password' ? t('connectionDialog.authMethod.password') :
                           method === 'publickey' ? t('connectionDialog.authMethod.publicKey') :
                           method === 'keyboard-interactive' ? t('connectionDialog.authMethod.keyboardInteractive') :
                           method === 'anonymous' ? t('connectionDialog.authMethod.anonymous') : method}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {config.authMethod === 'password' && (
                  <div className="space-y-2">
                    <Label htmlFor="password">{t('connectionDialog.label.password')}</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder={t('connectionDialog.placeholder.password')}
                      value={config.password}
                      onChange={(e) => updateConfig({ password: e.target.value })}
                    />
                  </div>
                )}

                {config.authMethod === 'publickey' && (
                  <div className="space-y-4">
                    <Tabs
                      value={config.privateKeySource ?? 'path'}
                      onValueChange={(value) => updateConfig({ privateKeySource: value as PrivateKeySource })}
                    >
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="path">{t('connectionDialog.privateKey.tabPath')}</TabsTrigger>
                        <TabsTrigger value="paste">{t('connectionDialog.privateKey.tabPaste')}</TabsTrigger>
                      </TabsList>
                      <TabsContent value="path" className="space-y-2 mt-3">
                        <Label htmlFor="private-key">{t('connectionDialog.label.privateKey')}</Label>
                        <div className="flex gap-2">
                          <Input
                            id="private-key"
                            placeholder={t('connectionDialog.placeholder.privateKey')}
                            value={config.privateKeyPath ?? ''}
                            onChange={(e) => updateConfig({
                              privateKeyPath: e.target.value,
                              privateKeySource: 'path',
                            })}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => { void handleBrowsePrivateKey(); }}
                          >
                            <FolderOpen className="h-4 w-4 mr-1" />
                            {t('connectionDialog.privateKey.browse')}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t('connectionDialog.privateKey.pathHint')}
                        </p>
                      </TabsContent>
                      <TabsContent value="paste" className="space-y-2 mt-3">
                        <Label htmlFor="private-key-paste">{t('connectionDialog.privateKey.tabPaste')}</Label>
                        {editingConnection?.id
                          && ConnectionStorageManager.getConnection(editingConnection.id)?.hasStoredPrivateKey
                          && !config.privateKeyContent ? (
                          <p className="text-sm text-muted-foreground rounded-md border px-3 py-2">
                            {t('connectionDialog.privateKey.storedSecurely')}
                          </p>
                        ) : (
                          <Textarea
                            id="private-key-paste"
                            className="font-mono text-xs min-h-[120px]"
                            placeholder={t('connectionDialog.privateKey.pastePlaceholder')}
                            value={config.privateKeyContent ?? ''}
                            onChange={(e) => updateConfig({
                              privateKeyContent: e.target.value,
                              privateKeySource: 'paste',
                            })}
                          />
                        )}
                      </TabsContent>
                    </Tabs>
                    <div className="space-y-2">
                      <Label htmlFor="passphrase">{t('connectionDialog.label.passphrase')}</Label>
                      <Input
                        id="passphrase"
                        type="password"
                        placeholder={t('connectionDialog.placeholder.passphrase')}
                        value={config.passphrase}
                        onChange={(e) => updateConfig({ passphrase: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {config.protocol === 'FTP' && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>{t('connectionDialog.ftp.enableFtps')}</Label>
                        <p className="text-sm text-muted-foreground">
                          {t('connectionDialog.ftp.enableFtpsDesc')}
                        </p>
                      </div>
                      <Switch
                        checked={config.ftpsEnabled ?? false}
                        onCheckedChange={(checked) => updateConfig({ ftpsEnabled: checked })}
                      />
                    </div>
                  </>
                )}


              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="proxy" className={tabContentClassName}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Network className="h-4 w-4" />
                  {t('connectionDialog.section.proxySettings')}
                </CardTitle>
                <CardDescription>
                  {t('connectionDialog.section.proxySettingsDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('connectionDialog.label.proxyType')}</Label>
                  <Select
                    value={config.proxyType}
                    onValueChange={(value: string) => updateConfig({ proxyType: value as ConnectionConfig['proxyType'] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('connectionDialog.proxy.noProxy')}</SelectItem>
                      <SelectItem value="http">{t('connectionDialog.proxy.httpProxy')}</SelectItem>
                      <SelectItem value="socks4">{t('connectionDialog.proxy.socks4')}</SelectItem>
                      <SelectItem value="socks5">{t('connectionDialog.proxy.socks5')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {config.proxyType !== 'none' && (
                  <>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor="proxy-host">{t('connectionDialog.label.proxyHost')}</Label>
                        <Input
                          id="proxy-host"
                          placeholder={t('connectionDialog.placeholder.proxyHost')}
                          value={config.proxyHost}
                          onChange={(e) => updateConfig({ proxyHost: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="proxy-port">{t('connectionDialog.label.proxyPort')}</Label>
                        <Input
                          id="proxy-port"
                          type="number"
                          value={config.proxyPort}
                          onChange={(e) => updateConfig({ proxyPort: parseInt(e.target.value) || 8080 })}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="proxy-username">{t('connectionDialog.label.proxyUsername')}</Label>
                        <Input
                          id="proxy-username"
                          placeholder={t('connectionDialog.placeholder.proxyUsername')}
                          onChange={(e) => updateConfig({ proxyUsername: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="proxy-password">{t('connectionDialog.label.proxyPassword')}</Label>
                        <Input
                          id="proxy-password"
                          type="password"
                          placeholder={t('connectionDialog.placeholder.proxyPassword')}
                          value={config.proxyPassword}
                          onChange={(e) => updateConfig({ proxyPassword: e.target.value })}
                        />
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="advanced" className={tabContentClassName}>
            {(() => {
              const hiddenFields = getHiddenFields(config.protocol);
              const isCompHidden = hiddenFields.includes('compression');
              const isKaHidden = hiddenFields.includes('keepAliveInterval');
              const isAllHidden = isCompHidden && isKaHidden;

              if (isAllHidden) {
                return (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <TerminalIcon className="h-4 w-4" />
                        {t('connectionDialog.section.advancedOptions')}
                      </CardTitle>
                      <CardDescription>
                        {t('connectionDialog.section.noAdvancedOptions', { protocol: config.protocol })}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                );
              }

              return (
                <Card>
                  <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <TerminalIcon className="h-4 w-4" />
                        {t('connectionDialog.section.advancedSsh')}
                      </CardTitle>
                      <CardDescription>
                        {t('connectionDialog.section.advancedSshDesc')}
                      </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-4">
                      {!isCompHidden && (
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label>{t('connectionDialog.advanced.enableCompression')}</Label>
                            <p className="text-sm text-muted-foreground">
                              {t('connectionDialog.advanced.enableCompressionDesc')}
                            </p>
                          </div>
                          <Switch
                            checked={config.compression}
                            onCheckedChange={(checked) => updateConfig({ compression: checked })}
                          />
                        </div>
                      )}

                      {!isCompHidden && !isKaHidden && <Separator />}

                      {!isKaHidden && (
                        <>
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <Label>{t('connectionDialog.advanced.keepAlive')}</Label>
                              <p className="text-sm text-muted-foreground">
                                {t('connectionDialog.advanced.keepAliveDesc')}
                              </p>
                            </div>
                            <Switch
                              checked={config.keepAlive}
                              onCheckedChange={(checked) => updateConfig({ keepAlive: checked })}
                            />
                          </div>

                          {config.keepAlive && (
                            <div className="grid grid-cols-2 gap-4 ml-4">
                              <div className="space-y-2">
                                <Label htmlFor="keep-alive-interval">{t('connectionDialog.label.keepAliveInterval')}</Label>
                                <Input
                                  id="keep-alive-interval"
                                  type="number"
                                  value={config.keepAliveInterval}
                                  onChange={(e) => updateConfig({ keepAliveInterval: parseInt(e.target.value) || 60 })}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="max-count">{t('connectionDialog.label.maxCount')}</Label>
                                <Input
                                  id="max-count"
                                  type="number"
                                  value={config.serverAliveCountMax}
                                  onChange={(e) => updateConfig({ serverAliveCountMax: parseInt(e.target.value) || 3 })}
                                />
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })()}
          </TabsContent>


        </Tabs>

        <DialogFooter className="shrink-0 px-6 py-4 border-t bg-muted/30 flex-col sm:flex-col">
          <div className="flex flex-col gap-3 w-full">
            {/* Save as Connection Option - Only show for new connections */}
            {!editingConnection && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch
                    id="save-connection"
                    checked={saveAsConnection}
                    onCheckedChange={setSaveAsConnection}
                  />
                  <Label htmlFor="save-connection" className="text-sm cursor-pointer">
                    {t('connectionDialog.saveAsConnection')}
                  </Label>
                </div>
                {saveAsConnection && (
                  <Select value={connectionFolder} onValueChange={setConnectionFolder}>
                      <SelectTrigger className="w-[200px] h-8">
                        <SelectValue placeholder={t('connectionDialog.selectFolder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableFolders.length > 0 ? (
                        availableFolders.map((folder) => (
                          <SelectItem key={folder} value={folder}>
                            {folder}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="All Connections">{t('connectionDialog.allConnections')}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Remember Password Option */}
            {(editingConnection || saveAsConnection) && (config.authMethod === 'password' || config.authMethod === 'publickey') && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch
                    id="remember-password"
                    checked={rememberPassword}
                    onCheckedChange={setRememberPassword}
                  />
                  <Label htmlFor="remember-password" className="text-sm cursor-pointer">
                    {t('connectionDialog.rememberPassword')}
                  </Label>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-2">
              <Button
                variant={isConnecting ? "destructive" : "outline"}
                onClick={handleCancelConnectionAttempt}
                disabled={isCancelling}
              >
                {isConnecting ? (isCancelling ? t('connectionDialog.button.cancelling') : t('connectionDialog.button.stop')) : t('connectionDialog.button.cancel')}
              </Button>
              <Button onClick={handleConnect} disabled={isConnecting || isCancelling} className="min-w-[140px]">
                {isConnecting ? t('connectionDialog.button.connecting') : editingConnection ? t('connectionDialog.button.updateAndConnect') : t('connectionDialog.button.connect')}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <HostKeyTrustDialog
      open={hostKeyTrustOpen}
      payload={hostKeyTrustPayload}
      onOpenChange={setHostKeyTrustOpen}
      onTrusted={() => {
        void handleHostKeyTrustRetry();
      }}
      onTrustFailed={(message) => {
        toast.error(t('hostKeyTrust.trustFailed'), {
          description: message,
          duration: 5000,
        });
      }}
      onCancelled={() => {
        pendingSshConnectRef.current = null;
        resetConnectionState();
      }}
    />
  </>
  );
}