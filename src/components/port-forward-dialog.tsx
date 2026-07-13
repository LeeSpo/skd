import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  ArrowRight,
  Bookmark,
  Loader2,
  Network,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Label } from './ui/label';
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
  testLocalForward,
  validateLocalForwardForm,
  type LocalForwardInfo,
} from '@/lib/port-forward';
import {
  deletePortForwardBookmark,
  getPortForwardBookmarks,
  savePortForwardBookmark,
  updatePortForwardBookmark,
  type PortForwardBookmark,
} from '@/lib/port-forward-bookmarks';

export interface PortForwardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string | null;
  connectionProfileId: string | null;
  connectionName?: string;
  connectionHost?: string;
  canManage: boolean;
}

export function PortForwardDialog({
  open,
  onOpenChange,
  connectionId,
  connectionProfileId,
  connectionName,
  connectionHost,
  canManage,
}: PortForwardDialogProps) {
  const { t } = useTranslation();
  const [forwards, setForwards] = useState<LocalForwardInfo[]>([]);
  const [bookmarkVersion, setBookmarkVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [localBindHost, setLocalBindHost] = useState(defaultLocalBindHost());
  const [localPort, setLocalPort] = useState('8080');
  const [remoteHost, setRemoteHost] = useState(defaultRemoteHost());
  const [remotePort, setRemotePort] = useState('');
  const [autoStart, setAutoStart] = useState(false);

  const bookmarks = useMemo(
    () => {
      void bookmarkVersion;
      return connectionProfileId ? getPortForwardBookmarks(connectionProfileId) : [];
    },
    [bookmarkVersion, connectionProfileId],
  );
  const reloadBookmarks = useCallback(() => setBookmarkVersion((version) => version + 1), []);

  const refresh = useCallback(async (showError = true) => {
    if (!connectionId || !canManage) {
      setForwards([]);
      return;
    }
    setLoading(true);
    try {
      setForwards(await listLocalForwards(connectionId));
    } catch (error) {
      if (showError) {
        toast.error(t('portForward.toast.listFailed'), {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      setLoading(false);
    }
  }, [canManage, connectionId, t]);

  useEffect(() => {
    if (!open) return;
    const initialTimer = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(false), 2000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [open, refresh]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setName('');
    setLocalBindHost(defaultLocalBindHost());
    setLocalPort('8080');
    setRemoteHost(defaultRemoteHost());
    setRemotePort('');
    setAutoStart(false);
  }, []);

  const parsedForm = useMemo(() => ({
    localPort: parseInt(localPort, 10),
    remotePort: parseInt(remotePort, 10),
  }), [localPort, remotePort]);

  const validateForm = () => {
    const error = validateLocalForwardForm({
      localBindHost,
      localPort: Number.isFinite(parsedForm.localPort) ? parsedForm.localPort : NaN,
      remoteHost,
      remotePort: Number.isFinite(parsedForm.remotePort) ? parsedForm.remotePort : NaN,
    });
    if (!error) return true;
    toast.error(t(`portForward.validation.${error}`));
    return false;
  };

  const handleSave = () => {
    if (!connectionProfileId || !validateForm()) return;
    if (!name.trim()) {
      toast.error(t('portForward.validation.nameRequired'));
      return;
    }
    const values = {
      name: name.trim(),
      localBindHost: localBindHost.trim(),
      localPort: parsedForm.localPort,
      remoteHost: remoteHost.trim(),
      remotePort: parsedForm.remotePort,
      autoStart,
    };
    if (editingId) {
      updatePortForwardBookmark(editingId, values);
      toast.success(t('portForward.toast.bookmarkUpdated'));
    } else {
      savePortForwardBookmark({ ...values, connectionProfileId });
      toast.success(t('portForward.toast.bookmarkSaved'));
    }
    reloadBookmarks();
    resetForm();
  };

  const handleEdit = (bookmark: PortForwardBookmark) => {
    setEditingId(bookmark.id);
    setName(bookmark.name);
    setLocalBindHost(bookmark.localBindHost);
    setLocalPort(String(bookmark.localPort));
    setRemoteHost(bookmark.remoteHost);
    setRemotePort(String(bookmark.remotePort));
    setAutoStart(bookmark.autoStart);
  };

  const handleDeleteBookmark = (id: string) => {
    deletePortForwardBookmark(id);
    if (editingId === id) resetForm();
    reloadBookmarks();
    toast.success(t('portForward.toast.bookmarkDeleted'));
  };

  const handleStart = async (bookmark?: PortForwardBookmark) => {
    if (!connectionId || !canManage) return;
    if (!bookmark && !validateForm()) return;
    const key = bookmark?.id ?? 'form';
    setStartingKey(key);
    try {
      const result = await startLocalForward({
        connection_id: connectionId,
        bookmark_id: bookmark?.id,
        name: bookmark?.name ?? (name.trim() || undefined),
        local_bind_host: bookmark?.localBindHost ?? localBindHost.trim(),
        local_port: bookmark?.localPort ?? parsedForm.localPort,
        remote_host: bookmark?.remoteHost ?? remoteHost.trim(),
        remote_port: bookmark?.remotePort ?? parsedForm.remotePort,
      });
      if (result.target_status === 'reachable') {
        toast.success(t('portForward.toast.started'));
      } else {
        toast.warning(t('portForward.toast.startedUnreachable'), {
          description: result.last_error ?? undefined,
        });
      }
      await refresh(false);
    } catch (error) {
      toast.error(t('portForward.toast.startFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setStartingKey(null);
    }
  };

  const handleStop = async (forwardId: string) => {
    if (!connectionId) return;
    setStoppingId(forwardId);
    try {
      await stopLocalForward(connectionId, forwardId);
      toast.success(t('portForward.toast.stopped'));
      await refresh(false);
    } catch (error) {
      toast.error(t('portForward.toast.stopFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setStoppingId(null);
    }
  };

  const handleTest = async (forwardId: string) => {
    if (!connectionId) return;
    setTestingId(forwardId);
    try {
      const result = await testLocalForward(connectionId, forwardId);
      if (result.target_status === 'reachable') toast.success(t('portForward.toast.testSucceeded'));
      else toast.error(t('portForward.toast.testFailed'), { description: result.last_error ?? undefined });
      await refresh(false);
    } catch (error) {
      toast.error(t('portForward.toast.testFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTestingId(null);
    }
  };

  const activeBookmarkIds = new Set(forwards.flatMap((forward) => forward.bookmark_id ? [forward.bookmark_id] : []));
  const sessionLabel = connectionName
    ? connectionHost ? `${connectionName} (${connectionHost})` : connectionName
    : connectionHost ?? '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position="tauriTall" className="sm:max-w-2xl overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2"><Network className="h-4 w-4" />{t('portForward.title')}</DialogTitle>
          <DialogDescription>
            {canManage && sessionLabel
              ? t('portForward.descriptionWithSession', { session: sessionLabel })
              : t('portForward.description')}
          </DialogDescription>
        </DialogHeader>

        {!canManage ? (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t('portForward.noActiveSsh')}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <section className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium"><Bookmark className="h-4 w-4" />{t('portForward.section.saved')}</div>
              {bookmarks.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{t('portForward.bookmarkEmpty')}</div>
              ) : (
                <ul className="divide-y rounded-md border">
                  {bookmarks.map((bookmark) => (
                    <li key={bookmark.id} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <span className="truncate">{bookmark.name}</span>
                          {bookmark.autoStart && <Badge variant="secondary">{t('portForward.status.autoStart')}</Badge>}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {bookmark.localBindHost}:{bookmark.localPort === 0 ? t('portForward.status.autoPort') : bookmark.localPort} → {bookmark.remoteHost}:{bookmark.remotePort}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" title={t('portForward.action.edit')} onClick={() => handleEdit(bookmark)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" title={t('portForward.action.delete')} onClick={() => handleDeleteBookmark(bookmark.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" disabled={activeBookmarkIds.has(bookmark.id) || startingKey === bookmark.id} onClick={() => void handleStart(bookmark)}>
                        {startingKey === bookmark.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                        {activeBookmarkIds.has(bookmark.id) ? t('portForward.action.active') : t('portForward.action.start')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <Separator />

            <section className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{t(editingId ? 'portForward.section.edit' : 'portForward.section.add')}</div>
                {editingId && <Button variant="ghost" size="sm" onClick={resetForm}><X className="mr-1.5 h-3.5 w-3.5" />{t('common.cancel')}</Button>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5"><Label htmlFor="pf-name">{t('portForward.label.name')}</Label><Input id="pf-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('portForward.placeholder.name')} /></div>
                <div className="space-y-1.5"><Label htmlFor="pf-local-host">{t('portForward.label.localBindHost')}</Label><Input id="pf-local-host" value={localBindHost} onChange={(event) => setLocalBindHost(event.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="pf-local-port">{t('portForward.label.localPort')}</Label><Input id="pf-local-port" type="number" min={0} max={65535} value={localPort} onChange={(event) => setLocalPort(event.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="pf-remote-host">{t('portForward.label.remoteHost')}</Label><Input id="pf-remote-host" value={remoteHost} onChange={(event) => setRemoteHost(event.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="pf-remote-port">{t('portForward.label.remotePort')}</Label><Input id="pf-remote-port" type="number" min={1} max={65535} value={remotePort} onChange={(event) => setRemotePort(event.target.value)} /></div>
              </div>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={autoStart} onCheckedChange={(checked) => setAutoStart(checked === true)} />{t('portForward.label.autoStart')}</label>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="inline-flex min-w-0 items-center gap-1 truncate">{localBindHost}:{localPort || '…'}<ArrowRight className="h-3 w-3 shrink-0" />{remoteHost}:{remotePort || '…'}</span>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={handleSave}><Save className="mr-1.5 h-3.5 w-3.5" />{t(editingId ? 'portForward.action.updateBookmark' : 'portForward.action.saveBookmark')}</Button>
                  {!editingId && <Button size="sm" disabled={startingKey === 'form'} onClick={() => void handleStart()}>{startingKey === 'form' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}{t('portForward.action.start')}</Button>}
                </div>
              </div>
            </section>

            <Separator />

            <section className="space-y-2">
              <div className="flex items-center justify-between"><div className="text-sm font-medium">{t('portForward.section.active')}</div><Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('common.refresh')}</Button></div>
              {forwards.length === 0 ? (
                <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">{loading ? t('common.loading') : t('portForward.empty')}</div>
              ) : (
                <ul className="divide-y rounded-md border">
                  {forwards.map((forward) => (
                    <li key={forward.id} className="flex items-center gap-3 px-3 py-2.5">
                      <StatusDot variant={forward.local_status === 'listening' && forward.target_status === 'reachable' ? 'connected' : 'disconnected'} />
                      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{forward.name?.trim() || formatForwardSummary(forward)}</div><div className="truncate text-xs text-muted-foreground">{formatForwardSummary(forward)}{forward.last_error ? ` · ${forward.last_error}` : ''}</div></div>
                      <Badge variant={forward.local_status === 'listening' ? 'outline' : 'destructive'}>{t(`portForward.status.${forward.local_status}`)}</Badge>
                      <Badge variant={forward.target_status === 'reachable' ? 'default' : 'secondary'}>{t(`portForward.status.${forward.target_status}`)}</Badge>
                      <Button variant="ghost" size="sm" title={t('portForward.action.test')} disabled={testingId === forward.id} onClick={() => void handleTest(forward.id)}>{testingId === forward.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}</Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" title={t('portForward.action.stop')} disabled={stoppingId === forward.id} onClick={() => void handleStop(forward.id)}>{stoppingId === forward.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
