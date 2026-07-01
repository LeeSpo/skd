import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { StatusDot, type StatusDotVariant } from './ui/status-dot';

interface StatusBarProps {
  activeConnection?: {
    name: string;
    protocol: string;
    host?: string;
    status: 'connected' | 'connecting' | 'disconnected' | 'pending';
  };
}

function toStatusDotVariant(
  status: NonNullable<StatusBarProps['activeConnection']>['status'],
): StatusDotVariant {
  if (status === 'connected') return 'connected';
  if (status === 'connecting') return 'connecting';
  if (status === 'pending') return 'pending';
  return 'disconnected';
}

export function StatusBar({ activeConnection }: StatusBarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex h-7 items-center justify-between border-t border-border bg-muted px-4 text-xs">
      <div className="flex items-center gap-4">
        {activeConnection && (
          <>
            <div className="flex items-center gap-2">
              <StatusDot variant={toStatusDotVariant(activeConnection.status)} />
              <span className={activeConnection.status === 'disconnected' ? 'text-muted-foreground' : ''}>
                {activeConnection.status === 'connected' ? t('statusBar.connected') :
                 activeConnection.status === 'connecting' ? t('statusBar.connecting') :
                 t('statusBar.disconnected')}
              </span>
              <span className="text-muted-foreground ml-1">{activeConnection.name}</span>
            </div>

            <Separator orientation="vertical" className="h-4" />

            <Badge variant="outline" className="text-xs">
              {activeConnection.protocol}
            </Badge>

            {activeConnection.host && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <span className="text-muted-foreground">{activeConnection.host}</span>
              </>
            )}
          </>
        )}
      </div>
      
      <div className="flex items-center gap-4">
        <div className="text-muted-foreground">
          {t('statusBar.ready')}
        </div>
      </div>
    </div>
  );
}