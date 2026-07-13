const STORAGE_KEY = 'skd-port-forward-bookmarks';

export interface PortForwardBookmark {
  id: string;
  connectionProfileId: string;
  name: string;
  localBindHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  autoStart: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PortForwardBookmarkInput = Pick<
  PortForwardBookmark,
  'connectionProfileId' | 'name' | 'localBindHost' | 'localPort' | 'remoteHost' | 'remotePort' | 'autoStart'
>;

function isBookmark(value: unknown): value is PortForwardBookmark {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string'
    && typeof item.connectionProfileId === 'string'
    && typeof item.name === 'string'
    && typeof item.localBindHost === 'string'
    && typeof item.localPort === 'number'
    && item.localPort >= 0
    && item.localPort <= 65535
    && typeof item.remoteHost === 'string'
    && typeof item.remotePort === 'number'
    && item.remotePort >= 1
    && item.remotePort <= 65535
    && typeof item.autoStart === 'boolean'
    && typeof item.createdAt === 'string'
    && typeof item.updatedAt === 'string';
}

function readAll(): PortForwardBookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isBookmark) : [];
  } catch {
    return [];
  }
}

function writeAll(bookmarks: PortForwardBookmark[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
}

export function getPortForwardBookmarks(connectionProfileId?: string): PortForwardBookmark[] {
  const bookmarks = readAll();
  return connectionProfileId
    ? bookmarks.filter((bookmark) => bookmark.connectionProfileId === connectionProfileId)
    : bookmarks;
}

export function getAutoStartPortForwardBookmarks(connectionProfileId: string): PortForwardBookmark[] {
  return getPortForwardBookmarks(connectionProfileId).filter((bookmark) => bookmark.autoStart);
}

export function savePortForwardBookmark(input: PortForwardBookmarkInput): PortForwardBookmark {
  const now = new Date().toISOString();
  const bookmark: PortForwardBookmark = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  writeAll([...readAll(), bookmark]);
  return bookmark;
}

export function updatePortForwardBookmark(
  id: string,
  updates: Partial<Omit<PortForwardBookmark, 'id' | 'connectionProfileId' | 'createdAt'>>,
): PortForwardBookmark | null {
  const bookmarks = readAll();
  const index = bookmarks.findIndex((bookmark) => bookmark.id === id);
  if (index < 0) return null;
  bookmarks[index] = { ...bookmarks[index], ...updates, updatedAt: new Date().toISOString() };
  writeAll(bookmarks);
  return bookmarks[index];
}

export function deletePortForwardBookmark(id: string): boolean {
  const bookmarks = readAll();
  const remaining = bookmarks.filter((bookmark) => bookmark.id !== id);
  if (remaining.length === bookmarks.length) return false;
  writeAll(remaining);
  return true;
}

export function deletePortForwardBookmarksForConnection(connectionProfileId: string): void {
  writeAll(readAll().filter((bookmark) => bookmark.connectionProfileId !== connectionProfileId));
}

export function clearPortForwardBookmarks(): void {
  localStorage.removeItem(STORAGE_KEY);
}

