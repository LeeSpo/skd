import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Eraser } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { useTerminalGroups } from '@/lib/terminal-group-context';
import { COMPOSE_PANE_SEND_OPTIONS, useTerminalInput } from '@/lib/terminal-input-context';
import {
  clearComposeDraft,
  loadComposeDraft,
  saveComposeDraft,
} from '@/lib/compose-draft-storage';

const CLEAR_AFTER_SEND_KEY = 'skd-compose-clear-after-send';
const DRAFT_DEBOUNCE_MS = 300;

function loadClearAfterSendPreference(): boolean {
  try {
    return localStorage.getItem(CLEAR_AFTER_SEND_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveClearAfterSendPreference(enabled: boolean): void {
  try {
    localStorage.setItem(CLEAR_AFTER_SEND_KEY, String(enabled));
  } catch {
    // Ignore storage errors.
  }
}

function isTerminalTab(tab: { tabType?: string } | null): boolean {
  if (!tab) return false;
  return tab.tabType !== 'file-browser' && tab.tabType !== 'editor';
}

interface ComposePaneEditorProps {
  connectionId: string;
  isConnected: boolean;
}

function ComposePaneEditor({ connectionId, isConnected }: ComposePaneEditorProps) {
  const { t } = useTranslation();
  const { sendToTerminal } = useTerminalInput();
  const [draft, setDraft] = useState(() => loadComposeDraft(connectionId));
  const [clearAfterSend, setClearAfterSend] = useState(loadClearAfterSendPreference);
  const draftRef = useRef(draft);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const timer = setTimeout(() => {
      saveComposeDraft(connectionId, draft);
    }, DRAFT_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [connectionId, draft]);

  useEffect(() => {
    return () => {
      saveComposeDraft(connectionId, draftRef.current);
    };
  }, [connectionId]);

  const handleSend = useCallback(() => {
    if (!isConnected) {
      toast.error(t('composePane.toast.notConnected'));
      return;
    }

    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      return;
    }

    const sent = sendToTerminal(connectionId, draft, COMPOSE_PANE_SEND_OPTIONS);
    if (!sent) {
      toast.error(t('composePane.toast.sendFailed'));
      return;
    }

    toast.success(t('composePane.toast.sent'));

    if (clearAfterSend) {
      setDraft('');
      clearComposeDraft(connectionId);
    }
  }, [clearAfterSend, connectionId, draft, isConnected, sendToTerminal, t]);

  const handleClear = useCallback(() => {
    setDraft('');
    clearComposeDraft(connectionId);
  }, [connectionId]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleClearAfterSendChange = useCallback((checked: boolean) => {
    setClearAfterSend(checked);
    saveClearAfterSendPreference(checked);
  }, []);

  const canSend = isConnected && draft.trim().length > 0;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 shrink-0 bg-muted/10">
        <Button
          type="button"
          size="sm"
          variant="default"
          className="h-8 gap-1.5 px-3 shadow-sm transition-all hover:shadow hover:-translate-y-[0.5px]"
          disabled={!canSend}
          onClick={handleSend}
        >
          <Send className="w-3.5 h-3.5" />
          {t('composePane.send')}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 gap-1.5 px-3 transition-colors bg-secondary/60 hover:bg-secondary"
          disabled={draft.length === 0}
          onClick={handleClear}
        >
          <Eraser className="w-3.5 h-3.5" />
          {t('composePane.clear')}
        </Button>

        <div className="flex items-center gap-2 ml-auto">
          <Switch
            id={`compose-clear-after-send-${connectionId}`}
            checked={clearAfterSend}
            onCheckedChange={handleClearAfterSendChange}
          />
          <Label
            htmlFor={`compose-clear-after-send-${connectionId}`}
            className="text-xs text-muted-foreground cursor-pointer"
          >
            {t('composePane.clearAfterSend')}
          </Label>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isConnected}
          placeholder={isConnected ? t('composePane.placeholder') : t('composePane.placeholderDisconnected')}
          className="absolute inset-0 h-full w-full rounded-none border-0 resize-none font-mono text-[13px] leading-relaxed p-4 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
          spellCheck={false}
        />
      </div>

      <div className="px-4 py-1.5 text-[11px] font-medium text-muted-foreground/60 border-t border-border/40 shrink-0 bg-muted/5 flex justify-end tracking-wide">
        {t('composePane.hint.sendShortcut')}
      </div>
    </div>
  );
}

export function ComposePane() {
  const { t } = useTranslation();
  const { activeTab } = useTerminalGroups();
  const terminalTab = isTerminalTab(activeTab) ? activeTab : null;

  if (!terminalTab) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground px-4">
        {t('composePane.emptyState.noTerminal')}
      </div>
    );
  }

  return (
    <ComposePaneEditor
      key={terminalTab.id}
      connectionId={terminalTab.id}
      isConnected={terminalTab.connectionStatus === 'connected'}
    />
  );
}