import { useMemo, useRef, useState } from 'react';
import { Clock, Plus, Search, Server, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConnectionStorageManager, type ConnectionData } from '@/lib/connection-storage';
import { filterConnections } from '@/lib/new-tab-menu-utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Separator } from '../ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../ui/utils';

interface NewTabMenuProps {
  groupId: string;
  onOpenSavedConnection?: (connectionId: string, targetGroupId: string) => void | Promise<void>;
  onNewConnection?: () => void;
  onNewLocalTerminal?: () => void | Promise<void>;
}

function ConnectionItem({
  connection,
  active,
  onSelect,
  itemRef,
}: {
  connection: ConnectionData;
  active: boolean;
  onSelect: () => void;
  itemRef?: (node: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={itemRef}
      type="button"
      role="option"
      aria-selected={active}
      className={cn(
        'flex w-full min-w-0 items-start gap-2 rounded-sm px-2 py-1.5 text-left outline-none',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/70',
      )}
      onClick={onSelect}
    >
      <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{connection.name}</span>
          <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] leading-none text-muted-foreground">
            {connection.protocol}
          </span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {connection.username ? `${connection.username}@` : ''}{connection.host}
          {connection.folder && connection.folder !== 'All Connections' ? ` · ${connection.folder}` : ''}
        </span>
      </span>
    </button>
  );
}

export function NewTabMenu({
  groupId,
  onOpenSavedConnection,
  onNewConnection,
  onNewLocalTerminal,
}: NewTabMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [connections, setConnections] = useState<ConnectionData[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const sortedConnections = useMemo(
    () => [...connections].sort((a, b) => a.name.localeCompare(b.name)),
    [connections],
  );
  const recentConnections = useMemo(
    () => [...connections]
      .filter((connection) => connection.lastConnected)
      .sort((a, b) => Date.parse(b.lastConnected!) - Date.parse(a.lastConnected!))
      .slice(0, 5),
    [connections],
  );
  const searchResults = useMemo(
    () => filterConnections(sortedConnections, query),
    [query, sortedConnections],
  );
  const visibleConnections = query.trim()
    ? searchResults
    : [...recentConnections, ...sortedConnections];

  const closeAndRun = (callback?: () => void | Promise<void>) => {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
    if (callback) void callback();
  };

  const openConnection = (connection: ConnectionData) => {
    closeAndRun(() => onOpenSavedConnection?.(connection.id, groupId));
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setConnections(ConnectionStorageManager.getConnections());
      setQuery('');
      setActiveIndex(-1);
    }
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (visibleConnections.length === 0) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = activeIndex < 0
        ? (direction === 1 ? 0 : visibleConnections.length - 1)
        : (activeIndex + direction + visibleConnections.length) % visibleConnections.length;
      setActiveIndex(nextIndex);
      itemRefs.current[nextIndex]?.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      const connection = visibleConnections[activeIndex];
      if (connection) openConnection(connection);
    }
  };

  let itemIndex = 0;
  const renderConnection = (connection: ConnectionData, keyPrefix: string) => {
    const currentIndex = itemIndex++;
    return (
      <ConnectionItem
        key={`${keyPrefix}-${connection.id}`}
        connection={connection}
        active={activeIndex === currentIndex}
        itemRef={(node) => { itemRefs.current[currentIndex] = node; }}
        onSelect={() => openConnection(connection)}
      />
    );
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="toolbar"
                className="mx-1"
                aria-label={t('newTabMenu.title')}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t('newTabMenu.title')}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        align="end"
        side="bottom"
        className="flex w-[340px] max-w-[calc(100vw-16px)] flex-col gap-0 p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(-1);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder={t('newTabMenu.searchPlaceholder')}
              aria-label={t('newTabMenu.searchPlaceholder')}
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>

        <div role="listbox" className="max-h-[min(420px,60vh)] overflow-y-auto p-1">
          {query.trim() ? (
            searchResults.length > 0 ? (
              <>
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {t('newTabMenu.searchResults')}
                </div>
                {searchResults.map((connection) => renderConnection(connection, 'search'))}
              </>
            ) : (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t('newTabMenu.noResults')}
              </div>
            )
          ) : connections.length > 0 ? (
            <>
              {recentConnections.length > 0 && (
                <>
                  <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {t('newTabMenu.recentConnections')}
                  </div>
                  {recentConnections.map((connection) => renderConnection(connection, 'recent'))}
                </>
              )}
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                {t('newTabMenu.allConnections')}
              </div>
              {sortedConnections.map((connection) => renderConnection(connection, 'all'))}
            </>
          ) : (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('newTabMenu.noSavedConnections')}
            </div>
          )}
        </div>

        <Separator />
        <div className="p-1">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            onClick={() => closeAndRun(onNewConnection)}
          >
            <Plus className="h-4 w-4 text-muted-foreground" />
            {t('newTabMenu.newConnection')}
          </button>
          {onNewLocalTerminal && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onClick={() => closeAndRun(onNewLocalTerminal)}
            >
              <Terminal className="h-4 w-4 text-muted-foreground" />
              {t('newTabMenu.newLocalTerminal')}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
