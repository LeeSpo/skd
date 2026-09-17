import React from 'react';
import { useTranslation } from 'react-i18next';
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
  const statusLabel = activeConnection && (
    activeConnection.status === 'connected' ? t('statusBar.connected') :
    activeConnection.status === 'connecting' ? t('statusBar.connecting') :
    activeConnection.status === 'pending' ? t('statusBar.pending') :
    t('statusBar.disconnected')
  );
  return (
    <div className="flex h-7 shrink-0 items-center justify-between gap-4 border-t border-panel-border bg-statusbar px-4 text-xs">
      <div className="flex min-w-0 items-center gap-3">
        {activeConnection && (
          <>
            <div className="flex shrink-0 items-center gap-1.5">
              <StatusDot variant={toStatusDotVariant(activeConnection.status)} />
              <span className={activeConnection.status === 'disconnected' ? 'text-muted-foreground' : ''}>
                {statusLabel}
              </span>
            </div>
            <span className="min-w-0 truncate text-muted-foreground" title={activeConnection.host ? `${activeConnection.name} — ${activeConnection.host}` : activeConnection.name}>
              {activeConnection.host ? `${activeConnection.name} — ${activeConnection.host}` : activeConnection.name}
            </span>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center text-muted-foreground">
        {activeConnection?.protocol}
      </div>
    </div>
  );
}
