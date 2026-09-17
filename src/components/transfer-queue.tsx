import React from "react";
import { useTranslation } from 'react-i18next';
import { invoke } from "@tauri-apps/api/core";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import {
  Upload,
  Download,
  X,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Ban,
  Trash2,
  RotateCcw,
  FileUp,
  FolderOpen,
} from "lucide-react";
import type {
  TransferItem,
  TransferAction,
} from "@/lib/transfer-queue-reducer";
import { getActiveTransferCount } from "@/lib/transfer-queue-reducer";
import { formatSize } from "@/lib/file-entry-types";

// ---------- Legacy type export for backward compatibility ----------
export type { TransferItem } from "@/lib/transfer-queue-reducer";

// ---------- Types ----------

interface TransferQueueProps {
  transfers: TransferItem[];
  dispatch: React.Dispatch<TransferAction>;
  expanded: boolean;
  onToggleExpanded: () => void;
}

// ---------- Helpers ----------

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0) return "—";
  return `${formatSize(bytesPerSec)}/s`;
}

function formatEta(item: TransferItem): string {
  if (
    item.status !== "transferring" ||
    item.speed === 0 ||
    item.totalBytes === 0
  )
    return "—";
  const remaining = item.totalBytes - item.bytesTransferred;
  const seconds = Math.ceil(remaining / item.speed);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
}

function statusIcon(status: TransferItem["status"]) {
  switch (status) {
    case "queued":
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    case "transferring":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-status-pending" />;
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
    case "failed":
      return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
    case "cancelled":
      return <Ban className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

// ---------- Component ----------

export function TransferQueue({
  transfers,
  dispatch,
  expanded,
  onToggleExpanded,
}: TransferQueueProps) {
  const { t } = useTranslation();
  const activeCount = getActiveTransferCount(transfers);
  // Keep the user's disclosure choice; the collapsed summary still shows failures.

  if (transfers.length === 0 && !expanded) {
    return null;
  }

  const completedCount = transfers.filter(
    (t) => t.status === "completed",
  ).length;
  const failedCount = transfers.filter((t) => t.status === "failed").length;

  return (
    <Collapsible
      open={expanded}
      onOpenChange={onToggleExpanded}
      className="border-t border-panel-border bg-panel-toolbar"
    >
      <div className="flex items-center gap-2 px-3">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex min-w-0 flex-1 items-center py-2 text-xs rounded-md hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors motion-reduce:transition-none">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
            {t('transferQueue.transfers')}
            {activeCount > 0 && (
              <Badge
                variant="secondary"
                className="text-xs px-1.5 py-0 min-h-5"
              >
                {t('transferQueue.active', { count: activeCount })}
              </Badge>
            )}
            {completedCount > 0 && (
              <span className="text-success">{t('transferQueue.done', { count: completedCount })}</span>
            )}
            {failedCount > 0 && (
              <span className="text-destructive">{t('transferQueue.failedCount', { count: failedCount })}</span>
            )}
          </span>
        </button>
      </CollapsibleTrigger>
          {transfers.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-1.5 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: "CLEAR_COMPLETED" });
              }}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              {t('transferQueue.clear')}
            </Button>
          )}
      </div>
      <CollapsibleContent>
        <ScrollArea className="h-40">
          {transfers.length === 0 ? (
            <div className="flex items-center justify-center h-12 text-xs text-muted-foreground">
              {t('transferQueue.noTransfers')}
            </div>
          ) : (
            <div className="divide-y divide-panel-border bg-background">
              {transfers.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 px-3 py-1 text-xs"
                >
                  {item.direction === "upload" ? (
                    <Upload className="h-3 w-3 text-primary shrink-0" />
                  ) : (
                    <Download className="h-3 w-3 text-primary shrink-0" />
                  )}
                  {statusIcon(item.status)}
                  <span
                    className="truncate flex-1 min-w-0"
                    title={item.fileName}
                  >
                    {item.fileName}
                  </span>

                  {item.status === "transferring" && (
                    <>
                      <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      <span className="text-muted-foreground w-10 text-right">
                        {item.progress}%
                      </span>
                      <span className="text-muted-foreground w-16 text-right">
                        {formatSpeed(item.speed)}
                      </span>
                      <span className="text-muted-foreground w-10 text-right">
                        {formatEta(item)}
                      </span>
                    </>
                  )}

                  {item.status === "completed" && (
                    <>
                      <span className="text-muted-foreground shrink-0">
                        {formatSize(item.totalBytes)}
                      </span>
                      {item.direction === "download" && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                            aria-label={t('transferQueue.openFile')}
                            title={t('transferQueue.openFile')}
                            onClick={() =>
                              invoke("open_in_os", {
                                path: item.destinationPath,
                              }).catch(() => {})
                            }
                          >
                            <FileUp className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                            aria-label={t('transferQueue.showInFolder')}
                            title={t('transferQueue.showInFolder')}
                            onClick={() => {
                              const dir =
                                item.destinationPath.substring(
                                  0,
                                  Math.max(
                                    item.destinationPath.lastIndexOf("/"),
                                    item.destinationPath.lastIndexOf("\\"),
                                  ),
                                ) || "/";
                              invoke("open_in_os", { path: dir }).catch(
                                () => {},
                              );
                            }}
                          >
                            <FolderOpen className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </>
                  )}

                  {item.status === "failed" && (
                    <span
                      className="text-destructive break-words max-w-[min(40%,20rem)]"
                      title={item.error}
                    >
                      {item.error}
                    </span>
                  )}

                  {(item.status === "failed" ||
                    item.status === "cancelled") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      aria-label={t('transferQueue.retry')}
                      title={t('transferQueue.retry')}
                      onClick={() =>
                        dispatch({ type: "RETRY", id: item.id })
                      }
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}

                  {(item.status === "queued" ||
                    item.status === "transferring") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      aria-label={t('transferQueue.cancel')}
                      title={t('transferQueue.cancel')}
                      onClick={() =>
                        dispatch({ type: "CANCEL", id: item.id })
                      }
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
}
