import { useTranslation } from 'react-i18next';
import { ArrowUpRight, ChevronRight, Server, Settings2, Terminal } from 'lucide-react';
import packageJson from '../../package.json';
import { Button } from './ui/button';

export interface WelcomeConnection {
  id: string;
  name: string;
  host: string;
  username: string;
}

interface WelcomeScreenProps {
  onNewConnection: () => void;
  onNewLocalTerminal?: () => void;
  onOpenSettings: () => void;
  recentConnections?: WelcomeConnection[];
  onQuickConnect?: (connectionId: string) => void;
}

export function WelcomeScreen({
  onNewConnection,
  onNewLocalTerminal,
  onOpenSettings,
  recentConnections = [],
  onQuickConnect,
}: WelcomeScreenProps) {
  const { t } = useTranslation();
  const hasRecent = recentConnections.length > 0;

  return (
    <div className="welcome-workspace flex h-full overflow-auto bg-workspace">
      <div className={`m-auto flex w-full ${hasRecent ? 'max-w-3xl' : 'max-w-md'}`}>
        <div className="min-w-0 flex-1 px-8 py-10">
          <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-secondary">
            <Terminal className="size-8 text-foreground" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h1 className="text-[22px] font-bold tracking-tight">{t('welcome.title')}</h1>
          <p className="mt-1 text-[11px] text-muted-foreground">{t('welcome.version', { version: packageJson.version })}</p>
          <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{t('welcome.getStartedDesc')}</p>

          <div className="mt-7 overflow-hidden rounded-lg bg-card">
            <Button variant="ghost" onClick={onNewConnection} className="h-auto w-full justify-start gap-3 rounded-none px-4 py-3.5 text-left">
              <Server className="size-5 text-primary" strokeWidth={1.5} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">{t('welcome.newConnection')}</span>
                <span className="mt-1 block whitespace-normal text-xs font-normal text-muted-foreground">{t('welcome.newConnectionDesc')}</span>
              </span>
              <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </Button>
            {onNewLocalTerminal && (
              <Button variant="ghost" onClick={onNewLocalTerminal} className="h-auto w-full justify-start gap-3 rounded-none border-t border-panel-border px-4 py-3.5 text-left">
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
        {hasRecent && (
          <aside className="w-72 shrink-0 border-l border-border px-4 py-10">
            <h2 className="px-2 text-[11px] font-semibold text-muted-foreground">{t('welcome.recent')}</h2>
            <div className="mt-2">
              {recentConnections.map((connection) => (
                <Button
                  key={connection.id}
                  variant="ghost"
                  onClick={() => onQuickConnect?.(connection.id)}
                  className="h-auto w-full justify-start rounded-md px-2 py-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">{connection.name}</span>
                    <span className="block truncate text-[11px] font-normal text-muted-foreground">
                      {connection.username}@{connection.host}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
