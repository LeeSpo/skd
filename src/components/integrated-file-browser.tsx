import React, { useState, useEffect, useReducer, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { save, open as tauriOpen } from '@tauri-apps/plugin-dialog';
import { CancelledError } from '@/lib/async-retry';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { PanelToolbar } from './ui/panel-chrome';
import {
  FILE_BROWSER_CHROME_TEXT,
  FILE_BROWSER_LIST_ICONS,
  FILE_BROWSER_LIST_TEXT,
} from '@/lib/file-browser-typography';
import { ScrollArea } from './ui/scroll-area';
import {
  transferQueueReducer,
  getNextQueuedTransfer,
} from '@/lib/transfer-queue-reducer';
import {
  buildDirectoryUploadPlan,
  buildFileUploadItems,
  buildMixedDropUploadPlan,
  type DroppedPathStat,
  type LocalPathStat,
  type LocalRecursiveUploadEntry,
  type UploadQueueInput,
} from '@/lib/upload-paths';
import { useWebviewFileDrop } from '@/lib/use-webview-file-drop';
import { TransferQueue } from './transfer-queue';
import { DirectoryTree } from './directory-tree';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from './ui/resizable';
import { 
  Folder, 
  FolderUp,
  File, 
  Upload, 
  Download, 
  RefreshCw, 
  Home, 
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ArrowLeft,
  ArrowRight,
  Trash2,
  FileText,
  Image,
  Archive,
  Code,
  Edit,
  Eye,
  Copy,
  Scissors,
  FolderPlus,
  ChevronRight,
  X,
  FileEdit,
  ClipboardPaste,
  Info,
  Link,
  Layers,
  GripVertical,
  ScrollText,
  Pencil
} from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuSeparator } from './ui/context-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";
import { toast } from 'sonner';
import { isEditableTarget } from '@/lib/keyboard-shortcuts';
import {
  createLocalAdapter,
  createRemoteAdapter,
  type FileBrowserAdapter,
  type FileBrowserFileItem as FileItem,
} from '@/lib/file-browser-adapter';

type IntegratedFileBrowserProps =
  | {
      mode: 'local';
    }
  | {
      mode: 'remote';
      connectionId: string;
      host?: string;
      isConnected: boolean;
      onClose: () => void;
      /** Called when user wants to open a file in the Log Monitor */
      onOpenInLogMonitor?: (filePath: string) => void;
      /** Called when user wants to open a file in the editor window */
      onOpenInEditor?: (
        filePath: string,
        fileName: string,
        options?: { readOnly?: boolean },
      ) => void;
    };

// Cache to store state per session
const sessionStateCache = new Map<string, {
  currentPath: string;
  files: FileItem[];
  selectedFiles: Set<string>;
  searchTerm: string;
}>();

// Cache to store directory tree state (expanded dirs, loaded nodes) per connection.
// Restored when the user switches back to a connection so the tree is in the
// same expanded state they left it in.
const treeStateCache = new Map<string, {
  expanded: Set<string>;
  nodes: Map<string, Array<{ path: string; name: string }>>;
}>();

// Cache to store the directory tree scroll position per connection.
const treeScrollCache = new Map<string, number>();

