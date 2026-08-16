import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Copy,
  Clipboard,
  Search,
  Trash2,
  FileText,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

interface TerminalContextMenuProps {
  children: React.ReactNode;
  onCopy: () => void;
  onPaste: () => void;
  onClear: () => void;
  onClearScrollback: () => void;
  onSearch: () => void;
  onFindNext?: () => void;
  onFindPrevious?: () => void;
  onSelectAll: () => void;
  onSaveToFile: () => void;
  onReconnect?: () => void;
  hasSelection: boolean;
  searchActive?: boolean;
  linkUrl?: string | null;
  onOpenLink?: () => void;
  onCopyLink?: () => void;
}

const modKey = '⌘';

export function TerminalContextMenu({
  children,
  onCopy,
  onPaste,
  onClear,
  onClearScrollback,
  onSearch,
  onFindNext,
  onFindPrevious,
  onSelectAll,
  onSaveToFile,
  onReconnect,
  hasSelection,
  searchActive = false,
  linkUrl,
  onOpenLink,
  onCopyLink,
}: TerminalContextMenuProps) {
  const { t } = useTranslation();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        {linkUrl && (
          <>
            <ContextMenuItem onClick={onOpenLink}>
              <ExternalLink className="mr-2 h-4 w-4" />
              <span>{t('contextMenu.openLink')}</span>
            </ContextMenuItem>
            <ContextMenuItem onClick={onCopyLink}>
              <Copy className="mr-2 h-4 w-4" />
              <span>{t('contextMenu.copyLink')}</span>
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={onCopy} disabled={!hasSelection}>
          <Copy className="mr-2 h-4 w-4" />
          <span>{t('contextMenu.copy')}</span>
          <ContextMenuShortcut>{modKey}+C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onPaste}>
          <Clipboard className="mr-2 h-4 w-4" />
          <span>{t('contextMenu.paste')}</span>
          <ContextMenuShortcut>{modKey}+V</ContextMenuShortcut>
        </ContextMenuItem>
        
        <ContextMenuSeparator />
        
        <ContextMenuItem onClick={onSearch}>
          <Search className="mr-2 h-4 w-4" />
          <span>{t('contextMenu.search')}</span>
          <ContextMenuShortcut>{modKey}+F</ContextMenuShortcut>
        </ContextMenuItem>
        
        {searchActive && onFindNext && (
          <ContextMenuItem onClick={onFindNext}>
            <Search className="mr-2 h-4 w-4" />
            <span>{t('contextMenu.findNext')}</span>
            <ContextMenuShortcut>F3</ContextMenuShortcut>
          </ContextMenuItem>
        )}
        
        {searchActive && onFindPrevious && (
          <ContextMenuItem onClick={onFindPrevious}>
            <Search className="mr-2 h-4 w-4" />
            <span>{t('contextMenu.findPrevious')}</span>
            <ContextMenuShortcut>⇧F3</ContextMenuShortcut>
          </ContextMenuItem>
        )}
        
        <ContextMenuSeparator />
        
        <ContextMenuItem onClick={onClear}>
          <Trash2 className="mr-2 h-4 w-4" />
          <span>{t('contextMenu.clearTerminal')}</span>
        </ContextMenuItem>
        <ContextMenuItem onClick={onClearScrollback}>
          <Trash2 className="mr-2 h-4 w-4" />
          <span>{t('contextMenu.clearScrollback')}</span>
        </ContextMenuItem>
        
        <ContextMenuSeparator />
        
        <ContextMenuItem onClick={onSelectAll}>
          <FileText className="mr-2 h-4 w-4" />
          <span>{t('contextMenu.selectAll')}</span>
          <ContextMenuShortcut>{modKey}+A</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onSaveToFile}>
          <FileText className="mr-2 h-4 w-4" />
          <span>{t('contextMenu.saveOutputToFile')}</span>
        </ContextMenuItem>
        
        {onReconnect && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onReconnect}>
              <RefreshCw className="mr-2 h-4 w-4" />
              <span>{t('contextMenu.reconnect')}</span>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
