import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Monitor, Server, HardDrive, Plus, Pencil, Copy, Trash2, FolderPlus, FolderEdit, Zap, Clock, Terminal } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import {
  ConnectionStorageManager,
  deleteConnectionWithCredentials,
  duplicateConnectionWithCredentials,
} from '../lib/connection-storage';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu';
import { toast } from 'sonner';
import { StatusDot } from './ui/status-dot';
import { PanelHeader, ToolbarDivider } from './ui/panel-chrome';
import { treeIndent, treeRowState } from '@/lib/panel-layout-styles';
import { cn } from './ui/utils';

interface ConnectionNode {
  id: string;
  name: string;
  type: 'folder' | 'connection';
  path?: string; // For folders
  protocol?: string;
  host?: string;
  port?: number;
  username?: string;
  profileId?: string;
  lastConnected?: string;
  isConnected?: boolean;
  children?: ConnectionNode[];
  isExpanded?: boolean;
}

// Keep the default dependency stable so local disclosure updates do not reload the tree.
const EMPTY_ACTIVE_CONNECTIONS = new Set<string>();

interface ConnectionManagerProps {
  onConnectionSelect: (connection: ConnectionNode) => void;
  onConnectionConnect?: (connection: ConnectionNode) => void;
  selectedConnectionId: string | null;
  activeConnections?: Set<string>;
  onNewConnection?: () => void;
  onNewLocalTerminal?: () => void;
  onEditConnection?: (connection: ConnectionNode) => void;
  onDeleteConnection?: (connectionId: string) => void;
  onDuplicateConnection?: (connection: ConnectionNode) => void;
  recentConnections?: { id: string; name: string; host: string; username: string; port?: number; lastConnected?: string }[];
  onQuickConnect?: (connectionId: string) => void;
}

