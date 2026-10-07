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
  const [sendError, setSendError] = useState<string | null>(null);

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
      setSendError(t('composePane.toast.notConnected'));
      toast.error(t('composePane.toast.notConnected'));
      return;
    }

    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      return;
    }

    const sent = sendToTerminal(connectionId, draft, COMPOSE_PANE_SEND_OPTIONS);
    if (!sent) {
      setSendError(t('composePane.toast.sendFailed'));
      toast.error(t('composePane.toast.sendFailed'));
      return;
    }

    setSendError(null);
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
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
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
    <div className="compose-pane flex h-full min-h-0 flex-col bg-background">
      {sendError && (
        <p role="alert" className="shrink-0 border-b border-panel-border px-4 py-2 text-xs text-destructive">
          {sendError}
        </p>
      )}

      <div className="relative flex-1 min-h-0 p-2">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isConnected}
          aria-label={t('composePane.editorLabel')}
          placeholder={isConnected ? t('composePane.placeholder') : t('composePane.placeholderDisconnected')}
          className="h-full w-full rounded-md border-0 resize-none font-mono text-[length:var(--text-body)] leading-relaxed p-3 bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-0 placeholder:text-muted-foreground"
          spellCheck={false}
        />
      </div>

      <div className="compose-actions flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <span className="mr-auto text-xs text-muted-foreground">{t('composePane.hint.sendShortcut')}</span>
        <div className="flex items-center gap-2">
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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-3"
          disabled={draft.length === 0}
          onClick={handleClear}
        >
          <Eraser className="w-3.5 h-3.5" />
          {t('composePane.clear')}
        </Button>

        <Button
          type="button"
          size="sm"
          className="h-7 gap-1.5 px-3"
          disabled={!canSend}
          onClick={handleSend}
        >
          <Send className="w-3.5 h-3.5" />
          {t('composePane.send')}
        </Button>
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
