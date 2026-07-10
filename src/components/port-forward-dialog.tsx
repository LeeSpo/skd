import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowRight, Loader2, Network, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { StatusDot } from './ui/status-dot';
import { Separator } from './ui/separator';
import {
  defaultLocalBindHost,
  defaultRemoteHost,
  formatForwardSummary,
  listLocalForwards,
  startLocalForward,
  stopLocalForward,
  validateLocalForwardForm,
  type LocalForwardInfo,
} from '@/lib/port-forward';

export interface PortForwardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string | null;
  connectionName?: string;
  connectionHost?: string;
  /** When false, form is disabled and list is empty. */
  canManage: boolean;
}

export function PortForwardDialog({
  open,
  onOpenChange,
  connectionId,
  connectionName,
  connectionHost,
  canManage,
}: PortForwardDialogProps) {
  const { t } = useTranslation();
  const [forwards, setForwards] = useState<LocalForwardInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [localBindHost, setLocalBindHost] = useState(defaultLocalBindHost());
  const [localPort, setLocalPort] = useState('8080');
  const [remoteHost, setRemoteHost] = useState(defaultRemoteHost());
  const [remotePort, setRemotePort] = useState('');

  const refresh = useCallback(async () => {
    if (!connectionId || !canManage) {
      setForwards([]);
      return;
    }
    setLoading(true);
    try {
      const list = await listLocalForwards(connectionId);
      setForwards(list);
    } catch (error) {
      toast.error(t('portForward.toast.listFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
      setForwards([]);
    } finally {
      setLoading(false);
    }
  }, [canManage, connectionId, t]);

  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open, refresh]);

  const handleStart = async () => {
    if (!connectionId || !canManage) return;

    const localPortNum = parseInt(localPort, 10);
    const remotePortNum = parseInt(remotePort, 10);
    const validationError = validateLocalForwardForm({
      localBindHost,
      localPort: Number.isFinite(localPortNum) ? localPortNum : NaN,
      remoteHost,
      remotePort: Number.isFinite(remotePortNum) ? remotePortNum : NaN,
    });
    if (validationError) {
      const validationMessages = {
        localBindHostRequired: t('portForward.validation.localBindHostRequired'),
        localPortInvalid: t('portForward.validation.localPortInvalid'),
        remoteHostRequired: t('portForward.validation.remoteHostRequired'),
        remotePortInvalid: t('portForward.validation.remotePortInvalid'),
      } as const;
      toast.error(validationMessages[validationError]);
      return;
    }

    setStarting(true);
    try {
      await startLocalForward({
        connection_id: connectionId,
        name: name.trim() || undefined,
        local_bind_host: localBindHost.trim() || defaultLocalBindHost(),
        local_port: localPortNum,
        remote_host: remoteHost.trim() || defaultRemoteHost(),
        remote_port: remotePortNum,
      });
      toast.success(t('portForward.toast.started'));
      setName('');
      await refresh();
    } catch (error) {
      toast.error(t('portForward.toast.startFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async (forwardId: string) => {
    if (!connectionId) return;
    setStoppingId(forwardId);
    try {
      await stopLocalForward(connectionId, forwardId);
      toast.success(t('portForward.toast.stopped'));
      await refresh();
    } catch (error) {
      toast.error(t('portForward.toast.stopFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setStoppingId(null);
    }
  };

  const sessionLabel = connectionName
    ? connectionHost
      ? `${connectionName} (${connectionHost})`
      : connectionName
    : connectionHost ?? '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        position="tauriTall"
        className="sm:max-w-xl overflow-hidden"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-4 w-4" />
            {t('portForward.title')}
          </DialogTitle>
          <DialogDescription>
            {canManage && sessionLabel
              ? t('portForward.descriptionWithSession', { session: sessionLabel })
              : t('portForward.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {!canManage ? (
            <div className="flex flex-1 items-center justify-center rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              {t('portForward.noActiveSsh')}
            </div>
          ) : (
            <>
              <div className="shrink-0 space-y-3 rounded-md border p-3">
                <div className="text-sm font-medium">{t('portForward.section.add')}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="pf-name">{t('portForward.label.name')}</Label>
                    <Input
                      id="pf-name"
                      placeholder={t('portForward.placeholder.name')}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={starting}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pf-local-host">{t('portForward.label.localBindHost')}</Label>
                    <Input
                      id="pf-local-host"
                      value={localBindHost}
                      onChange={(e) => setLocalBindHost(e.target.value)}
                      disabled={starting}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pf-local-port">{t('portForward.label.localPort')}</Label>
                    <Input
                      id="pf-local-port"
                      type="number"
                      min={0}
                      max={65535}
                      placeholder={t('portForward.placeholder.localPort')}
                      value={localPort}
                      onChange={(e) => setLocalPort(e.target.value)}
                      disabled={starting}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pf-remote-host">{t('portForward.label.remoteHost')}</Label>
                    <Input
                      id="pf-remote-host"
                      placeholder={t('portForward.placeholder.remoteHost')}
                      value={remoteHost}
                      onChange={(e) => setRemoteHost(e.target.value)}
                      disabled={starting}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pf-remote-port">{t('portForward.label.remotePort')}</Label>
                    <Input
                      id="pf-remote-port"
                      type="number"
                      min={1}
                      max={65535}
                      placeholder={t('portForward.placeholder.remotePort')}
                      value={remotePort}
                      onChange={(e) => setRemotePort(e.target.value)}
                      disabled={starting}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 truncate">
                    {localBindHost || defaultLocalBindHost()}:{localPort || '…'}
                    <ArrowRight className="h-3 w-3 shrink-0" />
                    {remoteHost || defaultRemoteHost()}:{remotePort || '…'}
                  </span>
                  <Button size="sm" onClick={() => void handleStart()} disabled={starting}>
                    {starting ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {t('portForward.action.start')}
                  </Button>
                </div>
              </div>

              <Separator className="shrink-0" />

              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <div className="flex shrink-0 items-center justify-between">
                  <div className="text-sm font-medium">{t('portForward.section.active')}</div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void refresh()}
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      t('common.refresh')
                    )}
                  </Button>
                </div>

                <ScrollArea className="min-h-0 flex-1 rounded-md border">
                  {forwards.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      {loading ? t('common.loading') : t('portForward.empty')}
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {forwards.map((fwd) => (
                        <li
                          key={fwd.id}
                          className="flex items-center gap-3 px-3 py-2.5"
                        >
                          <StatusDot
                            variant={fwd.status === 'listening' ? 'connected' : 'disconnected'}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">
                              {fwd.name?.trim() || formatForwardSummary(fwd)}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {fwd.name?.trim()
                                ? formatForwardSummary(fwd)
                                : t('portForward.status.listening')}
                            </div>
                          </div>
                          <Badge variant="outline" className="shrink-0 text-xs">
                            {fwd.status}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0 text-destructive hover:text-destructive"
                            onClick={() => void handleStop(fwd.id)}
                            disabled={stoppingId === fwd.id}
                            title={t('portForward.action.stop')}
                          >
                            {stoppingId === fwd.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
