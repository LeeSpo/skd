import { useTranslation } from 'react-i18next';
import { ArrowUpRight, ChevronRight, Server, Settings2, Terminal } from 'lucide-react';
import { Button } from './ui/button';

interface WelcomeScreenProps {
  onNewConnection: () => void;
  onNewLocalTerminal?: () => void;
  onOpenSettings: () => void;
}

export function WelcomeScreen({ onNewConnection, onNewLocalTerminal, onOpenSettings }: WelcomeScreenProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full overflow-auto bg-workspace">
      <div className="m-auto w-full max-w-lg px-8 py-10">
        <div className="mb-7 flex size-16 items-center justify-center rounded-2xl border border-border bg-surface-raised shadow-sm">
          <Terminal className="size-8 text-foreground" strokeWidth={1.5} aria-hidden="true" />
        </div>
        <h1 className="text-[28px] font-semibold tracking-tight">{t('welcome.title')}</h1>
        <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{t('welcome.getStartedDesc')}</p>

        <div className="mt-8 overflow-hidden rounded-xl border border-border bg-card">
          <Button variant="ghost" onClick={onNewConnection} className="h-auto w-full justify-start gap-3 rounded-none px-4 py-4 text-left">
            <Server className="size-5 text-primary" strokeWidth={1.5} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px]">{t('welcome.newConnection')}</span>
              <span className="mt-1 block whitespace-normal text-xs font-normal text-muted-foreground">{t('welcome.newConnectionDesc')}</span>
            </span>
            <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </Button>
          {onNewLocalTerminal && (
            <Button variant="ghost" onClick={onNewLocalTerminal} className="h-auto w-full justify-start gap-3 rounded-none border-t border-panel-border px-4 py-4 text-left">
              <Terminal className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">{t('welcome.localTerminal')}</span>
                <span className="mt-1 block whitespace-normal text-xs font-normal text-muted-foreground">{t('welcome.localTerminalDesc')}</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </Button>
          )}
        </div>
        <Button variant="ghost" onClick={onOpenSettings} className="mt-3 h-10 w-full justify-start gap-3 px-4 text-muted-foreground">
          <Settings2 className="size-4" aria-hidden="true" />
          <span className="flex-1 text-left">{t('welcome.preferences')}</span>
          <kbd className="workspace-key">⌘,</kbd>
        </Button>
        <p className="mt-8 text-xs leading-relaxed text-muted-foreground">{t('welcome.orPickFromSidebar')}</p>
      </div>
    </div>
  );
}
