import { invoke } from "@tauri-apps/api/core";
import { withRetry, CancelledError } from "@/lib/async-retry";
import type { FileEntry } from "@/lib/file-entry-types";
import { localParentPath } from "@/lib/file-entry-types";

export interface FileBrowserFileItem {
  name: string;
  type: "file" | "directory";
  size: number;
  modified: Date;
  permissions: string;
  owner: string;
  group: string;
  path: string;
}

export interface FileBrowserAdapter {
  mode: "local" | "remote";
  sessionKey: string;
  isAvailable: boolean;
  supportsTransfer: boolean;
  supportsUpload: boolean;
  supportsClipboard: boolean;
  supportsNewFile: boolean;
  supportsEditor: boolean;
  defaultHomePath: string;
  homePath: () => Promise<string>;
  listDirectory: (
    path: string,
    isCancelled: () => boolean,
  ) => Promise<FileBrowserFileItem[]>;
  listChildDirs: (path: string) => Promise<string[]>;
  deleteItem: (path: string, isDirectory: boolean) => Promise<void>;
  renameItem: (oldPath: string, newPath: string) => Promise<void>;
  createDirectory: (path: string) => Promise<void>;
  createFile: (path: string, content: string) => Promise<void>;
  copyItem: (sourcePath: string, destPath: string) => Promise<void>;
  openInOS: (path: string) => Promise<void>;
  joinPath: (base: string, name: string) => string;
  parentPath: (path: string) => string;
  isRootPath: (path: string) => boolean;
  normalizeNavPath: (path: string) => string;
  fallbackPathOnError: (failedPath: string) => string | null;
}

function remoteJoinPath(base: string, name: string): string {
  if (base === "/") return `/${name}`;
  return `${base}/${name}`;
}

function remoteParentPath(path: string): string {
  if (path === "/" || path === "") return "/";
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function localJoinPath(base: string, name: string): string {
  if (!base) return name;
  if (base.endsWith("/")) return `${base}${name}`;
  return `${base}/${name}`;
}

function mapFileEntryToItem(
  entry: FileEntry,
  dirPath: string,
): FileBrowserFileItem {
  const isDirectory =
    entry.file_type === "Directory" || entry.file_type === "Symlink";
  return {
    name: entry.name,
    type: isDirectory ? "directory" : "file",
    size: entry.size,
    modified: entry.modified ? new Date(entry.modified) : new Date(),
    permissions: entry.permissions ?? "-",
    owner: "-",
    group: "-",
    path: localJoinPath(dirPath, entry.name),
  };
}

function parentEntryForPath(
  targetPath: string,
  parentPathFn: (path: string) => string,
): FileBrowserFileItem {
  const parent = parentPathFn(targetPath);
  return {
    name: "..",
    type: "directory",
    size: 0,
    modified: new Date(),
    permissions: "drwxr-xr-x",
    owner: "-",
    group: "-",
    path: parent,
  };
}

function parseRemoteListOutput(
  output: string,
  targetPath: string,
): FileBrowserFileItem[] {
  const lines = output.split("\n").filter((l) => l.trim() && !l.startsWith("total"));

  const parsedFiles: FileBrowserFileItem[] = lines
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 8) return null;

      const permissions = parts[0];
      const owner = parts[2];
      const group = parts[3];
      const size = parseInt(parts[4]) || 0;
      const dateStr = parts[5];
      const timeStr = parts[6];
      const name = parts.slice(7).join(" ");
      const type: "directory" | "file" = permissions.startsWith("d")
        ? "directory"
        : "file";

      let modifiedDate = new Date();
      if (dateStr && timeStr) {
        modifiedDate = new Date(`${dateStr}T${timeStr}`);
      }

      if (name === "." || name === "..") return null;

      return {
        name,
        type,
        size,
        modified: modifiedDate,
        permissions,
        owner,
        group,
        path: remoteJoinPath(targetPath, name),
      };
    })
    .filter((f): f is FileBrowserFileItem => f !== null);

  if (targetPath !== "/") {
    parsedFiles.unshift(parentEntryForPath(targetPath, remoteParentPath));
  }

  return parsedFiles;
}

