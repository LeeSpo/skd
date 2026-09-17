import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Terminal, Plus, Settings } from 'lucide-react';

interface WelcomeScreenProps {
  onNewConnection: () => void;
  onOpenSettings: () => void;
}

export function WelcomeScreen({ onNewConnection, onOpenSettings }: WelcomeScreenProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full overflow-auto bg-workspace">
      <div className="m-auto w-full max-w-xl px-6 py-10">
        <div className="mb-8 flex items-center gap-3">
          <Terminal className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold tracking-tight">{t('app.title')}</h1>
        </div>

        <h2 className="text-base font-medium">{t('welcome.getStarted')}</h2>
        <p className="mt-2 text-[13px] text-muted-foreground">{t('welcome.getStartedDesc')}</p>

        <div className="mt-5 space-y-2">
          <Button
            onClick={onNewConnection}
            className="h-auto w-full justify-start gap-3 whitespace-normal px-4 py-3 text-left"
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{t('welcome.newConnection')}</span>
            <kbd className="text-xs font-normal">⌘N</kbd>
          </Button>
          <p className="px-4 pb-3 text-xs text-muted-foreground">{t('welcome.newConnectionDesc')}</p>
          <Button
            variant="outline"
            onClick={onOpenSettings}
            className="h-auto w-full justify-start gap-3 whitespace-normal px-4 py-3 text-left"
          >
            <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{t('welcome.preferences')}</span>
            <kbd className="text-xs font-normal text-muted-foreground">⌘,</kbd>
          </Button>
          <p className="px-4 text-xs text-muted-foreground">{t('welcome.preferencesDesc')}</p>
        </div>
        <p className="mt-8 border-t border-panel-border pt-4 text-xs text-muted-foreground">
          {t('welcome.orPickFromSidebar')}
        </p>
      </div>
    </div>
  );
}