export function IntegratedFileBrowser(props: IntegratedFileBrowserProps) {
  const isLocalMode = props.mode === 'local';
  const connectionId = props.mode === 'remote' ? props.connectionId : undefined;
  const onOpenInLogMonitor =
    props.mode === 'remote' ? props.onOpenInLogMonitor : undefined;
  const onOpenInEditor =
    props.mode === 'remote' ? props.onOpenInEditor : undefined;

  const remoteConnectionId =
    props.mode === 'remote' ? props.connectionId : '';
  const remoteIsConnected =
    props.mode === 'remote' ? props.isConnected : false;
  const adapter = useMemo<FileBrowserAdapter>(
    () =>
      isLocalMode
        ? createLocalAdapter()
        : createRemoteAdapter(remoteConnectionId, remoteIsConnected),
    [isLocalMode, remoteConnectionId, remoteIsConnected],
  );
  const sessionKey = adapter.sessionKey;
  const isAvailable = adapter.isAvailable;

  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState(adapter.defaultHomePath);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [transfers, dispatchTransfer] = useReducer(transferQueueReducer, []);
  const [queueExpanded, setQueueExpanded] = useState(false);
  const processTransferRef = useRef(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Tracks which connectionId the current path/files state belongs to.
  // Updated synchronously (via ref) in the restore effect so the save effect
  // never writes stale data from the previous connection under the new id.
  const effectiveSessionKeyRef = useRef<string | undefined>(undefined);
  // Monotonic counter: each loadFiles call stamps its own gen; stale responses are discarded.
  const loadGenRef = useRef(0);
  // Tracks the session for which files were last successfully loaded.
  const lastLoadedSessionKeyRef = useRef<string | null>(null);
  // Tracks the previous session so the main load effect can skip
  // session-change loads (leaving them to the safety-net) and only handle
  // path / availability changes within the same session.
  const prevSessionKeyRef = useRef<string | undefined>(undefined);
  // Tracks the path that is authoritative for the current session.
  // Updated synchronously in the restore effect (before setState), so the load
  // effect always uses the correct path even before React re-renders with the
  // new state value. This prevents the stale-path → error-toast race on tab switch.
  const committedPathRef = useRef(adapter.defaultHomePath);
  committedPathRef.current = currentPath; // mirror latest state every render
  const [clipboard, setClipboard] = useState<{ files: FileItem[], operation: 'copy' | 'cut' } | null>(null);
  const [renamingFile, setRenamingFile] = useState<FileItem | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [deletingFile, setDeletingFile] = useState<FileItem | null>(null);
  
  // Column widths state
  const [columnWidths, setColumnWidths] = useState({
    name: 300,
    size: 80,
    modified: 140,
    permissions: 100,
    owner: 110
  });
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  
  // Sort state
  type SortField = 'name' | 'size' | 'modified' | 'permissions' | 'owner';
  type SortDirection = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  
  // Drag and drop state — driven by the `useWebviewFileDrop` hook below,
  // which owns the global Tauri `onDragDropEvent` subscription.

  // Navigation history state (back/forward)
  const [navHistory, setNavHistory] = useState<string[]>([adapter.defaultHomePath]);
  const [navIndex, setNavIndex] = useState(0);
  const navInProgress = React.useRef(false);

  // Editable address bar state
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [editPathValue, setEditPathValue] = useState('');
  const pathInputRef = React.useRef<HTMLInputElement>(null);

  // Mock file data - in real implementation, this would fetch from SSH connection
  const _mockFiles: FileItem[] = [
    { name: '..', type: 'directory', size: 0, modified: new Date(), permissions: 'drwxr-xr-x', owner: 'root', group: 'root', path: '..' },
    { name: 'documents', type: 'directory', size: 4096, modified: new Date('2024-01-15'), permissions: 'drwxr-xr-x', owner: 'user01', group: 'users', path: 'documents' },
    { name: 'scripts', type: 'directory', size: 4096, modified: new Date('2024-01-10'), permissions: 'drwxr-xr-x', owner: 'user01', group: 'admin', path: 'scripts' },
    { name: 'config.txt', type: 'file', size: 1024, modified: new Date('2024-01-20'), permissions: '-rw-r--r--', owner: 'user01', group: 'users', path: 'config.txt' },
    { name: 'setup.sh', type: 'file', size: 2048, modified: new Date('2024-01-18'), permissions: '-rwxr-xr-x', owner: 'root', group: 'admin', path: 'setup.sh' },
    { name: 'README.md', type: 'file', size: 3072, modified: new Date('2024-01-16'), permissions: '-rw-r--r--', owner: 'user01', group: 'users', path: 'README.md' },
    { name: 'image.jpg', type: 'file', size: 1048576, modified: new Date('2024-01-14'), permissions: '-rw-r--r--', owner: 'user01', group: 'users', path: 'image.jpg' },
    { name: 'data.json', type: 'file', size: 5120, modified: new Date('2024-01-12'), permissions: '-rw-r--r--', owner: 'www-data', group: 'www-data', path: 'data.json' }
  ];

  // Restore or initialize state when connection changes.
  // IMPORTANT: update effectiveConnectionIdRef and committedPathRef FIRST
  // (synchronously) so the save effect and load effects read correct values.
  //
  // When switching to a connection that has cached state, we deliberately
  // do NOT call any setState — this avoids an unnecessary re-render that
  // would flash the previous connection's files.  The safety-net effect
  // below handles loading fresh files for the new connection.
  //
  // For a brand-new connection (no cache), we reset state to defaults so the
  // UI starts clean.
  useEffect(() => {
    effectiveSessionKeyRef.current = sessionKey;
    const cached = sessionStateCache.get(sessionKey);
    const newPath = cached?.currentPath ?? adapter.defaultHomePath;
    committedPathRef.current = newPath;
    if (!cached) {
      setCurrentPath(adapter.defaultHomePath);
      setFiles([]);
      setSelectedFiles(new Set());
      setSearchTerm('');
      setNavHistory([adapter.defaultHomePath]);
      setNavIndex(0);
    }
  }, [sessionKey, adapter.defaultHomePath]);

  useEffect(() => {
    if (!isLocalMode) return;
    let cancelled = false;
    void adapter.homePath().then((home) => {
      if (cancelled) return;
      committedPathRef.current = home;
      setCurrentPath(home);
      setNavHistory([home]);
      setNavIndex(0);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, isLocalMode]);

  // Persist state to cache whenever data changes.
  // connectionId is intentionally omitted from deps: we only want this to fire
  // when the *data* changes for the currently active connection, not when we
  // switch connections (which would write the old connection's path under the
  // new connection's id before the restore effect sets the correct data).
  useEffect(() => {
    const id = effectiveSessionKeyRef.current;
    if (id) {
      sessionStateCache.set(id, {
        currentPath,
        files,
        selectedFiles,
        searchTerm
      });
    }
  }, [currentPath, files, selectedFiles, searchTerm]);

  // Main load effect: handles currentPath and isConnected changes within the
  // SAME connection.  Connection switches are handled exclusively by the
  // safety-net effect below, avoiding duplicate concurrent loads that race
  // on the generation counter and can leave the file list empty.
  useEffect(() => {
    if (!isAvailable) return;
    if (prevSessionKeyRef.current !== sessionKey) return;
    void loadFiles(committedPathRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadFiles is a stable inline fn; adding it would cause infinite re-renders
  }, [currentPath, isAvailable, sessionKey]);

  useEffect(() => {
    prevSessionKeyRef.current = sessionKey;
    if (isAvailable) {
      void loadFiles(committedPathRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadFiles is a stable inline fn
  }, [sessionKey, isAvailable]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        switch (event.key) {
          case 'c':
            if (selectedFiles.size > 0) {
              event.preventDefault();
              const selectedFileItems = files.filter(f => selectedFiles.has(f.name));
              handleCopyFiles(selectedFileItems);
            }
            break;
          case 'x':
            if (selectedFiles.size > 0) {
              event.preventDefault();
              const selectedFileItems = files.filter(f => selectedFiles.has(f.name));
              handleCutFiles(selectedFileItems);
            }
            break;
          case 'v':
            if (clipboard) {
              event.preventDefault();
              void handlePasteFiles();
            }
            break;
          case 'a':
            event.preventDefault();
            setSelectedFiles(new Set(files.map(f => f.name)));
            break;
          case 'r':
            event.preventDefault();
            void loadFiles();
            break;
        }
      } else if (event.key === 'Delete' && selectedFiles.size > 0) {
        event.preventDefault();
        const selectedFileItems = files.filter(f => selectedFiles.has(f.name));
        selectedFileItems.forEach(handleDeleteFile);
      } else if (event.key === 'F2' && selectedFiles.size === 1) {
        event.preventDefault();
        const selectedFile = files.find(f => selectedFiles.has(f.name));
        if (selectedFile) {
          handleRenameFile(selectedFile);
        }
      } else if (event.key === 'Escape') {
        setSelectedFiles(new Set());
        if (renamingFile) {
          handleRenameCancel();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadFiles/handlePasteFiles are stable inline fns; adding them would cause infinite re-renders
  }, [selectedFiles, files, clipboard, renamingFile]);

  // Column resize effect
  useEffect(() => {
    if (!resizingColumn) return;

    const handleMouseMove = (e: MouseEvent) => {
      const columnsContainer = document.querySelector('[data-columns-container]');
      if (!columnsContainer) return;

      const containerRect = columnsContainer.getBoundingClientRect();
      const relativeX = e.clientX - containerRect.left - 8; // Account for padding

      // Calculate new width based on mouse position
      setColumnWidths(prev => {
        const columns = Object.keys(prev);
        const columnIndex = columns.indexOf(resizingColumn);
        
        if (columnIndex === -1) return prev;

        // Calculate the start position of the column being resized
        let columnStart = 0;
        for (let i = 0; i < columnIndex; i++) {
          columnStart += prev[columns[i] as keyof typeof prev] + 8; // Add gap
        }

        const newWidth = Math.max(50, relativeX - columnStart - 8); // Minimum width of 50px, account for gaps

        return {
          ...prev,
          [resizingColumn]: newWidth
        };
      });
    };

    const handleMouseUp = () => {
      setResizingColumn(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn]);

  // Transfer processing loop — remote mode only
  useEffect(() => {
    if (!adapter.supportsTransfer || !connectionId) return;
    const nextItem = getNextQueuedTransfer(transfers);
    if (!nextItem || processTransferRef.current) return;

    processTransferRef.current = true;
    dispatchTransfer({ type: "START", id: nextItem.id });

    const doTransfer = async () => {
      try {
        if (nextItem.direction === "upload") {
          const result = await invoke<{ success: boolean; bytes_transferred?: number; error?: string }>(
            "upload_remote_file",
            {
              connectionId,
              localPath: nextItem.sourcePath,
              remotePath: nextItem.destinationPath,
            },
          );
          if (result.success) {
            dispatchTransfer({ type: "COMPLETE", id: nextItem.id });
            toast.success(t('fileBrowser.toast.uploaded', { name: nextItem.fileName }));
            void loadFiles();
          } else {
            dispatchTransfer({
              type: "FAIL",
              id: nextItem.id,
              error: result.error ?? "Upload failed",
            });
            toast.error(t('fileBrowser.toast.uploadFailed', { name: nextItem.fileName }), {
              description: result.error ?? "Unknown error",
            });
          }
        } else {
          const result = await invoke<{ success: boolean; bytes_transferred?: number; error?: string }>(
            "download_remote_file",
            {
              connectionId,
              remotePath: nextItem.sourcePath,
              localPath: nextItem.destinationPath,
            },
          );
          if (result.success) {
            dispatchTransfer({ type: "COMPLETE", id: nextItem.id });
            const destPath = nextItem.destinationPath;
            const destDir = destPath.substring(0, destPath.lastIndexOf("/")) || "/";
            toast.success(t('fileBrowser.toast.downloaded', { name: nextItem.fileName }), {
              duration: 5000,
              action: {
                label: t('fileBrowser.transfer.openFile'),
                onClick: () => { void invoke("open_in_os", { path: destPath }).catch(() => {}); },
              },
              cancel: {
                label: t('fileBrowser.transfer.showInFolder'),
                onClick: () => { void invoke("open_in_os", { path: destDir }).catch(() => {}); },
              },
            });
          } else {
            dispatchTransfer({
              type: "FAIL",
              id: nextItem.id,
              error: result.error ?? "Download failed",
            });
            toast.error(t('fileBrowser.toast.downloadFailed', { name: nextItem.fileName }), {
              description: result.error ?? "Unknown error",
            });
          }
        }
      } catch (err) {
        dispatchTransfer({
          type: "FAIL",
          id: nextItem.id,
          error: err instanceof Error ? err.message : String(err),
        });
        toast.error(t('fileBrowser.toast.transferFailed', { name: nextItem.fileName }), {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        processTransferRef.current = false;
      }
    };

    void doTransfer();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadFiles is a stable inline fn; adding it would cause infinite re-renders
  }, [transfers, connectionId, adapter.supportsTransfer]);

  const handleResizeStart = (columnName: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn(columnName);
  };

  /** SSH-specific directory loader for the DirectoryTree component. */
  const loadTreeDirectories = useCallback(
    async (path: string): Promise<string[]> => {
      if (!isAvailable) return [];
      return adapter.listChildDirs(path);
    },
    [adapter, isAvailable],
  );

  const handleSaveTreeState = useCallback(
    (exp: Set<string>, nds: Map<string, Array<{ path: string; name: string }>>) => {
      treeStateCache.set(sessionKey, { expanded: exp, nodes: nds });
    },
    [sessionKey],
  );

  const handleSaveTreeScroll = useCallback(
    (scrollTop: number) => {
      treeScrollCache.set(sessionKey, scrollTop);
    },
    [sessionKey],
  );

  const treeInitialExpanded = useMemo(() => {
    const cached = treeStateCache.get(sessionKey);
    return cached ? new Set(cached.expanded) : undefined;
  }, [sessionKey]);

  const treeInitialNodes = useMemo(() => {
    const cached = treeStateCache.get(sessionKey);
    return cached ? new Map(cached.nodes) : undefined;
  }, [sessionKey]);

  const treeInitialScrollTop = useMemo(
    () => treeScrollCache.get(sessionKey),
    [sessionKey],
  );

  async function loadFiles(pathOverride?: string) {
    if (!isAvailable) {
      return;
    }

    const targetPath = pathOverride ?? currentPath;
    const gen = ++loadGenRef.current;
    const isCancelled = () => gen !== loadGenRef.current;
    setIsLoading(true);
    try {
      const parsedFiles = await adapter.listDirectory(targetPath, isCancelled);

      if (gen !== loadGenRef.current) return;
      setFiles(parsedFiles);
      if (currentPath !== targetPath) {
        setCurrentPath(targetPath);
        setNavHistory([targetPath]);
        setNavIndex(0);
        setSelectedFiles(new Set());
      }
      lastLoadedSessionKeyRef.current = sessionKey;
    } catch (error) {
      if (error instanceof CancelledError || gen !== loadGenRef.current) return;

      const fallbackPath = adapter.fallbackPathOnError(targetPath);
      if (fallbackPath) {
        committedPathRef.current = fallbackPath;
        void loadFiles(fallbackPath);
        return;
      }

      console.error('Failed to load files:', error);
      toast.error(t('fileBrowser.toast.loadFailed'), {
        description: error instanceof Error ? error.message : t('fileBrowser.toast.loadFailedDesc'),
      });
      setFiles([]);
    } finally {
      if (gen === loadGenRef.current) {
        setIsLoading(false);
      }
    }
  };

  // ── Navigation helpers ──

  /** Navigate to a path and record in history (unless triggered by back/forward) */
  const navigateTo = (path: string) => {
    if (path === currentPath) return;
    if (!navInProgress.current) {
      // Trim any forward history past the current index, then push new entry
      setNavHistory((prev) => [...prev.slice(0, navIndex + 1), path]);
      setNavIndex((prev) => prev + 1);
    }
    setCurrentPath(path);
  };

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;

  const goBack = () => {
    if (!canGoBack) return;
    navInProgress.current = true;
    const newIndex = navIndex - 1;
    setNavIndex(newIndex);
    setCurrentPath(navHistory[newIndex]);
    // Reset flag after state flush
    setTimeout(() => { navInProgress.current = false; }, 0);
  };

  const goForward = () => {
    if (!canGoForward) return;
    navInProgress.current = true;
    const newIndex = navIndex + 1;
    setNavIndex(newIndex);
    setCurrentPath(navHistory[newIndex]);
    setTimeout(() => { navInProgress.current = false; }, 0);
  };

  const goUp = () => {
    if (adapter.isRootPath(currentPath)) return;
    navigateTo(adapter.parentPath(currentPath));
  };

  /** Build breadcrumb segments from a path string */
  const getBreadcrumbs = (p: string): { label: string; path: string }[] => {
    const segments: { label: string; path: string }[] = [{ label: '/', path: '/' }];
    if (p === '/') return segments;
    const parts = p.split('/').filter(Boolean);
    let accumulated = '';
    for (const part of parts) {
      accumulated += '/' + part;
      segments.push({ label: part, path: accumulated });
    }
    return segments;
  };

  const handlePathSubmit = () => {
    const trimmed = editPathValue.trim();
    if (trimmed && trimmed !== currentPath) {
      navigateTo(adapter.normalizeNavPath(trimmed));
    }
    setIsEditingPath(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const getFileIcon = (file: FileItem) => {
    if (file.type === 'directory') {
      return <Folder className="h-4 w-4 text-blue-500" />;
    }
    
    const ext = file.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'txt':
      case 'md':
      case 'log':
        return <FileText className="h-4 w-4 text-gray-500" />;
      case 'jpg':
      case 'png':
      case 'gif':
      case 'jpeg':
        return <Image className="h-4 w-4 text-green-500" />;
      case 'zip':
      case 'tar':
      case 'gz':
        return <Archive className="h-4 w-4 text-orange-500" />;
      case 'js':
      case 'py':
      case 'sh':
      case 'json':
        return <Code className="h-4 w-4 text-purple-500" />;
      default:
        return <File className="h-4 w-4 text-gray-400" />;
    }
  };

  const openFileInEditor = (file: FileItem, options?: { readOnly?: boolean }) => {
    if (onOpenInEditor) {
      onOpenInEditor(file.path, file.name, options);
    } else {
      toast.info(t('app.noEditorHandler', { name: file.name }));
    }
  };

  const handleFileDoubleClick = (file: FileItem) => {
    if (file.type === 'directory') {
      navigateTo(file.path);
    } else if (isLocalMode) {
      void adapter.openInOS(file.path);
    } else {
      openFileInEditor(file, { readOnly: true });
    }
  };

  const handleFileSelect = (fileName: string, event: React.MouseEvent) => {
    // Only select/deselect if Ctrl (Windows/Linux) or Cmd (Mac) is pressed
    if (event.ctrlKey || event.metaKey) {
      event.stopPropagation();
      const newSelected = new Set(selectedFiles);
      if (newSelected.has(fileName)) {
        newSelected.delete(fileName);
      } else {
        newSelected.add(fileName);
      }
      setSelectedFiles(newSelected);
    }
    // If not holding Ctrl/Cmd, do nothing (allow double-click to handle navigation)
  };

  const handleFileClick = (file: FileItem, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd + Click: toggle selection
      handleFileSelect(file.name, event);
    } else {
      // Regular click on directory: navigate into it
      if (file.type === 'directory') {
        navigateTo(file.path);
      }
      // Regular click on file: do nothing (or optionally preview)
    }
  };

  const handleUpload = async () => {
    try {
      const selected = await tauriOpen({
        multiple: true,
        directory: false,
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;

      dispatchTransfer({
        type: "ENQUEUE",
        items: buildFileUploadItems(paths, currentPath),
      });
      toast.info(t('fileBrowser.toast.queuedUpload', { count: paths.length }));
    } catch (error) {
      console.error('Upload dialog error:', error);
    }
  };

  const handleUploadFolder = async () => {
    try {
      const selected = await tauriOpen({
        multiple: true,
        directory: true,
        recursive: true,
      });
      if (!selected) return;

      const directoryPaths = Array.isArray(selected) ? selected : [selected];
      if (directoryPaths.length === 0) return;

      const queuedItems: UploadQueueInput[] = [];
      let createdDirectoryCount = 0;
      const dirErrors: string[] = [];

      for (const directoryPath of directoryPaths) {
        const entries = await invoke<LocalRecursiveUploadEntry[]>(
          "list_local_files_recursive",
          {
            path: directoryPath,
            excludePatterns: [],
          },
        );
        const plan = buildDirectoryUploadPlan(
          directoryPath,
          currentPath,
          entries,
        );

        // Create remote directories before enqueuing file transfers.
        // Shell-quote escaping is handled on the Rust side.
        for (const remoteDirectory of plan.directories) {
          try {
            await invoke<boolean>("create_directory", {
              connectionId,
              path: remoteDirectory,
            });
            createdDirectoryCount += 1;
          } catch (err) {
            dirErrors.push(
              `${remoteDirectory}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        queuedItems.push(...plan.items);
      }

      if (dirErrors.length > 0) {
        toast.warning(t('fileBrowser.toast.dirCreationFailed', { count: dirErrors.length }), {
          description: dirErrors.slice(0, 3).join("\n"),
        });
      }

      if (queuedItems.length > 0) {
        dispatchTransfer({
          type: "ENQUEUE",
          items: queuedItems,
        });
        toast.info(
          t('fileBrowser.toast.queuedFolderUpload', { count: queuedItems.length, folderCount: directoryPaths.length, createdCount: createdDirectoryCount }),
        );
      } else if (dirErrors.length === 0) {
        // Folder(s) were empty — just refresh
        void loadFiles();
        toast.info(t('fileBrowser.toast.createdRemoteFolders', { count: createdDirectoryCount }));
      }
    } catch (error) {
      console.error('Upload folder dialog error:', error);
      toast.error(t('fileBrowser.toast.uploadFolderFailed'), {
        description:
          error instanceof Error ? error.message : t('fileBrowser.toast.uploadFolderFailedDesc'),
      });
    }
  };

  const handleDownload = async (file: FileItem) => {
    try {
      const destPath = await save({ defaultPath: file.name });
      if (!destPath) return;

      dispatchTransfer({
        type: "ENQUEUE",
        items: [{
          fileName: file.name,
          direction: "download" as const,
          sourcePath: file.path,
          destinationPath: destPath,
          totalBytes: file.size,
        }],
      });
    } catch (error) {
      console.error('Download dialog error:', error);
    }
  };

  const handleDownloadMultiple = async (selectedFileItems: FileItem[]) => {
    const filesToDownload = selectedFileItems.filter(f => f.type === 'file');
    if (filesToDownload.length === 0) return;
    try {
      const destDir = await tauriOpen({ directory: true });
      if (!destDir) return;

      dispatchTransfer({
        type: "ENQUEUE",
        items: filesToDownload.map((f) => ({
          fileName: f.name,
          direction: "download" as const,
          sourcePath: f.path,
          destinationPath: `${destDir}/${f.name}`,
          totalBytes: f.size,
        })),
      });
      toast.info(t('fileBrowser.toast.queuedDownload', { count: filesToDownload.length }));
    } catch (error) {
      console.error('Download dialog error:', error);
    }
  };

  const handleCreateFolder = async () => {
    const folderName = prompt(t('fileBrowser.toast.enterFolderName'));
    if (folderName) {
      try {
        const folderPath = adapter.joinPath(currentPath, folderName);
        await adapter.createDirectory(folderPath);
        toast.success(t('fileBrowser.toast.folderCreated', { name: folderName }));
        void loadFiles();
      } catch (error) {
        console.error('Failed to create folder:', error);
        toast.error(t('fileBrowser.toast.folderCreateFailed'), {
          description: error instanceof Error ? error.message : t('fileBrowser.toast.folderCreateFailedDesc'),
        });
      }
    }
  };

  function handleDeleteFile(file: FileItem) {
    setDeletingFile(file);
  };

  const confirmDeleteFile = async () => {
    if (!deletingFile) return;

    try {
      await adapter.deleteItem(
        deletingFile.path,
        deletingFile.type === 'directory',
      );

      toast.success(t('fileBrowser.toast.deleted', { name: deletingFile.name }));
      setDeletingFile(null);
      void loadFiles();
    } catch (error) {
      console.error('[FileBrowser] Failed to delete file:', error);
      toast.error(t('fileBrowser.toast.deleteFailed'), {
        description: error instanceof Error ? error.message : t('fileBrowser.toast.deleteFailedDesc'),
      });
    }
  };

  const cancelDeleteFile = () => {
    setDeletingFile(null);
  };

  function handleCopyFiles(files: FileItem[]) {
    setClipboard({ files, operation: 'copy' });
    toast.success(t('fileBrowser.toast.copiedToClipboard', { count: files.length }));
  };

  function handleCutFiles(files: FileItem[]) {
    setClipboard({ files, operation: 'cut' });
    toast.success(t('fileBrowser.toast.cutToClipboard', { count: files.length }));
  };

  async function handlePasteFiles() {
    if (!adapter.supportsClipboard || !clipboard) return;
    try {
      for (const file of clipboard.files) {
        const destPath = adapter.joinPath(currentPath, file.name);

        if (clipboard.operation === 'copy') {
          await adapter.copyItem(file.path, destPath);
        } else {
          await adapter.renameItem(file.path, destPath);
        }
      }

      const operation = clipboard.operation === 'copy' ? 'copied' : 'moved';
      toast.success(t('fileBrowser.toast.pasted', { count: clipboard.files.length, operation }));
      setClipboard(null);
      void loadFiles();
    } catch (error) {
      console.error('Failed to paste files:', error);
      toast.error(t('fileBrowser.toast.pasteFailed'), {
        description: error instanceof Error ? error.message : t('fileBrowser.toast.pasteFailedDesc'),
      });
    }
  };

  function handleRenameFile(file: FileItem) {
    setRenamingFile(file);
    setNewFileName(file.name);
  };

  const handleRenameConfirm = async () => {
    if (renamingFile && newFileName.trim()) {
      try {
        const oldPath = adapter.joinPath(currentPath, renamingFile.name);
        const newPath = adapter.joinPath(currentPath, newFileName);

        await adapter.renameItem(oldPath, newPath);

        toast.success(t('fileBrowser.toast.renamed', { oldName: renamingFile.name, newName: newFileName }));
        setRenamingFile(null);
        setNewFileName('');
        void loadFiles();
      } catch (error) {
        console.error('Failed to rename file:', error);
        toast.error(t('fileBrowser.toast.renameFailed'), {
          description: error instanceof Error ? error.message : t('fileBrowser.toast.renameFailedDesc'),
        });
      }
    }
  };

  function handleRenameCancel() {
    setRenamingFile(null);
    setNewFileName('');
  };

  const handleCopyPath = (file: FileItem) => {
    void navigator.clipboard.writeText(file.path);
    toast.success(t('fileBrowser.toast.pathCopied'));
  };

  const handleFileInfo = (file: FileItem) => {
    toast.info(`File: ${file.name}\nSize: ${formatFileSize(file.size)}\nModified: ${formatDate(file.modified)}\nPermissions: ${file.permissions}`);
  };

  const handleNewFile = async () => {
    if (!adapter.supportsNewFile) return;
    const fileName = prompt(t('fileBrowser.toast.enterFileName'));
    if (fileName) {
      try {
        const filePath = adapter.joinPath(currentPath, fileName);
        await adapter.createFile(filePath, '');
        toast.success(t('fileBrowser.toast.fileCreated', { name: fileName }));
        void loadFiles();
      } catch (error) {
        console.error('Failed to create file:', error);
        toast.error(t('fileBrowser.toast.fileCreateFailed'), {
          description: error instanceof Error ? error.message : t('fileBrowser.toast.fileCreateFailedDesc'),
        });
      }
    }
  };

  const handleDuplicateFile = async (file: FileItem) => {
    if (!adapter.supportsClipboard) return;
    const newName = `${file.name}_copy`;
    try {
      const destPath = adapter.joinPath(currentPath, newName);
      await adapter.copyItem(file.path, destPath);
      toast.success(t('fileBrowser.toast.duplicated', { name: file.name, newName }));
      void loadFiles();
    } catch (error) {
      console.error('Failed to duplicate file:', error);
      toast.error(t('fileBrowser.toast.duplicateFailed'), {
        description: error instanceof Error ? error.message : t('fileBrowser.toast.duplicateFailedDesc'),
      });
    }
  };

  // Drag and drop: the hook owns the Tauri `onDragDropEvent` subscription and
  // hit-tests `event.position` (physical px → CSS px) against `dropZoneRef`.
  const dropZoneRef = useRef<HTMLDivElement>(null);
  // Stable ref to the hook's `clearDragOver`; captured via ref so the drop
  // handler can clear the overlay defensively without creating a circular
  // callback dependency (the hook takes `handleOsFilesDropped` as `onDrop`,
  // and we need to call `clearDragOver` from inside that same handler).
  const clearDragOverRef = useRef<() => void>(() => {});

  const handleOsFilesDropped = useCallback(async (paths: string[]) => {
    // Defensive: clear the overlay immediately before any async work. The hook
    // already clears on `drop`, but some OS/driver combinations never deliver
    // the drop event (observed intermittently on macOS) and the overlay would
    // otherwise remain visible until the 10 s safety timer fires.
    clearDragOverRef.current();
    if (!adapter.supportsUpload || !isAvailable || paths.length === 0) return;
    try {
      // Stat each path in parallel so we know which are files vs directories.
      const stats = await Promise.all(
        paths.map((p) =>
          invoke<LocalPathStat>("stat_local_path", { path: p }),
        ),
      );

      // Recurse each dropped directory in parallel to gather entries.
      const directoryEntries = await Promise.all(
        stats.map(async (s, idx) => {
          if (!s.is_directory) return undefined;
          try {
            return await invoke<LocalRecursiveUploadEntry[]>(
              "list_local_files_recursive",
              { path: paths[idx], excludePatterns: [] },
            );
          } catch (err) {
            console.error(
              `list_local_files_recursive(${paths[idx]}) failed:`,
              err,
            );
            return [];
          }
        }),
      );

      const dropped: DroppedPathStat[] = paths.map((p, i) => ({
        path: p,
        stat: stats[i],
        entries: directoryEntries[i] ?? undefined,
      }));

      const plan = buildMixedDropUploadPlan(dropped, currentPath);

      // Create remote directories in order (depth-first). Shell quoting is
      // handled on the Rust side; failures are accumulated and reported.
      let createdDirectoryCount = 0;
      const dirErrors: string[] = [];
      for (const remoteDirectory of plan.directories) {
        try {
          await invoke<boolean>("create_directory", {
            connectionId,
            path: remoteDirectory,
          });
          createdDirectoryCount += 1;
        } catch (err) {
          dirErrors.push(
            `${remoteDirectory}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (dirErrors.length > 0) {
        toast.warning(t('fileBrowser.toast.dirCreationFailed', { count: dirErrors.length }), {
          description: dirErrors.slice(0, 3).join("\n"),
        });
      }

      if (plan.items.length > 0) {
        dispatchTransfer({ type: "ENQUEUE", items: plan.items });
        toast.info(
          t('fileBrowser.toast.queuedUploadToPath', { count: plan.items.length, path: currentPath }) +
            (createdDirectoryCount > 0
              ? "; " + t('fileBrowser.toast.createdRemoteFolders', { count: createdDirectoryCount })
              : ""),
        );
      } else if (dirErrors.length === 0 && plan.skipped.length === 0) {
        // Nothing to upload — refresh the listing in case folders were created.
        void loadFiles();
        if (createdDirectoryCount > 0) {
          toast.info(t('fileBrowser.toast.createdRemoteFolders', { count: createdDirectoryCount }));
        }
      }

      if (plan.skipped.length > 0) {
        toast.warning(
          t('fileBrowser.toast.droppedPathsSkipped', { count: plan.skipped.length }),
          { description: plan.skipped.slice(0, 3).map((s) => s.path).join("\n") },
        );
      }
    } catch (error) {
      console.error("OS drop handler error:", error);
      toast.error(t('fileBrowser.toast.dropUploadFailed'), {
        description:
          error instanceof Error ? error.message : t('fileBrowser.toast.dropUploadFailedDesc'),
      });
    }
  }, [adapter.supportsUpload, connectionId, currentPath, isAvailable, loadFiles]);

  const { isDragOver: isDraggingOver, clearDragOver } = useWebviewFileDrop({
    enabled: adapter.supportsUpload && isAvailable,
    targetRef: dropZoneRef,
    onDrop: handleOsFilesDropped,
    priority: 0,
  });
  // Keep the ref in sync with the latest clearDragOver identity.
  clearDragOverRef.current = clearDragOver;

  const filteredFiles = files.filter(file => 
    file.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Sort files (directories first, then by selected field)
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedFiles = [...filteredFiles].sort((a, b) => {
    // Always keep ".." at the top
    if (a.name === '..') return -1;
    if (b.name === '..') return 1;
    
    // Always keep directories before files (unless sorting by type explicitly)
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    
    let comparison = 0;
    
    switch (sortField) {
      case 'name':
        comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        break;
      case 'size':
        comparison = a.size - b.size;
        break;
      case 'modified':
        comparison = new Date(a.modified).getTime() - new Date(b.modified).getTime();
        break;
      case 'permissions':
        comparison = a.permissions.localeCompare(b.permissions);
        break;
      case 'owner':
        comparison = a.owner.localeCompare(b.owner);
        break;
    }
    
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  // Count actual files/folders (excluding ".." navigation entry)
  const actualItemCount = filteredFiles.filter(file => file.name !== '..').length;

  if (!isLocalMode && !isAvailable) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Folder className="mx-auto mb-4 h-12 w-12 opacity-50" />
          <p className="text-sm">{t('fileBrowser.connectPrompt')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden bg-background ${resizingColumn ? 'cursor-col-resize select-none' : ''}`}>
      <PanelToolbar className={`${FILE_BROWSER_CHROME_TEXT} gap-1 overflow-x-auto whitespace-nowrap scrollbar-none`}>
          {/* Back */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            title={t('fileBrowser.toolbar.back')}
            disabled={!canGoBack}
            onClick={goBack}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          {/* Forward */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            title={t('fileBrowser.toolbar.forward')}
            disabled={!canGoForward}
            onClick={goForward}
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          {/* Go Up */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            title={t('fileBrowser.toolbar.parentDir')}
            disabled={adapter.isRootPath(currentPath)}
            onClick={goUp}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          {/* Home */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            title={t('fileBrowser.toolbar.home')}
            onClick={() => {
              void adapter.homePath().then((home) => navigateTo(home));
            }}
          >
            <Home className="h-3.5 w-3.5" />
          </Button>

          {/* Breadcrumb / Editable address bar */}
          <div
            className="group mx-1.5 flex h-6 min-w-0 flex-1 cursor-text items-center rounded-sm border border-panel-border bg-background px-2 transition-colors hover:border-border"
            onClick={() => {
              if (!isEditingPath) {
                setEditPathValue(currentPath);
                setIsEditingPath(true);
                setTimeout(() => pathInputRef.current?.select(), 0);
              }
            }}
          >
            {isEditingPath ? (
              <input
                ref={pathInputRef}
                autoFocus
                className="h-full w-full bg-transparent font-mono outline-none"
                value={editPathValue}
                onChange={(e) => setEditPathValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handlePathSubmit();
                  if (e.key === 'Escape') setIsEditingPath(false);
                }}
                onBlur={handlePathSubmit}
              />
            ) : (
              <div className="flex items-center gap-0 overflow-x-auto whitespace-nowrap scrollbar-none">
                {getBreadcrumbs(currentPath).map((seg, i) => (
                  <React.Fragment key={seg.path}>
                    {i > 0 && (
                      <ChevronRight className="mx-0.5 h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                    )}
                    <button
                      className="max-w-[120px] truncate rounded px-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigateTo(seg.path);
                      }}
                      title={seg.path}
                    >
                      {seg.label}
                    </button>
                  </React.Fragment>
                ))}
                <Pencil className="ml-auto h-2.5 w-2.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/50" />
              </div>
            )}
          </div>

          {/* Refresh */}
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" title={t('fileBrowser.toolbar.refresh')} onClick={() => loadFiles()} disabled={isLoading}>
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>

          <div className="mx-1 h-4 w-px shrink-0 bg-border/60" />

          <Button variant="ghost" size="sm" className="h-6 shrink-0 px-2" onClick={handleCreateFolder}>
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
          {adapter.supportsUpload && (
            <>
              <Button variant="ghost" size="sm" className="h-6 shrink-0 px-2" title={t('fileBrowser.toolbar.uploadFiles')} onClick={handleUpload}>
                <Upload className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" className="h-6 shrink-0 px-2" title={t('fileBrowser.toolbar.uploadFolder')} onClick={handleUploadFolder}>
                <FolderUp className="h-3.5 w-3.5" />
              </Button>
            </>
          )}

          <div className="mx-1 h-4 w-px shrink-0 bg-border/60" />

          <div className="w-32 min-w-[7rem] shrink-0 sm:w-40">
            <Input
              placeholder={t('fileBrowser.searchFiles')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-6 border-panel-border bg-background shadow-none placeholder:text-muted-foreground/60 transition-colors focus-visible:bg-background"
            />
          </div>

          <span className="shrink-0 whitespace-nowrap text-muted-foreground">{t('fileBrowser.items', { count: actualItemCount })}</span>

          {selectedFiles.size > 0 && (
            <span className="shrink-0 whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-primary">
              {t('fileBrowser.selected', { count: selectedFiles.size })}
            </span>
          )}
      </PanelToolbar>

      {/* File List + Directory Tree */}
      <div className="min-h-0 flex-1 pb-2">
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="integrated-file-browser-split"
          className="h-full"
        >
          {/* Directory tree sidebar */}
          <ResizablePanel
            id="ssh-dir-tree"
            order={1}
            defaultSize={22}
            minSize={14}
            maxSize={40}
          >
            <DirectoryTree
              loadDirectory={loadTreeDirectories}
              currentPath={currentPath}
              onNavigate={navigateTo}
              disabled={!isAvailable}
              initialExpanded={treeInitialExpanded}
              initialNodes={treeInitialNodes}
              initialScrollTop={treeInitialScrollTop}
              onSaveState={handleSaveTreeState}
              onSaveScroll={handleSaveTreeScroll}
            />
          </ResizablePanel>

          <ResizableHandle />

          {/* File list panel */}
          <ResizablePanel id="ssh-file-list" order={2} defaultSize={78} minSize={40}>
            <div
              ref={dropZoneRef}
              className="relative flex flex-col h-full overflow-hidden rounded-md border border-border/50 bg-background/50 shadow-sm ring-1 ring-black/5 dark:ring-white/5 transition-all"
              // Required on Linux/WebKit2GTK: without preventDefault the browser
              // never signals "drop accepted", so Tauri's native drop signal
              // never fires. Also suppresses the browser's default file-open
              // behavior on drop.
              onDragOver={(e) => e.preventDefault()}
            >
              {/* Drag overlay */}
              {isDraggingOver && (
                <div className="absolute inset-0 bg-accent/20 border-2 border-dashed border-primary z-50 flex items-center justify-center pointer-events-none">
                  <div className="bg-background/90 rounded-lg p-6 shadow-lg">
                    <Upload className="h-12 w-12 mx-auto mb-3 text-primary" />
                    <p className="font-medium">Drop files or folders to upload</p>
                    <p className="text-sm text-muted-foreground mt-1">Upload to {currentPath}</p>
                  </div>
                </div>
              )}

              {/* Column Headers — outside ScrollArea so they never move */}
              <div className={`panel-toolbar flex shrink-0 gap-2 px-2 py-px font-medium text-muted-foreground ${FILE_BROWSER_LIST_TEXT}`}>
                <div 
                  className="flex items-center relative cursor-pointer hover:text-foreground select-none" 
                  style={{ width: `${columnWidths.name}px` }}
                  onClick={() => handleSort('name')}
                >
                  <span>{t('fileBrowser.column.name')}</span>
                  {sortField === 'name' ? (
                    sortDirection === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />
                  ) : <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />}
                  <div 
                    className="absolute right-[-4px] top-0 bottom-0 w-2 cursor-col-resize hover:bg-accent/50 group flex items-center justify-center"
                    onMouseDown={(e) => handleResizeStart('name', e)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GripVertical className="h-3 w-3 opacity-0 group-hover:opacity-70" />
                  </div>
                </div>
                <div 
                  className="flex items-center relative cursor-pointer hover:text-foreground select-none" 
                  style={{ width: `${columnWidths.size}px` }}
                  onClick={() => handleSort('size')}
                >
                  <span>{t('fileBrowser.column.size')}</span>
                  {sortField === 'size' ? (
                    sortDirection === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />
                  ) : <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />}
                  <div 
                    className="absolute right-[-4px] top-0 bottom-0 w-2 cursor-col-resize hover:bg-accent/50 group flex items-center justify-center"
                    onMouseDown={(e) => handleResizeStart('size', e)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GripVertical className="h-3 w-3 opacity-0 group-hover:opacity-70" />
                  </div>
                </div>
                <div 
                  className="flex items-center relative cursor-pointer hover:text-foreground select-none" 
                  style={{ width: `${columnWidths.modified}px` }}
                  onClick={() => handleSort('modified')}
                >
                  <span>{t('fileBrowser.column.modified')}</span>
                  {sortField === 'modified' ? (
                    sortDirection === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />
                  ) : <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />}
                  <div 
                    className="absolute right-[-4px] top-0 bottom-0 w-2 cursor-col-resize hover:bg-accent/50 group flex items-center justify-center"
                    onMouseDown={(e) => handleResizeStart('modified', e)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GripVertical className="h-3 w-3 opacity-0 group-hover:opacity-70" />
                  </div>
                </div>
                {!isLocalMode && (
                  <>
                    <div
                      className="flex items-center relative cursor-pointer hover:text-foreground select-none"
                      style={{ width: `${columnWidths.permissions}px` }}
                      onClick={() => handleSort('permissions')}
                    >
                      <span>{t('fileBrowser.column.permissions')}</span>
                      {sortField === 'permissions' ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />
                      ) : <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />}
                      <div
                        className="absolute right-[-4px] top-0 bottom-0 w-2 cursor-col-resize hover:bg-accent/50 group flex items-center justify-center"
                        onMouseDown={(e) => handleResizeStart('permissions', e)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GripVertical className="h-3 w-3 opacity-0 group-hover:opacity-70" />
                      </div>
                    </div>
                    <div
                      className="flex items-center cursor-pointer hover:text-foreground select-none"
                      style={{ width: `${columnWidths.owner}px` }}
                      onClick={() => handleSort('owner')}
                    >
                      <span>{t('fileBrowser.column.owner')}</span>
                      {sortField === 'owner' ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />
                      ) : <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />}
                    </div>
                  </>
                )}
              </div>

              <ScrollArea className="flex-1 min-h-0 [&>[data-slot=scroll-area-viewport]]:[scrollbar-gutter:stable]">
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div className="min-h-full p-1.5" data-columns-container>
                      {/* File Rows */}
                      {sortedFiles.map((file, index) => (
                        <ContextMenu key={index} onOpenChange={(open) => {
                          // Clear the right-click selection when the context menu closes (loses focus)
                          if (!open) {
                            setSelectedFiles(new Set());
                          }
                        }}>
                          <ContextMenuTrigger asChild>
                            <div
                              className={`${FILE_BROWSER_LIST_TEXT} flex cursor-pointer gap-2 border-b border-border/30 px-2 py-px hover:bg-muted/50 ${
                                selectedFiles.has(file.name) ? 'bg-accent' : ''
                              }`}
                              onClick={(e) => handleFileClick(file, e)}
                              onDoubleClick={() => handleFileDoubleClick(file)}
                              onContextMenu={() => {
                                // Select the file when right-clicking to show which file the context menu operates on
                                if (!selectedFiles.has(file.name)) {
                                  setSelectedFiles(new Set([file.name]));
                                }
                              }}
                            >
                    <div className={`flex min-w-0 items-center gap-1 ${FILE_BROWSER_LIST_ICONS}`} style={{ width: `${columnWidths.name}px` }}>
                      {getFileIcon(file)}
                      {renamingFile?.name === file.name ? (
                        <Input
                          value={newFileName}
                          onChange={(e) => setNewFileName(e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') void handleRenameConfirm();
                            if (e.key === 'Escape') handleRenameCancel();
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={handleRenameConfirm}
                          className="h-5 min-h-0 rounded-sm border-border/50 bg-background px-1 py-0 text-inherit shadow-none focus-visible:border-border focus-visible:ring-0 focus-visible:outline-none"
                          autoFocus
                        />
                      ) : (
                        <span className="truncate">{file.name}</span>
                      )}
                    </div>
                    <div className="truncate text-muted-foreground" style={{ width: `${columnWidths.size}px` }}>
                      {file.type === 'file' ? formatFileSize(file.size) : '-'}
                    </div>
                    <div className="truncate text-muted-foreground" style={{ width: `${columnWidths.modified}px` }}>
                      {file.name !== '..' ? formatDate(file.modified) : '-'}
                    </div>
                    {!isLocalMode && (
                      <>
                        <div className="truncate font-mono text-muted-foreground" style={{ width: `${columnWidths.permissions}px` }}>
                          {file.permissions}
                        </div>
                        <div className="truncate text-muted-foreground" style={{ width: `${columnWidths.owner}px` }}>
                          {file.owner}:{file.group}
                        </div>
                      </>
                    )}
                            </div>
                          </ContextMenuTrigger>

                          <ContextMenuContent className="w-64">
                  {/* File-specific actions */}
                  {file.type === 'file' && (
                    <>
                      {isLocalMode ? (
                        <ContextMenuItem onClick={() => void adapter.openInOS(file.path)}>
                          <Eye className="mr-2 h-4 w-4" />
                          {t('filePanel.contextMenu.openInOS')}
                        </ContextMenuItem>
                      ) : (
                        <>
                          <ContextMenuItem onClick={() => openFileInEditor(file, { readOnly: true })}>
                            <Eye className="mr-2 h-4 w-4" />
                            {t('fileBrowser.contextMenu.open')}
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => openFileInEditor(file, { readOnly: false })}>
                            <Edit className="mr-2 h-4 w-4" />
                            {t('fileBrowser.contextMenu.edit')}
                          </ContextMenuItem>
                          {onOpenInLogMonitor && (
                            <ContextMenuItem onClick={() => onOpenInLogMonitor(file.path)}>
                              <ScrollText className="mr-2 h-4 w-4" />
                              {t('fileBrowser.contextMenu.openInLogMonitor')}
                            </ContextMenuItem>
                          )}
                        </>
                      )}
                      <ContextMenuSeparator />
                    </>
                  )}
                  
                  {/* Directory-specific actions */}
                  {file.type === 'directory' && file.name !== '..' && (
                    <>
                      <ContextMenuItem onClick={() => handleFileDoubleClick(file)}>
                        <Folder className="mr-2 h-4 w-4" />
                        Open Folder
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                    </>
                  )}

                  {/* Common actions */}
                  {file.name !== '..' && (
                    <>
                      {adapter.supportsClipboard && (
                        <>
                          <ContextMenuItem onClick={() => handleCopyFiles([file])}>
                            <Copy className="mr-2 h-4 w-4" />
                            {t('fileBrowser.contextMenu.copy')}
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => handleCutFiles([file])}>
                            <Scissors className="mr-2 h-4 w-4" />
                            {t('fileBrowser.contextMenu.cut')}
                          </ContextMenuItem>
                          {clipboard && (
                            <ContextMenuItem onClick={handlePasteFiles}>
                              <ClipboardPaste className="mr-2 h-4 w-4" />
                              {t('fileBrowser.contextMenu.paste')} {clipboard.files.length} item(s)
                            </ContextMenuItem>
                          )}
                          <ContextMenuSeparator />
                        </>
                      )}

                      <ContextMenuItem onClick={() => handleRenameFile(file)}>
                        <FileEdit className="mr-2 h-4 w-4" />
                        {t('fileBrowser.contextMenu.rename')}
                      </ContextMenuItem>
                      {adapter.supportsClipboard && (
                        <ContextMenuItem onClick={() => handleDuplicateFile(file)}>
                          <Layers className="mr-2 h-4 w-4" />
                          {t('fileBrowser.contextMenu.duplicate')}
                        </ContextMenuItem>
                      )}
                      <ContextMenuSeparator />
                    </>
                  )}

                  {/* Download for files */}
                  {adapter.supportsTransfer && file.type === 'file' && (
                    <>
                      <ContextMenuItem onClick={() => handleDownload(file)}>
                        <Download className="mr-2 h-4 w-4" />
                        {t('fileBrowser.contextMenu.download')}
                      </ContextMenuItem>
                      {selectedFiles.size > 1 && (
                        <ContextMenuItem onClick={() => handleDownloadMultiple(files.filter(f => selectedFiles.has(f.name)))}>
                          <Download className="mr-2 h-4 w-4" />
                          {t('fileBrowser.downloadSelected', { count: selectedFiles.size })}
                        </ContextMenuItem>
                      )}
                      <ContextMenuSeparator />
                    </>
                  )}

                  {/* Information and sharing */}
                  <ContextMenuItem onClick={() => handleCopyPath(file)}>
                    <Link className="mr-2 h-4 w-4" />
                    {t('fileBrowser.contextMenu.copyPath')}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleFileInfo(file)}>
                    <Info className="mr-2 h-4 w-4" />
                    {t('fileBrowser.contextMenu.fileInfo')}
                  </ContextMenuItem>

                  {/* Destructive actions */}
                  {file.name !== '..' && (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem 
                        className="text-destructive focus:text-destructive"
                        onClick={() => handleDeleteFile(file)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('fileBrowser.contextMenu.delete')}
                      </ContextMenuItem>
                    </>
                  )}
                          </ContextMenuContent>
                        </ContextMenu>
                      ))}
                    </div>
                  </ContextMenuTrigger>

                  {/* Empty space context menu */}
                  <ContextMenuContent className="w-48">
              {adapter.supportsNewFile && (
                <ContextMenuItem onClick={handleNewFile}>
                  <File className="mr-2 h-4 w-4" />
                  {t('fileBrowser.contextMenu.newFile')}
                </ContextMenuItem>
              )}
              <ContextMenuItem onClick={handleCreateFolder}>
                <FolderPlus className="mr-2 h-4 w-4" />
                {t('fileBrowser.contextMenu.newFolder')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              
              {adapter.supportsClipboard && clipboard && (
                <>
                  <ContextMenuItem onClick={handlePasteFiles}>
                    <ClipboardPaste className="mr-2 h-4 w-4" />
                    {t('fileBrowser.contextMenu.paste')} {clipboard.files.length} item(s)
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                </>
              )}

              {adapter.supportsUpload && (
                <>
                  <ContextMenuItem onClick={handleUpload}>
                    <Upload className="mr-2 h-4 w-4" />
                    {t('fileBrowser.contextMenu.upload')}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={handleUploadFolder}>
                    <FolderUp className="mr-2 h-4 w-4" />
                    {t('fileBrowser.contextMenu.uploadFolder')}
                  </ContextMenuItem>
                </>
              )}
              <ContextMenuItem onClick={() => loadFiles()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('fileBrowser.contextMenuRefresh')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              
              <ContextMenuItem onClick={() => setSelectedFiles(new Set())}>
                <X className="mr-2 h-4 w-4" />
                {t('fileBrowser.clearSelection')}
              </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </ScrollArea>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {adapter.supportsTransfer && (
        <TransferQueue
          transfers={transfers}
          dispatch={dispatchTransfer}
          expanded={queueExpanded}
          onToggleExpanded={() => setQueueExpanded(p => !p)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingFile} onOpenChange={(open) => !open && setDeletingFile(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deletingFile?.type === 'directory' ? t('fileBrowser.deleteFolderTitle') : t('fileBrowser.deleteFileTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('fileBrowser.deleteConfirm', { name: deletingFile?.name })}
              {deletingFile?.type === 'directory' && (
                <span className="block mt-2 text-destructive font-medium">
                  {t('fileBrowser.deleteFolderWarning')}
                </span>
              )}
              {t('fileBrowser.cannotBeUndone')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDeleteFile}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteFile} className="bg-destructive hover:bg-destructive/90">
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