export function ConnectionManager({
  onConnectionSelect,
  onConnectionConnect,
  selectedConnectionId,
  activeConnections = EMPTY_ACTIVE_CONNECTIONS,
  onNewConnection,
  onNewLocalTerminal,
  onEditConnection,
  onDeleteConnection,
  onDuplicateConnection,
  recentConnections = [],
  onQuickConnect,
}: ConnectionManagerProps) {
  const { t } = useTranslation();
  // Load connections from storage
  const loadConnections = (): ConnectionNode[] => {
    const tree = ConnectionStorageManager.buildConnectionTree(activeConnections);
    return tree.length > 0 ? tree : [];
  };

  const [connections, setConnections] = useState<ConnectionNode[]>(loadConnections());

  // Folder management state
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParentPath, setNewFolderParentPath] = useState<string | undefined>(undefined);
  const [deleteFolderDialogOpen, setDeleteFolderDialogOpen] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<{ path: string; name: string } | null>(null);
  const [renameFolderDialogOpen, setRenameFolderDialogOpen] = useState(false);
  const [folderToRename, setFolderToRename] = useState<{ path: string; name: string; parentPath?: string } | null>(null);
  const [renameFolderNewName, setRenameFolderNewName] = useState('');

  // Drag and drop state
  const [draggedItem, setDraggedItem] = useState<{ node: ConnectionNode; type: 'connection' | 'folder' } | null>(null);

  // Reload connections when active connections change
  useEffect(() => {
    setConnections(loadConnections());
  }, [activeConnections]);

  // Handle connection deletion
  const handleDelete = async (connectionId: string) => {
    if (await deleteConnectionWithCredentials(connectionId)) {
      setConnections(loadConnections());
      toast.success(t('connectionManager.connectionDeleted'));
      if (onDeleteConnection) {
        onDeleteConnection(connectionId);
      }
    } else {
      toast.error(t('connectionManager.failedToDeleteConnection'));
    }
  };

  // Handle connection duplication
  const handleDuplicate = async (node: ConnectionNode) => {
    if (node.type === 'connection' && node.host) {
      const connectionData = ConnectionStorageManager.getConnection(node.id);
      if (connectionData) {
        const duplicated = await duplicateConnectionWithCredentials(node.id, {
          name: `${node.name} (Copy)`,
          host: node.host,
          port: node.port || 22,
          username: node.username || '',
          protocol: node.protocol || 'SSH',
          folder: connectionData.folder || 'All Connections',
          authMethod: connectionData.authMethod,
          privateKeySource: connectionData.privateKeySource,
          privateKeyPath: connectionData.privateKeyPath,
          hasStoredPrivateKey: connectionData.hasStoredPrivateKey,
        });
        if (duplicated) {
          setConnections(loadConnections());
          toast.success(t('connectionManager.duplicated', { name: duplicated.name }));
          if (onDuplicateConnection) {
            onDuplicateConnection(node);
          }
        }
      }
    }
  };

  // Handle creating new folder
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) {
      toast.error(t('connectionManager.folderNameEmpty'));
      return;
    }

    try {
      ConnectionStorageManager.createFolder(newFolderName.trim(), newFolderParentPath);
      setConnections(loadConnections());
      toast.success(t('connectionManager.folderCreated', { name: newFolderName }));
      setNewFolderDialogOpen(false);
      setNewFolderName('');
      setNewFolderParentPath(undefined);
    } catch (_error) {
      toast.error(t('connectionManager.failedToCreateFolder'));
    }
  };

  // Handle deleting folder
  const handleDeleteFolder = () => {
    if (!folderToDelete) return;

    if (ConnectionStorageManager.deleteFolder(folderToDelete.path, true)) {
      setConnections(loadConnections());
      toast.success(t('connectionManager.folderDeleted', { name: folderToDelete.name }));
      setDeleteFolderDialogOpen(false);
      setFolderToDelete(null);
    } else {
      toast.error(t('connectionManager.failedToDeleteFolder'));
    }
  };

  // Open new folder dialog
  const openNewFolderDialog = (parentPath?: string) => {
    setNewFolderParentPath(parentPath);
    setNewFolderDialogOpen(true);
  };

  // Handle renaming folder
  const handleRenameFolder = () => {
    if (!folderToRename || !renameFolderNewName.trim()) {
      toast.error(t('connectionManager.folderNameEmpty'));
      return;
    }

    try {
      const oldPath = folderToRename.path;
      const newName = renameFolderNewName.trim();
      const newPath = folderToRename.parentPath
        ? `${folderToRename.parentPath}/${newName}`
        : newName;

      // Get all connections in this folder and subfolders
      const allConnections = ConnectionStorageManager.getConnectionsByFolderRecursive(oldPath);

      // Get all subfolders
      const subfolders = ConnectionStorageManager.getSubfoldersRecursive(oldPath);

      // Create new folder first
      ConnectionStorageManager.createFolder(newName, folderToRename.parentPath);

      // Recreate all subfolders with new parent path
      subfolders.forEach(subfolder => {
        const relativePath = subfolder.path.substring(oldPath.length + 1); // Remove old parent path
        const _newSubfolderPath = `${newPath}/${relativePath}`;
        const parts = relativePath.split('/');
        const subfolderName = parts[parts.length - 1];
        const subfolderParentPath = parts.length > 1
          ? `${newPath}/${parts.slice(0, -1).join('/')}`
          : newPath;

        ConnectionStorageManager.createFolder(subfolderName, subfolderParentPath);
      });

      // Move all connections to new paths
      allConnections.forEach(connection => {
        let newConnectionPath: string;
        if (connection.folder === oldPath) {
          // Connection directly in the renamed folder
          newConnectionPath = newPath;
        } else {
          // Connection in a subfolder - update the path
          const relativePath = connection.folder!.substring(oldPath.length + 1);
          newConnectionPath = `${newPath}/${relativePath}`;
        }
        ConnectionStorageManager.moveConnection(connection.id, newConnectionPath);
      });

      // Delete old folder and all subfolders
      ConnectionStorageManager.deleteFolder(oldPath, true);

      setConnections(loadConnections());
      toast.success(t('connectionManager.folderRenamed', { name: newName }));
      setRenameFolderDialogOpen(false);
      setFolderToRename(null);
      setRenameFolderNewName('');
    } catch (error) {
      toast.error(t('connectionManager.failedToRenameFolder'), {
        description: error instanceof Error ? error.message : 'Unable to rename folder.',
      });
    }
  };

  // Open rename folder dialog
  const openRenameFolderDialog = (path: string, name: string, parentPath?: string) => {
    setFolderToRename({ path, name, parentPath });
    setRenameFolderNewName(name);
    setRenameFolderDialogOpen(true);
  };

  // Open delete folder dialog
  const openDeleteFolderDialog = (path: string, name: string) => {
    setFolderToDelete({ path, name });
    setDeleteFolderDialogOpen(true);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, node: ConnectionNode) => {
    setDraggedItem({ node, type: node.type });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetNode: ConnectionNode) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedItem) return;

    // Can only drop into folders
    if (targetNode.type !== 'folder') return;

    // Don't drop into itself
    if (draggedItem.node.id === targetNode.id) return;

    // Don't drop folder into its own child
    if (draggedItem.type === 'folder' && targetNode.path?.startsWith(draggedItem.node.path + '/')) {
      toast.error(t('connectionManager.cannotMoveIntoOwn'));
      return;
    }

    if (draggedItem.type === 'connection') {
      // Move connection to target folder
      if (ConnectionStorageManager.moveConnection(draggedItem.node.id, targetNode.path!)) {
        setConnections(loadConnections());
        toast.success(t('connectionManager.movedConnection', { source: draggedItem.node.name, target: targetNode.name }));
      } else {
        toast.error(t('connectionManager.failedToMoveConnection'));
      }
    } else if (draggedItem.type === 'folder') {
      // Move folder by renaming its path
      try {
        const connections = ConnectionStorageManager.getConnectionsByFolder(draggedItem.node.path!);
        const newPath = `${targetNode.path}/${draggedItem.node.name}`;

        // Create new folder
        ConnectionStorageManager.createFolder(draggedItem.node.name, targetNode.path);

        // Move all connections
        connections.forEach(connection => {
          ConnectionStorageManager.moveConnection(connection.id, newPath);
        });

        // Delete old folder
        ConnectionStorageManager.deleteFolder(draggedItem.node.path!, false);

        setConnections(loadConnections());
        toast.success(t('connectionManager.movedFolder', { source: draggedItem.node.name, target: targetNode.name }));
      } catch (error) {
        toast.error(t('connectionManager.failedToMoveFolder'), {
          description: error instanceof Error ? error.message : t('connectionManager.unableToMoveFolder'),
        });
      }
    }

    setDraggedItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };

  // Find the selected connection details
  const getSelectedConnection = (nodes: ConnectionNode[]): ConnectionNode | null => {
    for (const node of nodes) {
      if (node.id === selectedConnectionId) {
        return node;
      }
      if (node.children) {
        const found = getSelectedConnection(node.children);
        if (found) return found;
      }
    }
    return null;
  };

  const selectedConnection = getSelectedConnection(connections);

  const toggleExpanded = (nodeId: string) => {
    const updateNode = (nodes: ConnectionNode[]): ConnectionNode[] => {
      return nodes.map(node => {
        if (node.id === nodeId) {
          return { ...node, isExpanded: !node.isExpanded };
        }
        if (node.children) {
          return { ...node, children: updateNode(node.children) };
        }
        return node;
      });
    };
    setConnections(updateNode(connections));
  };

  const getIcon = (node: ConnectionNode) => {
    if (node.type === 'folder') {
      return node.isExpanded ? <FolderOpen className="w-4 h-4" /> : <Folder className="w-4 h-4" />;
    }

    switch (node.protocol) {
      case 'SSH':
        return <Server className="w-4 h-4 text-muted-foreground" />;
      case 'CMD':
      case 'PowerShell':
      case 'Shell':
        return <Monitor className="w-4 h-4 text-muted-foreground" />;
      case 'WSL':
        return <HardDrive className="w-4 h-4 text-muted-foreground" />;
      default:
        return <Monitor className="w-4 h-4" />;
    }
  };

  const renderNode = (node: ConnectionNode, level: number = 0) => {
    const isSelected = selectedConnectionId === node.id;
    const isConnected = node.type === 'connection' && node.isConnected;
    const isDragging = draggedItem?.node.id === node.id;

    const handleNodeClick = () => {
      // Always select the node first
      onConnectionSelect(node);

      // Then toggle folder expansion if it's a folder
      if (node.type === 'folder') {
        toggleExpanded(node.id);
      }
    };

    const handleNodeDoubleClick = () => {
      if (node.type === 'connection') {
        // Double click to connect
        if (onConnectionConnect) {
          onConnectionConnect(node);
        } else {
          onConnectionSelect(node);
        }
      }
    };

    const nodeContent = (
      <div
        className={cn(
          treeRowState({ selected: isSelected, variant: 'sidebar' }),
          'h-7 gap-1.5 rounded-sm py-0 pr-2 cursor-pointer',
          isDragging && 'opacity-50',
        )}
        style={treeIndent(level, 4, 12)}
        onClick={handleNodeClick}
        onDoubleClick={handleNodeDoubleClick}
        draggable={node.path !== 'All Connections'}
        onDragStart={(e) => handleDragStart(e, node)}
        onDragOver={node.type === 'folder' ? handleDragOver : undefined}
        onDrop={node.type === 'folder' ? (e) => handleDrop(e, node) : undefined}
        onDragEnd={handleDragEnd}
      >
        {node.type === 'folder' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 shrink-0 rounded-sm p-0"
            aria-label={node.name}
            aria-expanded={Boolean(node.isExpanded)}
            onClick={(e) => {
              e.stopPropagation();
              handleNodeClick();
            }}
          >
            {node.isExpanded ?
              <ChevronDown className="w-3 h-3" /> :
              <ChevronRight className="w-3 h-3" />
            }
          </Button>
        )}
        {node.type === 'connection' && <div className="h-4 w-5 shrink-0" />}

        <div className="relative shrink-0">
          {getIcon(node)}
          {isConnected && (
            <StatusDot
              variant="connected"
              className="absolute -bottom-0.5 -right-0.5 border border-sidebar"
            />
          )}
        </div>
        <span className="min-w-0 flex-1 truncate text-[13px]" title={node.name}>{node.name}</span>
      </div>
    );

    return (
      <div key={node.id}>
        {node.type === 'connection' ? (
          <ContextMenu onOpenChange={(open) => {
            if (open) {
              // Select the connection when context menu opens (right-click)
              onConnectionSelect(node);
            }
          }}>
            <ContextMenuTrigger asChild>
              {nodeContent}
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onClick={() => {
                  if (onConnectionConnect) {
                    onConnectionConnect(node);
                  } else {
                    onConnectionSelect(node);
                  }
                }}
              >
                {isConnected ? t('connectionManager.switchToConnection') : t('connectionManager.connect')}
              </ContextMenuItem>
              {onEditConnection && (
                <ContextMenuItem
                  onClick={() => onEditConnection(node)}
                >
                  <Pencil className="w-4 h-4 mr-2" />
                  {t('connectionManager.edit')}
                </ContextMenuItem>
              )}
              <ContextMenuItem
                onClick={() => handleDuplicate(node)}
              >
                <Copy className="w-4 h-4 mr-2" />
                {t('connectionManager.duplicate')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => handleDelete(node.id)}
                className="text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {t('connectionManager.delete')}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : node.type === 'folder' ? (
          <ContextMenu onOpenChange={(open) => {
            if (open && node.type === 'folder') {
              // Select the folder when context menu opens (right-click)
              onConnectionSelect(node);
            }
          }}>
            <ContextMenuTrigger asChild>
              {nodeContent}
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onClick={() => openNewFolderDialog(node.path)}
              >
                <FolderPlus className="w-4 h-4 mr-2" />
                {t('connectionManager.newSubfolder')}
              </ContextMenuItem>
              {node.path !== 'All Connections' && (
                <>
                  <ContextMenuItem
                    onClick={() => {
                      const folders = ConnectionStorageManager.getFolders();
                      const folder = folders.find(f => f.path === node.path);
                      openRenameFolderDialog(node.path!, node.name, folder?.parentPath);
                    }}
                  >
                    <FolderEdit className="w-4 h-4 mr-2" />
                    {t('connectionManager.folder.renameFolder')}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() => openDeleteFolderDialog(node.path!, node.name)}
                    className="text-destructive"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    {t('connectionManager.folder.deleteFolder')}
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          nodeContent
        )}

        {node.type === 'folder' && node.isExpanded && node.children && (
          <div>
            {node.children.map(child => renderNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
    <div className="flex h-full min-w-0 flex-col bg-sidebar">
      {/* Connection Browser */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col select-none">
        <PanelHeader tone="sidebar" className="h-9 shrink-0 gap-0.5 px-2">
          <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">
            {t('connectionManager.connectionsHeader')}
          </h3>

          <TooltipProvider>
            {/* Quick Connect */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="toolbar" aria-label={t('toolbar.quickConnect')}>
                      <Zap className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('toolbar.quickConnect')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="flex items-center gap-2 text-xs">
                  <Clock className="w-3.5 h-3.5" />
                  {t('toolbar.recentConnections')}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {recentConnections.length > 0 ? (
                  recentConnections.map((conn) => (
                    <DropdownMenuItem
                      key={conn.id}
                      onClick={() => onQuickConnect?.(conn.id)}
                      className="flex items-start gap-2 py-2 cursor-pointer"
                    >
                      <Server className="w-3.5 h-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{conn.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {conn.username}@{conn.host}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))
                ) : (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                    {t('toolbar.noRecentConnections')}
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <ToolbarDivider className="mx-1 h-4" />

            {/* New Folder */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="toolbar"
                  aria-label={t('connectionManager.newFolder')}
                  onClick={() => openNewFolderDialog()}
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('connectionManager.newFolder')}</TooltipContent>
            </Tooltip>

            {/* New Connection */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="toolbar"
                  aria-label={t('connectionManager.newConnection')}
                  onClick={onNewConnection}
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('connectionManager.newConnection')}</TooltipContent>
            </Tooltip>

            {/* Local Terminal */}
            {onNewLocalTerminal && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="toolbar"
                    onClick={onNewLocalTerminal}
                    aria-label={t('connectionManager.newLocalTerminal')}
                  >
                    <Terminal className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('connectionManager.newLocalTerminal')}</TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </PanelHeader>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto px-1.5 py-1">
          {connections.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center">
              <p className="text-sm text-muted-foreground mb-4">{t('connectionManager.noConnectionsYet')}</p>
              {onNewConnection && (
                <Button onClick={onNewConnection} size="sm" variant="outline">
                  <Plus className="w-4 h-4 mr-2" />
                  {t('connectionManager.newConnection')}
                </Button>
              )}
            </div>
          ) : (
            connections.map(connection => renderNode(connection))
          )}
        </div>
      </div>

      {/* Connection Details */}
      {selectedConnection?.type === 'connection' && (
      <details className="group/details max-h-[40%] shrink-0 overflow-auto border-t border-sidebar-border">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 transition-transform group-open/details:rotate-90 motion-reduce:transition-none" />
          {t('connectionManager.connectionDetails')}
        </summary>
        <div className="sidebar-connection-details px-2 pb-2 [&>div>div>div]:gap-3 [&>div>div>div>span:first-child]:shrink-0 [&>div>div>div>span:last-child]:min-w-0 [&>div>div>div>span:last-child]:[overflow-wrap:anywhere] [&>div>div>div>span:last-child]:text-right">

            <div className="space-y-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{t('connectionDetails.name')}</span>
                  <span className="text-xs">{selectedConnection.name}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{t('connectionDetails.type')}</span>
                  <Badge variant="outline" className="text-xs py-0 px-1 h-5">
                    {selectedConnection.protocol}
                  </Badge>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{t('connectionDetails.status')}</span>
                  <div className="flex items-center gap-2">
                    <StatusDot variant={selectedConnection.isConnected ? 'connected' : 'disconnected'} />
                    <span className="text-xs">{selectedConnection.isConnected ? t('connectionDetails.connected') : t('connectionDetails.disconnected')}</span>
                  </div>
                </div>

                {selectedConnection.lastConnected && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">{t('connectionDetails.lastConnected')}</span>
                    <span className="text-xs">
                      {new Date(selectedConnection.lastConnected).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {selectedConnection.host && (
                <>
                  <Separator />
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{t('connectionManager.host')}</span>
                      <span className="text-xs">{selectedConnection.host}</span>
                    </div>

                    {selectedConnection.username && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{t('connectionManager.username')}</span>
                        <span className="text-xs">{selectedConnection.username}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{t('connectionManager.port')}</span>
                      <span className="text-xs">
                        {selectedConnection.port || (selectedConnection.protocol === 'SSH' ? 22 : 23)}
                      </span>
                    </div>
                  </div>
                </>
              )}

            </div>
        </div>
      </details>
      )}
    </div>
    
    {/* New Folder Dialog */}
    <Dialog open={newFolderDialogOpen} onOpenChange={setNewFolderDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('connectionManager.createNewFolder')}</DialogTitle>
          <DialogDescription>
            {t('connectionManager.createFolderDesc')}
            {newFolderParentPath && ` ${t('connectionManager.parent')}: ${newFolderParentPath}`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="folder-name">{t('connectionManager.folderName')}</Label>
            <Input
              id="folder-name"
              placeholder={t('connectionManager.enterFolderName')}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreateFolder();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setNewFolderDialogOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleCreateFolder}>{t('connectionManager.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    
    {/* Delete Folder Confirmation Dialog */}
    <AlertDialog open={deleteFolderDialogOpen} onOpenChange={setDeleteFolderDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('connectionManager.deleteFolderTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('connectionManager.deleteFolderDesc', { name: folderToDelete?.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={handleDeleteFolder} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {t('connectionManager.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    
    {/* Rename Folder Dialog */}
    <Dialog open={renameFolderDialogOpen} onOpenChange={setRenameFolderDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('connectionManager.renameFolder')}</DialogTitle>
          <DialogDescription>
            {t('connectionManager.renameFolderDesc', { name: folderToRename?.name })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="rename-folder-name">{t('connectionManager.folderName')}</Label>
            <Input
              id="rename-folder-name"
              placeholder={t('connectionManager.enterNewFolderName')}
              value={renameFolderNewName}
              onChange={(e) => setRenameFolderNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenameFolder();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRenameFolderDialogOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleRenameFolder}>{t('connectionManager.rename')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