export function createRemoteAdapter(
  connectionId: string,
  isConnected: boolean,
): FileBrowserAdapter {
  return {
    mode: "remote",
    sessionKey: connectionId,
    isAvailable: isConnected && !!connectionId,
    supportsTransfer: true,
    supportsUpload: true,
    supportsClipboard: true,
    supportsNewFile: true,
    supportsEditor: true,
    defaultHomePath: "/home",
    homePath: async () => "/home",
    listDirectory: async (targetPath, isCancelled) => {
      const output = await withRetry(
        () => invoke<string>("list_files", { connectionId, path: targetPath }),
        isCancelled,
        { maxRetries: 2, baseDelayMs: 1000 },
      );
      if (isCancelled()) throw new CancelledError();
      if (output && output.trim()) {
        return parseRemoteListOutput(output, targetPath);
      }
      return targetPath !== "/"
        ? [parentEntryForPath(targetPath, remoteParentPath)]
        : [];
    },
    listChildDirs: async (path) => {
      if (!connectionId || !isConnected) return [];
      try {
        const output = await invoke<string>("list_files", { connectionId, path });
        if (!output) return [];
        const lines = output.split("\n").filter((l) => l.trim() && !l.startsWith("total"));
        const dirs: string[] = [];
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 8 && parts[0].startsWith("d")) {
            const name = parts.slice(7).join(" ");
            if (name && name !== "." && name !== "..") dirs.push(name);
          }
        }
        return dirs;
      } catch {
        return [];
      }
    },
    deleteItem: async (path, isDirectory) => {
      await invoke<boolean>("delete_file", { connectionId, path, isDirectory });
    },
    renameItem: async (oldPath, newPath) => {
      await invoke<boolean>("rename_file", { connectionId, oldPath, newPath });
    },
    createDirectory: async (path) => {
      await invoke<boolean>("create_directory", { connectionId, path });
    },
    createFile: async (path, content) => {
      await invoke<boolean>("create_file", { connectionId, path, content });
    },
    copyItem: async (sourcePath, destPath) => {
      await invoke<boolean>("copy_file", { connectionId, sourcePath, destPath });
    },
    openInOS: async (path) => {
      await invoke<void>("open_in_os", { path });
    },
    joinPath: remoteJoinPath,
    parentPath: remoteParentPath,
    isRootPath: (path) => path === "/",
    normalizeNavPath: (path) => (path.startsWith("/") ? path : `/${path}`),
    fallbackPathOnError: (failedPath) =>
      failedPath !== "/home" ? "/home" : null,
  };
}

export function createLocalAdapter(): FileBrowserAdapter {
  return {
    mode: "local",
    sessionKey: "local",
    isAvailable: true,
    supportsTransfer: false,
    supportsUpload: false,
    supportsClipboard: false,
    supportsNewFile: false,
    supportsEditor: false,
    defaultHomePath: "/",
    homePath: async () => {
      try {
        return await invoke<string>("get_home_directory");
      } catch {
        return "/";
      }
    },
    listDirectory: async (targetPath, _isCancelled) => {
      const entries = await invoke<FileEntry[]>("list_local_files", {
        path: targetPath,
      });
      const parsed = entries.map((entry) => mapFileEntryToItem(entry, targetPath));
      if (targetPath && targetPath !== "/") {
        parsed.unshift(parentEntryForPath(targetPath, localParentPath));
      }
      return parsed;
    },
    listChildDirs: async (path) => {
      try {
        const entries = await invoke<FileEntry[]>("list_local_files", { path });
        return entries
          .filter(
            (entry) =>
              entry.file_type === "Directory" || entry.file_type === "Symlink",
          )
          .map((entry) => entry.name);
      } catch {
        return [];
      }
    },
    deleteItem: async (path, isDirectory) => {
      await invoke<void>("delete_local_item", { path, isDirectory });
    },
    renameItem: async (oldPath, newPath) => {
      await invoke<void>("rename_local_item", { oldPath, newPath });
    },
    createDirectory: async (path) => {
      await invoke<void>("create_local_directory", { path });
    },
    createFile: async () => {
      throw new Error("create_file is not supported for local file browser");
    },
    copyItem: async () => {
      throw new Error("copy_file is not supported for local file browser");
    },
    openInOS: async (path) => {
      await invoke<void>("open_in_os", { path });
    },
    joinPath: localJoinPath,
    parentPath: localParentPath,
    isRootPath: (path) => !path || path === "/",
    normalizeNavPath: (path) => path.trim(),
    fallbackPathOnError: () => null,
  };
}

export function mapLocalEntriesToFileItems(
  entries: FileEntry[],
  dirPath: string,
): FileBrowserFileItem[] {
  return entries.map((entry) => mapFileEntryToItem(entry, dirPath));
}